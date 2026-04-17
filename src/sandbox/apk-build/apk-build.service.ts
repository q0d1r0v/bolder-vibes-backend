import {
  Injectable,
  Inject,
  Logger,
  forwardRef,
  BadRequestException,
  NotFoundException,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import { randomBytes } from 'crypto';
import type { Readable } from 'stream';
import { RedisService } from '@/redis/redis.service.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { EventsGateway } from '@/gateway/events.gateway.js';
import { ExpoAccountService } from '@/users/expo-account/expo-account.service.js';
import { MetricsService } from '@/common/metrics/metrics.service.js';
import { upgradeProjectToTargetSdk } from '../preview/sdk-upgrade.js';
import {
  AndroidBuildType,
  ApkBuildMode,
  ApkBuildPlatform,
  ApkBuildState,
  ApkBuildStatus,
} from '../preview/preview.interface.js';

const execFileAsync = promisify(execFile);

/** Container image that contains Android SDK + OpenJDK + Gradle. */
const APK_BUILDER_IMAGE = 'bv-expo-apk-builder:latest';

/** Lightweight image for cloud builds — only needs Node + eas-cli. */
const EAS_CLOUD_IMAGE = 'node:20-alpine';

/** Host path to a pre-downloaded gradle distribution. The gradle
 *  wrapper's hard-coded 10 s network timeout makes fetching the
 *  ~220 MB distributive at build time extremely flaky on slow links,
 *  so we ship it as a static host-side asset and point the wrapper's
 *  `distributionUrl` at a file:// URL (overridable via BV_GRADLE_DIST). */
const GRADLE_DIST_HOST_PATH =
  process.env.BV_GRADLE_DIST ??
  `${process.env.HOME ?? ''}/.bv-cache/gradle-8.10.2-all.zip`;

/** Redis key TTL — 24 h. Same as other preview keys. */
const REDIS_TTL_SECONDS = 24 * 60 * 60;

/** Hard cap on local container runtime. APK builds on a warm host usually
 *  take 3-8 min; first build ≤ 15 min. Kill anything longer. */
const LOCAL_BUILD_TIMEOUT_MS = 20 * 60 * 1000;

/** Hard cap on cloud (EAS) runtime — EAS free tier can queue for a while,
 *  plus the actual build. 45 min is a generous ceiling. */
const CLOUD_BUILD_TIMEOUT_MS = 45 * 60 * 1000;

@Injectable()
export class ApkBuildService implements OnApplicationShutdown {
  private readonly logger = new Logger(ApkBuildService.name);
  /** In-memory guard to prevent two parallel builds for the same project. */
  private readonly buildingProjects = new Set<string>();

  /** Best-effort cleanup on SIGTERM: stop every container spawned by this
   *  service. Redis state is left intact — the self-recovery path in
   *  `getStatus()` will reset orphaned "building" states on next poll. */
  async onApplicationShutdown(): Promise<void> {
    if (this.buildingProjects.size === 0) return;
    this.logger.log(
      `Shutdown: killing ${this.buildingProjects.size} in-flight APK build container(s)`,
    );
    await Promise.allSettled(
      [...this.buildingProjects].map((projectId) =>
        this.removeContainer(this.getContainerName(projectId)),
      ),
    );
    this.buildingProjects.clear();
  }

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly expoAccount: ExpoAccountService,
    private readonly metrics: MetricsService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly gateway: EventsGateway,
  ) {}

  /** Absolute path where all built APKs are persisted on the host.
   *  Overridable via APK_UPLOADS_DIR (useful in tests / shared hosting). */
  private get uploadsDir(): string {
    return this.configService.get<string>(
      'APK_UPLOADS_DIR',
      path.join(process.cwd(), 'uploads', 'apk'),
    );
  }

  private getWorkDir(projectId: string): string {
    return path.join(os.tmpdir(), `bv-apk-${projectId.replace(/-/g, '')}`);
  }

  private getApkPath(projectId: string, ext = 'apk'): string {
    const safeId = projectId.replace(/-/g, '');
    return path.join(this.uploadsDir, `${safeId}.${ext}`);
  }

  /** Select the on-disk extension for a given (platform, buildType). */
  private extensionFor(
    platform: ApkBuildPlatform,
    buildType: AndroidBuildType,
  ): string {
    if (platform === 'ios') return 'tar.gz';
    return buildType === 'aab' ? 'aab' : 'apk';
  }

  private getContainerName(projectId: string): string {
    return `bv-apk-${projectId.replace(/-/g, '')}`;
  }

  /** Start a mobile artifact build. Fire-and-forget: returns immediately
   *  with the BUILDING state; progress is streamed via WebSocket events.
   *
   *  Supported combinations:
   *   - local + android + apk (debug APK on the backend host)
   *   - cloud + android + apk (EAS → debug APK)
   *   - cloud + android + aab (EAS → Play Store upload bundle)
   *   - cloud + ios            (EAS → simulator .tar.gz, no Apple creds)
   */
  async startBuild(
    projectId: string,
    mode: ApkBuildMode = 'local',
    platform: ApkBuildPlatform = 'android',
    buildType: AndroidBuildType = 'apk',
  ): Promise<ApkBuildState> {
    if (this.buildingProjects.has(projectId)) {
      throw new BadRequestException(
        'A build is already in progress for this project.',
      );
    }

    // Pre-flight validation on mode/platform/buildType combinations.
    if (platform === 'ios' && mode !== 'cloud') {
      throw new BadRequestException(
        'iOS builds require cloud mode (EAS). Linux hosts cannot build iOS natively.',
      );
    }
    if (buildType === 'aab' && mode !== 'cloud') {
      throw new BadRequestException(
        'AAB (Play Store bundle) builds require cloud mode.',
      );
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    let expoToken: string | null = null;
    if (mode === 'cloud') {
      expoToken = await this.expoAccount.getTokenPlaintext(project.ownerId);
      if (!expoToken) {
        throw new BadRequestException(
          'Cloud build requires an Expo access token. Save one in Settings → Expo Account first.',
        );
      }
    }

    const state: ApkBuildState = {
      projectId,
      status: ApkBuildStatus.BUILDING,
      mode,
      platform,
      buildType: platform === 'ios' ? 'simulator' : buildType,
    };
    await this.redis.set(
      `apk:${projectId}`,
      JSON.stringify(state),
      'EX',
      REDIS_TTL_SECONDS,
    );

    this.gateway.emitToProject(projectId, 'apk:build_started', {
      projectId,
      mode,
      platform,
      buildType: state.buildType,
    });
    this.buildingProjects.add(projectId);
    this.metrics.apkBuildsStarted.inc({
      mode,
      platform,
      build_type: state.buildType ?? 'apk',
    });
    const endTimer = this.metrics.apkBuildDurationSeconds.startTimer({
      mode,
      platform,
      build_type: state.buildType ?? 'apk',
    });

    const task =
      mode === 'cloud'
        ? this.runCloudBuild(projectId, expoToken!, platform, buildType)
        : this.runLocalBuild(projectId);

    task
      .then(() => {
        endTimer({ outcome: 'success' });
        this.metrics.apkBuildsSucceeded.inc({
          mode,
          platform,
          build_type: state.buildType ?? 'apk',
        });
      })
      .catch(async (err) => {
        const msg = err instanceof Error ? err.message : 'Build failed';
        this.logger.error(`Build failed for ${projectId}: ${msg}`);
        endTimer({ outcome: 'failure' });
        this.metrics.apkBuildsFailed.inc({
          mode,
          platform,
          build_type: state.buildType ?? 'apk',
          reason: msg.slice(0, 40),
        });
        const easBuildUrl =
          mode === 'cloud'
            ? this.parseEasBuildUrlFromBuffer(projectId)
            : undefined;
        await this.markError(
          projectId,
          msg,
          mode,
          easBuildUrl ?? undefined,
          platform,
          state.buildType,
        );
      })
      .finally(() => {
        this.buildingProjects.delete(projectId);
      });

    return state;
  }

  async getStatus(projectId: string): Promise<ApkBuildState> {
    const data = await this.redis.get(`apk:${projectId}`);
    if (!data) {
      return { projectId, status: ApkBuildStatus.IDLE };
    }
    const state = JSON.parse(data) as ApkBuildState;

    // Self-recovery: if Redis claims a build is in progress but this process
    // has no in-memory record of it AND no container by that name is alive,
    // the build was orphaned by a backend restart / crash. Reset the state
    // so the UI unblocks and the user can retry.
    if (
      state.status === ApkBuildStatus.BUILDING &&
      !this.buildingProjects.has(projectId)
    ) {
      const alive = await this.isContainerAlive(
        this.getContainerName(projectId),
      );
      if (!alive) {
        this.logger.warn(
          `Orphaned "building" state for ${projectId} — resetting to idle.`,
        );
        await this.redis.del(`apk:${projectId}`);
        return { projectId, status: ApkBuildStatus.IDLE };
      }
    }

    return state;
  }

  private async isContainerAlive(name: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(
        'docker',
        ['ps', '-q', '--filter', `name=^/${name}$`],
        { timeout: 5000 },
      );
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /** Stream the built artifact (APK / AAB / iOS simulator .tar.gz) as a
   *  Readable. Throws if not ready. Path is confined to uploadsDir for
   *  defense in depth against symlink attacks. */
  async getApkStream(projectId: string): Promise<{
    stream: Readable;
    sizeBytes: number;
    filename: string;
    contentType: string;
  }> {
    const state = await this.getStatus(projectId);
    if (state.status !== ApkBuildStatus.READY) {
      throw new NotFoundException('Build is not ready for this project.');
    }
    const ext = this.extensionForState(state);
    const artifactPath = this.getApkPath(projectId, ext);
    const resolved = path.resolve(artifactPath);
    const resolvedDir = path.resolve(this.uploadsDir);
    if (!resolved.startsWith(resolvedDir + path.sep)) {
      throw new NotFoundException(
        'Artifact path is outside the uploads directory.',
      );
    }
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(resolved);
    } catch {
      throw new NotFoundException('Artifact file no longer exists on disk.');
    }
    const safeId = projectId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 8);
    return {
      stream: createReadStream(resolved),
      sizeBytes: stat.size,
      filename: `app-${safeId}.${ext}`,
      contentType: this.contentTypeFor(ext),
    };
  }

  private extensionForState(state: ApkBuildState): string {
    if (state.platform === 'ios') return 'tar.gz';
    return state.buildType === 'aab' ? 'aab' : 'apk';
  }

  private contentTypeFor(ext: string): string {
    switch (ext) {
      case 'apk':
        return 'application/vnd.android.package-archive';
      case 'aab':
        return 'application/octet-stream';
      case 'tar.gz':
        return 'application/gzip';
      default:
        return 'application/octet-stream';
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // LOCAL BUILD (Docker + Gradle)
  // ─────────────────────────────────────────────────────────────────────

  private async runLocalBuild(projectId: string): Promise<void> {
    this.emitProgress(projectId, 'Preparing build environment...');

    const files = await this.fetchAndWriteFiles(projectId);
    this.emitProgress(projectId, `Found ${files.length} files`);

    // Verify the APK builder image is available.
    try {
      await execFileAsync('docker', ['image', 'inspect', APK_BUILDER_IMAGE], {
        timeout: 5000,
      });
    } catch {
      throw new Error(
        `Docker image "${APK_BUILDER_IMAGE}" not found. Build it first: ` +
          `bash bolder-vibes-backend/docker/expo-apk-builder/build.sh`,
      );
    }

    const workDir = this.getWorkDir(projectId);
    await this.patchAppJson(projectId, workDir);

    await fs.mkdir(this.uploadsDir, { recursive: true });

    const containerName = this.getContainerName(projectId);
    await this.removeContainer(containerName);

    this.emitProgress(projectId, 'Starting Android build container...');

    const buildCommand = [
      'set -e',
      'echo "[bv] npm install..."',
      'npm install --prefer-offline --no-audit --no-fund --loglevel=error',
      // `@expo/vector-icons@14.x` declares `expo-font: "*"` as a peer
      // dependency → npm pulls SDK-55's expo-font even though the project
      // targets SDK 52. `expo install --fix` pins every expo-* package
      // back to the SDK map.
      'echo "[bv] expo install --fix (pin expo-* to SDK versions)..."',
      './node_modules/.bin/expo install --fix < /dev/null',
      'echo "[bv] expo prebuild (generating android/)..."',
      './node_modules/.bin/expo prebuild --platform android --no-install --clean < /dev/null',
      'echo "[bv] patching gradle-wrapper.properties..."',
      "sed -i 's#distributionUrl=.*#distributionUrl=file\\\\:/bv-cache/gradle-8.10.2-all.zip#' android/gradle/wrapper/gradle-wrapper.properties",
      'cat android/gradle/wrapper/gradle-wrapper.properties',
      'echo "[bv] gradle assembleDebug..."',
      'cd android && rm -rf .gradle',
      'for i in 1 2 3; do' +
        ' echo "[bv] gradle attempt $i/3...";' +
        ' if ./gradlew assembleDebug --no-daemon --console=plain; then break; fi;' +
        ' rc=$?;' +
        ' if [ "$i" = "3" ]; then exit $rc; fi;' +
        ' echo "[bv] gradle attempt $i failed, retrying in 5s...";' +
        ' sleep 5;' +
        ' done',
    ].join(' && ');

    const dockerArgs = [
      'run',
      '--rm',
      '--name',
      containerName,
      '--memory',
      '8g',
      '--cpus',
      '4',
      '-v',
      `${workDir}:/app`,
      '-v',
      `${GRADLE_DIST_HOST_PATH}:/bv-cache/gradle-8.10.2-all.zip:ro`,
      '-v',
      'bv-android-sdk:/opt/android',
      '-v',
      'bv-gradle-cache:/root/.gradle',
      '-v',
      'bv-npm-cache:/root/.npm',
      '-w',
      '/app',
      APK_BUILDER_IMAGE,
      'sh',
      '-c',
      buildCommand,
    ];

    const exitCode = await this.runWithLogStreaming(
      projectId,
      dockerArgs,
      LOCAL_BUILD_TIMEOUT_MS,
    );

    if (exitCode !== 0) {
      throw new Error(
        `APK build failed (exit code ${exitCode}). Check the build log for details.`,
      );
    }

    const apkOnDisk = path.join(
      workDir,
      'android',
      'app',
      'build',
      'outputs',
      'apk',
      'debug',
      'app-debug.apk',
    );
    try {
      await fs.access(apkOnDisk);
    } catch {
      throw new Error(
        'Build completed but app-debug.apk was not found. Gradle output may be in an unexpected location.',
      );
    }

    const finalApkPath = this.getApkPath(projectId);
    await fs.copyFile(apkOnDisk, finalApkPath);
    const stat = await fs.stat(finalApkPath);

    await this.cleanupWorkDir(workDir);

    await this.markReady(projectId, 'local', stat.size);
  }

  // ─────────────────────────────────────────────────────────────────────
  // CLOUD BUILD (Expo EAS Build)
  // ─────────────────────────────────────────────────────────────────────

  private async runCloudBuild(
    projectId: string,
    expoToken: string,
    platform: ApkBuildPlatform,
    buildType: AndroidBuildType,
  ): Promise<void> {
    this.emitProgress(
      projectId,
      `Preparing cloud build (platform=${platform}, type=${
        platform === 'ios' ? 'simulator' : buildType
      })...`,
    );

    const files = await this.fetchAndWriteFiles(projectId);
    this.emitProgress(projectId, `Found ${files.length} files`);

    const workDir = this.getWorkDir(projectId);
    await this.patchAppJson(projectId, workDir);

    // Pick the EAS profile based on what the user asked for. Android APK
    // (`preview-apk`) uses a locally generated keystore; Android AAB
    // (`preview-aab`) targets Play Store upload format and also uses
    // local credentials; iOS simulator (`preview-ios`) builds a .tar.gz
    // that runs on the iPhone Simulator without requiring an Apple
    // Developer account — perfect for smoke testing without onboarding.
    const easProfile =
      platform === 'ios'
        ? 'preview-ios'
        : buildType === 'aab'
          ? 'preview-aab'
          : 'preview-apk';

    // Always (re)generate eas.json so the profile we picked is guaranteed
    // to exist. Existing eas.json is respected only if it already defines
    // the target profile.
    const easJsonPath = path.join(workDir, 'eas.json');
    let shouldWriteEasJson = true;
    try {
      const raw = await fs.readFile(easJsonPath, 'utf8');
      const parsed = JSON.parse(raw) as {
        build?: Record<string, unknown>;
      };
      if (parsed.build && parsed.build[easProfile]) {
        this.emitProgress(
          projectId,
          `Using existing eas.json profile "${easProfile}"`,
        );
        shouldWriteEasJson = false;
      }
    } catch {
      /* no eas.json or malformed — we'll write one */
    }
    if (shouldWriteEasJson) {
      await fs.writeFile(
        easJsonPath,
        JSON.stringify(
          {
            cli: { version: '>= 10.0.0', appVersionSource: 'local' },
            build: {
              'preview-apk': {
                distribution: 'internal',
                android: {
                  buildType: 'apk',
                  credentialsSource: 'local',
                },
              },
              'preview-aab': {
                distribution: 'internal',
                android: {
                  buildType: 'app-bundle',
                  credentialsSource: 'local',
                },
              },
              'preview-ios': {
                distribution: 'internal',
                ios: {
                  simulator: true,
                },
              },
            },
          },
          null,
          2,
        ),
      );
      this.emitProgress(
        projectId,
        `Generated eas.json (profile → ${easProfile})`,
      );
    }

    // Android builds need a keystore — iOS simulator builds don't. Skip
    // credentials.json generation for iOS so EAS doesn't complain about
    // an unexpected block.
    const keystorePassword = randomBytes(18).toString('base64url');
    if (platform === 'android') {
      await fs.writeFile(
        path.join(workDir, 'credentials.json'),
        JSON.stringify(
          {
            android: {
              keystore: {
                keystorePath: 'release.keystore',
                keystorePassword,
                keyAlias: 'bolder-vibes',
                keyPassword: keystorePassword,
              },
            },
          },
          null,
          2,
        ),
      );
    }

    // Verify docker base image is available (pulled on first use).
    this.emitProgress(projectId, `Ensuring ${EAS_CLOUD_IMAGE} image...`);
    try {
      await execFileAsync('docker', ['image', 'inspect', EAS_CLOUD_IMAGE], {
        timeout: 5000,
      });
    } catch {
      try {
        await execFileAsync('docker', ['pull', EAS_CLOUD_IMAGE], {
          timeout: 120_000,
        });
      } catch (err) {
        throw new Error(
          `Could not pull ${EAS_CLOUD_IMAGE}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    await fs.mkdir(this.uploadsDir, { recursive: true });

    const containerName = this.getContainerName(projectId);
    await this.removeContainer(containerName);

    this.emitProgress(projectId, 'Starting EAS build container...');

    // The command run inside the cloud builder container.
    //  1. `npm install` so eas-cli can read the expo SDK version from the
    //     installed `expo` package (eas init/build both require this).
    //  2. Install eas-cli pinned to a known-good major.
    //  3. `eas init --non-interactive --force` ensures an EAS project
    //     exists for this user (writes projectId into app.json).
    //  4. `eas build --platform android --profile preview --non-interactive
    //     --json` submits the build and waits for completion. Stdout is
    //     pure JSON (artifact metadata), stderr carries the live progress
    //     feed. We redirect stdout to /app/eas-build.json (shared via the
    //     bind mount so the host process can parse it after the container
    //     exits) and leave stderr going to docker logs so the user sees
    //     progress in the UI.
    //
    // We deliberately DO NOT splice EXPO_TOKEN into the shell command —
    // it is passed via the container environment instead so it never
    // appears in `ps` listings or log lines.
    // Keystore generation block — Android only. iOS simulator builds need
    // no signing infrastructure.
    const keystoreBlock =
      platform === 'android'
        ? [
            'echo "[bv] installing openjdk (for keytool)..."',
            'apk add --no-cache openjdk17-jre-headless >/dev/null',
            'echo "[bv] generating release keystore..."',
            'if [ ! -f /app/release.keystore ]; then' +
              ' keytool -genkeypair -v' +
              ' -keystore /app/release.keystore' +
              ' -alias bolder-vibes -keyalg RSA -keysize 2048 -validity 10000' +
              ' -storepass "$BV_KEYSTORE_PASS" -keypass "$BV_KEYSTORE_PASS"' +
              ' -dname "CN=BolderVibes,OU=Dev,O=BolderVibes,L=NA,ST=NA,C=US"' +
              ' -noprompt; fi',
          ]
        : [];

    const easBuildCommand = [
      'set -e',
      ...keystoreBlock,
      'echo "[bv] npm install (needed for SDK detection)..."',
      'npm install --prefer-offline --no-audit --no-fund --loglevel=error',
      // EAS Build runs `expo doctor` unconditionally and treats any
      // warning as a build-killing error. The two checks that most
      // frequently fail for generated projects are:
      //   1. Missing peer dep `expo-font` (pulled in by @expo/vector-icons)
      //   2. expo-* package versions not matching the SDK manifest
      // Running `expo install --fix` rewrites package.json to the exact
      // SDK-expected versions, and `expo install expo-font` fills the
      // missing peer. Both run from the LOCAL bin so we never pull a
      // newer expo CLI over the network mid-build.
      'echo "[bv] expo install expo-font (missing peer for @expo/vector-icons)..."',
      './node_modules/.bin/expo install expo-font < /dev/null',
      'echo "[bv] expo install --fix (pin expo-* to SDK versions)..."',
      './node_modules/.bin/expo install --fix < /dev/null',
      'echo "[bv] installing eas-cli..."',
      'npm install -g eas-cli@14 --loglevel=error --no-audit --no-fund',
      'echo "[bv] whoami..."',
      'eas whoami',
      'echo "[bv] eas init (auto-create project if needed)..."',
      'eas init --non-interactive --force',
      `echo "[bv] submitting ${platform}/${easProfile} build to EAS (this can take 10-30 min)..."`,
      // --json: machine-readable stdout (artifact URLs). Stderr carries
      // live progress — piped through so users see queue/compile stages.
      `eas build --platform ${platform} --profile ${easProfile} --non-interactive --json` +
        ' > /app/eas-build.json',
      'echo "[bv] build completed, JSON output:"',
      'cat /app/eas-build.json',
    ].join(' && ');

    const dockerArgs = [
      'run',
      '--rm',
      '--name',
      containerName,
      '--memory',
      '2g',
      '--cpus',
      '2',
      '-e',
      `EXPO_TOKEN=${expoToken}`,
      '-e',
      `BV_KEYSTORE_PASS=${keystorePassword}`,
      '-e',
      'CI=1',
      '-e',
      'EXPO_NO_TELEMETRY=1',
      '-e',
      // Skip Expo's local git-repo sanity check — we're not in a git repo.
      'EAS_NO_VCS=1',
      '-v',
      `${workDir}:/app`,
      '-v',
      'bv-npm-cache:/root/.npm',
      '-w',
      '/app',
      EAS_CLOUD_IMAGE,
      'sh',
      '-c',
      easBuildCommand,
    ];

    const exitCode = await this.runWithLogStreaming(
      projectId,
      dockerArgs,
      CLOUD_BUILD_TIMEOUT_MS,
      { redact: [expoToken, keystorePassword] },
    );

    if (exitCode !== 0) {
      throw new Error(
        `EAS build failed (exit code ${exitCode}). Check the build log for details.`,
      );
    }

    // Read the build JSON output to get the artifact URL. Prefer the
    // file the container wrote (guaranteed complete JSON) and fall back
    // to scraping the streamed log buffer.
    const easJsonOutPath = path.join(workDir, 'eas-build.json');
    const artifactUrl =
      (await this.readArtifactUrlFromFile(easJsonOutPath).catch(() => null)) ||
      this.parseArtifactUrlFromBuffer(projectId);

    if (!artifactUrl) {
      throw new Error(
        'EAS build completed but artifact URL could not be parsed from output. ' +
          "This usually means the build failed on Expo's side — open your Expo " +
          'dashboard (https://expo.dev/accounts/...) to inspect the build log.',
      );
    }

    const ext = this.extensionFor(platform, buildType);
    this.emitProgress(projectId, `Downloading artifact from ${artifactUrl}...`);
    const finalPath = this.getApkPath(projectId, ext);
    await this.downloadFile(artifactUrl, finalPath);
    const stat = await fs.stat(finalPath);

    await this.cleanupWorkDir(workDir);

    await this.markReady(projectId, 'cloud', stat.size, platform, buildType);
  }

  /** Buffered last N lines of the most recent build — used to extract
   *  the artifact URL from EAS JSON output since we stream logs and
   *  cannot cat a container-local file after the container exits. */
  private readonly logBuffers = new Map<string, string[]>();

  private parseArtifactUrlFromBuffer(projectId: string): string | null {
    const buf = this.logBuffers.get(projectId);
    if (!buf) return null;
    const joined = buf.join('\n');
    // EAS --json output includes { "artifacts": { "buildUrl": "https://..." } }
    // or { "artifacts": { "applicationArchiveUrl": "https://..." } }
    const candidates = [
      /"applicationArchiveUrl"\s*:\s*"([^"]+)"/,
      /"buildUrl"\s*:\s*"([^"]+)"/,
      /"artifactUrl"\s*:\s*"([^"]+)"/,
    ];
    for (const re of candidates) {
      const m = joined.match(re);
      if (m && m[1].startsWith('http')) return m[1];
    }
    return null;
  }

  /** Extract a dashboard URL to the EAS build page from streamed logs
   *  (`https://expo.dev/accounts/<user>/projects/<slug>/builds/<uuid>`).
   *  Used to give the user a clickable link when a cloud build fails. */
  private parseEasBuildUrlFromBuffer(projectId: string): string | null {
    const buf = this.logBuffers.get(projectId);
    if (!buf) return null;
    const joined = buf.join('\n');
    const m = joined.match(
      /https:\/\/expo\.dev\/accounts\/[^/\s]+\/projects\/[^/\s]+\/builds\/[0-9a-f-]{36}/,
    );
    return m?.[0] ?? null;
  }

  private async readArtifactUrlFromFile(
    filePath: string,
  ): Promise<string | null> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const json: unknown = JSON.parse(raw);
      const visit = (node: unknown): string | null => {
        if (!node || typeof node !== 'object') return null;
        const obj = node as Record<string, unknown>;
        for (const key of [
          'applicationArchiveUrl',
          'buildUrl',
          'artifactUrl',
        ]) {
          const v = obj[key];
          if (typeof v === 'string' && v.startsWith('http')) return v;
        }
        for (const v of Object.values(obj)) {
          const hit = visit(v);
          if (hit) return hit;
        }
        return null;
      };
      return visit(json);
    } catch {
      return null;
    }
  }

  private downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tick = (resolvedUrl: string, hops: number) => {
        if (hops > 5) {
          reject(new Error('Too many redirects'));
          return;
        }
        https
          .get(resolvedUrl, (res) => {
            if (
              res.statusCode &&
              res.statusCode >= 300 &&
              res.statusCode < 400 &&
              res.headers.location
            ) {
              res.resume();
              tick(
                new URL(res.headers.location, resolvedUrl).toString(),
                hops + 1,
              );
              return;
            }
            if (res.statusCode !== 200) {
              res.resume();
              reject(new Error(`Download failed: HTTP ${res.statusCode}`));
              return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
              fs.writeFile(destPath, Buffer.concat(chunks))
                .then(() => resolve())
                .catch(reject);
            });
            res.on('error', reject);
          })
          .on('error', reject);
      };
      tick(url, 0);
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Shared helpers
  // ─────────────────────────────────────────────────────────────────────

  private async fetchAndWriteFiles(
    projectId: string,
  ): Promise<Array<{ path: string; content: string }>> {
    const files = await this.prisma.projectFile.findMany({
      where: { projectId },
      select: { path: true, content: true },
    });
    if (files.length === 0) {
      throw new Error(
        'Project has no files — cannot build APK. Start a preview first to seed the template.',
      );
    }

    const workDir = this.getWorkDir(projectId);
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      try {
        await execFileAsync(
          'docker',
          [
            'run',
            '--rm',
            '-v',
            `${workDir}:/cleanup`,
            'node:20-alpine',
            'sh',
            '-c',
            'rm -rf /cleanup/*',
          ],
          { timeout: 15000 },
        );
        await fs.rm(workDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
    await fs.mkdir(workDir, { recursive: true });
    await fs.chmod(workDir, 0o700);

    for (const file of files) {
      const filePath = path.join(workDir, file.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.content);
    }

    // Auto-migrate older projects (SDK 52 / 53) forward so the build
    // environment and the user's Expo Go install line up. Silent no-op
    // when the project is already on the target SDK.
    await upgradeProjectToTargetSdk(workDir);

    return files;
  }

  private async patchAppJson(
    projectId: string,
    workDir: string,
  ): Promise<void> {
    try {
      const appJsonPath = path.join(workDir, 'app.json');
      const raw = await fs.readFile(appJsonPath, 'utf8');
      const parsed = JSON.parse(raw) as {
        expo?: {
          icon?: unknown;
          splash?: unknown;
          android?: {
            package?: string;
            adaptiveIcon?: unknown;
            icon?: unknown;
          };
          ios?: { bundleIdentifier?: string; icon?: unknown };
        };
      };
      parsed.expo ??= {};
      parsed.expo.android ??= {};
      parsed.expo.ios ??= {};
      const pkgSuffix = projectId.replace(/-/g, '').slice(0, 12);
      parsed.expo.android.package = `com.bolderai.p${pkgSuffix}`;
      parsed.expo.ios.bundleIdentifier = `com.bolderai.p${pkgSuffix}`;
      delete parsed.expo.icon;
      delete parsed.expo.splash;
      delete parsed.expo.android.adaptiveIcon;
      delete parsed.expo.android.icon;
      delete parsed.expo.ios.icon;
      await fs.writeFile(appJsonPath, JSON.stringify(parsed, null, 2));
      this.emitProgress(
        projectId,
        `Patched app.json: package=com.bolderai.p${pkgSuffix}`,
      );
    } catch (err) {
      this.logger.warn(
        `Could not patch app.json for ${projectId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async cleanupWorkDir(workDir: string): Promise<void> {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      try {
        await execFileAsync(
          'docker',
          [
            'run',
            '--rm',
            '-v',
            `${workDir}:/cleanup`,
            'node:20-alpine',
            'sh',
            '-c',
            'rm -rf /cleanup/*',
          ],
          { timeout: 15000 },
        );
        await fs.rm(workDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  }

  private async removeContainer(name: string): Promise<void> {
    try {
      await execFileAsync('docker', ['rm', '-f', name], { timeout: 10000 });
    } catch {
      /* not present */
    }
  }

  /** Spawn a docker command and stream its output as build_progress events.
   *  Resolves with the exit code when the process finishes. */
  private runWithLogStreaming(
    projectId: string,
    dockerArgs: string[],
    timeoutMs: number,
    opts?: { redact?: string[] },
  ): Promise<number> {
    const redactions = opts?.redact?.filter((s) => !!s) ?? [];
    this.logBuffers.set(projectId, []);
    return new Promise((resolve) => {
      const child = spawn('docker', dockerArgs);

      const killTimer = setTimeout(() => {
        this.logger.warn(
          `APK build timed out after ${timeoutMs}ms for ${projectId}; killing container.`,
        );
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        execFile(
          'docker',
          ['rm', '-f', this.getContainerName(projectId)],
          () => {
            /* best-effort */
          },
        );
      }, timeoutMs);

      const onData = (data: Buffer) => {
        let text = data.toString();
        for (const secret of redactions) {
          if (secret) {
            text = text.split(secret).join('••••REDACTED••••');
          }
        }
        const buf = this.logBuffers.get(projectId);
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          if (buf) {
            buf.push(line);
            // Cap buffer to prevent unbounded memory growth on noisy builds.
            if (buf.length > 2000) buf.splice(0, buf.length - 2000);
          }
          this.emitProgress(projectId, line);
        }
      };

      child.stdout.on('data', onData);
      child.stderr.on('data', onData);

      child.on('error', (err) => {
        this.logger.error(`Docker spawn error: ${err.message}`);
        clearTimeout(killTimer);
        resolve(1);
      });

      child.on('close', (code) => {
        clearTimeout(killTimer);
        resolve(code ?? 1);
      });
    });
  }

  private emitProgress(projectId: string, line: string): void {
    this.gateway.emitToProject(projectId, 'apk:build_progress', {
      projectId,
      line,
      timestamp: new Date().toISOString(),
    });
  }

  private async markReady(
    projectId: string,
    mode: ApkBuildMode,
    sizeBytes: number,
    platform: ApkBuildPlatform = 'android',
    buildType: AndroidBuildType = 'apk',
  ): Promise<void> {
    const builtAt = new Date().toISOString();
    const downloadUrl = `/api/v1/projects/${projectId}/apk/download`;
    const resolvedBuildType =
      platform === 'ios' ? ('simulator' as const) : buildType;
    const safeId = projectId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 8);
    const ext = this.extensionFor(platform, buildType);
    const filename = `app-${safeId}.${ext}`;
    const readyState: ApkBuildState = {
      projectId,
      status: ApkBuildStatus.READY,
      mode,
      platform,
      buildType: resolvedBuildType,
      downloadUrl,
      sizeBytes,
      builtAt,
      filename,
    };
    await this.redis.set(
      `apk:${projectId}`,
      JSON.stringify(readyState),
      'EX',
      REDIS_TTL_SECONDS,
    );
    this.gateway.emitToProject(projectId, 'apk:build_ready', {
      projectId,
      downloadUrl,
      sizeBytes,
      builtAt,
      mode,
      platform,
      buildType: resolvedBuildType,
      filename,
    });
    this.logger.log(
      `Build ready for ${projectId} (${(sizeBytes / 1024 / 1024).toFixed(
        1,
      )} MB, ${mode}/${platform}/${resolvedBuildType})`,
    );
  }

  private async markError(
    projectId: string,
    error: string,
    mode: ApkBuildMode,
    easBuildUrl?: string,
    platform: ApkBuildPlatform = 'android',
    buildType?: ApkBuildState['buildType'],
  ): Promise<void> {
    const state: ApkBuildState = {
      projectId,
      status: ApkBuildStatus.ERROR,
      mode,
      platform,
      buildType,
      error,
      easBuildUrl,
    };
    await this.redis.set(
      `apk:${projectId}`,
      JSON.stringify(state),
      'EX',
      REDIS_TTL_SECONDS,
    );
    this.gateway.emitToProject(projectId, 'apk:build_error', {
      projectId,
      error,
      mode,
      platform,
      buildType,
      easBuildUrl,
    });
  }
}
