export enum PreviewStatus {
  IDLE = 'idle',
  BUILDING = 'building',
  READY = 'ready',
  ERROR = 'error',
}

export interface PreviewState {
  projectId: string;
  status: PreviewStatus;
  url?: string;
  error?: string;
  startedAt?: Date;
}

/** Native (Expo Go tunnel) preview state — tracked separately from
 *  the web preview so both can run concurrently for the same project. */
export interface NativePreviewState {
  projectId: string;
  status: PreviewStatus;
  /** `exp://...` URL that Expo Go can open. */
  expoUrl?: string;
  error?: string;
  startedAt?: Date;
}

export enum ApkBuildStatus {
  IDLE = 'idle',
  BUILDING = 'building',
  READY = 'ready',
  ERROR = 'error',
}

/** Where the build actually runs:
 *  - 'local' — inside the backend's Docker builder image
 *  - 'cloud' — submitted to Expo's EAS Build service using the user's PAT
 */
export type ApkBuildMode = 'local' | 'cloud';

/** Android artifact type: APK is directly installable; AAB is Play Store
 *  upload format. AAB is cloud-only (Gradle `bundleRelease` path). */
export type AndroidBuildType = 'apk' | 'aab';

/** Target platform. iOS builds are cloud-only (Linux hosts cannot build
 *  native iOS artefacts) and produce a simulator `.tar.gz` by default so
 *  no Apple Developer account is required. */
export type ApkBuildPlatform = 'android' | 'ios';

export interface ApkBuildState {
  projectId: string;
  status: ApkBuildStatus;
  mode?: ApkBuildMode;
  platform?: ApkBuildPlatform;
  buildType?: AndroidBuildType | 'simulator' | 'archive';
  /** Relative HTTP path (local) OR absolute signed URL (cloud) that the
   *  frontend can GET to download the artifact. */
  downloadUrl?: string;
  sizeBytes?: number;
  error?: string;
  builtAt?: string;
  /** For cloud builds: link to the Expo dashboard page for this build so
   *  the user can inspect full logs when something goes wrong. */
  easBuildUrl?: string;
  /** Suggested filename for the downloaded artifact (extension varies). */
  filename?: string;
}

export interface FrameworkConfig {
  /** Docker image tag to run the preview container from. */
  image: string;
  installCommand: string;
  devCommand: string;
  containerPort: number;
}

/** Canonical Expo preview image — built by docker/expo-preview/build.sh.
 *  Contains pre-installed node_modules AND a warm Metro transform cache. */
export const BV_EXPO_IMAGE = 'bv-expo-preview:latest';

// CRITICAL ENV FOR LIVE HMR:
//   CI=1                 — NEVER set. Disables Metro's file watcher.
//                          Log: "Metro is running in CI mode, reloads
//                          are disabled."
//   CHOKIDAR_USEPOLLING   — force chokidar (Metro's watcher) to poll
//                          the filesystem every 300ms instead of
//                          relying on inotify events. Inotify does NOT
//                          cross the Linux host ↔ container bind-mount
//                          boundary reliably (it's a kernel-local
//                          mechanism), so Metro misses file writes
//                          without polling and HMR breaks.
//   WATCHPACK_POLLING     — the webpack-based web bundler used by
//                          `expo start --web` uses watchpack. Same
//                          root cause as chokidar — needs polling.
//   EXPO_OFFLINE=1        — skips the Expo CLI's network calls to
//                          api.expo.dev (bundled native-module version
//                          validation). Those calls fail inside our
//                          sandbox containers and crash `expo start`.
//   --non-interactive     — replaces the `CI=1` job of suppressing
//                          terminal prompts without disabling HMR.
//   `< /dev/null`          — belts & braces: even if --non-interactive
//                          is dropped by a future Expo CLI, a closed
//                          stdin guarantees no prompt can ever hang.
//
// Metro binds to 0.0.0.0 by default, so no --host flag is needed for
// Docker port-mapping to work.
const WATCH_POLLING_ENV =
  'CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=300 WATCHPACK_POLLING=300';

// `--clear` blows away Metro's transform + haste cache on startup, so
// the very first bundle always comes from the latest on-disk files —
// crucial after a project restart where the previous cache might still
// point at stale module paths.
const EXPO_WEB_CMD =
  `unset CI && ${WATCH_POLLING_ENV} EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 ` +
  `npx expo start --web --port 3000 --clear < /dev/null`;

// Fullstack variant — Expo binds to 3100 (internal). A thin reverse
// proxy on 3000 (see PROXY_SCRIPT below) fronts both Metro and the
// backend so the browser iframe can reach everything same-origin:
//   • /api/*  → localhost:3001  (Express backend)
//   • /*      → localhost:3100  (Metro dev server, incl. HMR websockets)
//
// Same-origin makes AI-generated code trivial — `fetch('/api/todos')`
// just works, no CORS, no hostname gymnastics, no per-container env
// injection. Scales to N concurrent containers with zero host-side
// port bookkeeping beyond the usual 3000→random mapping.
const EXPO_WEB_CMD_PROXIED =
  `unset CI && ${WATCH_POLLING_ENV} EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 ` +
  `npx expo start --web --port 3100 --clear < /dev/null`;

// Native preview command — spins up Metro in tunnel mode so a real
// phone running Expo Go can connect from anywhere on the public
// internet. Tunnel mode needs to reach Expo's ngrok relay service, so
// we don't set EXPO_OFFLINE here. Metro listens on port 8081 for the
// bundler.
const EXPO_NATIVE_CMD =
  `unset CI && ${WATCH_POLLING_ENV} EXPO_NO_TELEMETRY=1 ` +
  `npx expo start --tunnel --port 8081 --clear < /dev/null`;

// Runtime install flow (runs inside the bv-expo-preview container).
//
// /app is a host bind mount, /bv-meta lives in the image layer — they
// are on DIFFERENT filesystems, so hardlinks (cp -al) and symlinks both
// fail for our purpose:
//   - cp -al → "Cross-device link" error
//   - ln -s  → Metro resolves via realpath, so relative imports inside
//     node_modules (e.g. AppEntry.js doing `import '../../App'`) land
//     in /bv-meta/App instead of the user's /app/App.tsx, breaking the
//     bundle.
//
// We therefore do a real recursive copy from /bv-meta/node_modules into
// /app/node_modules on every cold start. For ~900 pre-installed packages
// this takes ~5-15s on SSD — slower than a symlink but fast enough to
// hit the 10-20s SLA when combined with the warm Metro transform cache,
// and it keeps the user's node_modules fully isolated from the shared
// baked tree (no cross-project pollution on writes).
//
// After the copy, we still run the SHA guard to decide whether an
// `npm install` reconcile is needed. The guard hashes the parsed and
// sorted `dependencies` object, not the raw file bytes, so whitespace
// differences in the user's package.json do not cause spurious misses.
// Align package.json against baked /bv-meta/baked-pkg.json so every
// package the image already holds is pinned to the exact version the
// baked node_modules was built with. This is what saves us from AI
// hallucinations like `expo-font@~15.0.0` (doesn't exist) or
// `expo-font@~14.1.0` (also doesn't exist) — we don't have to guess
// the right SDK version by hand because the image already knows.
//
// The canonical file is at `/bv-meta/baked-pkg.json` because the baked
// Dockerfile renames it on purpose — /app/package.json itself is a
// bind-mount at runtime, so we stash the canonical copy under a
// non-conflicting name inside /bv-meta.
//
// The script:
//   1. Loads /bv-meta/baked-pkg.json (canonical SDK dep versions).
//   2. Loads /app/package.json (user's project).
//   3. For every dep the user declares that ALSO lives in baked, it
//      rewrites to the baked version.
//   4. Deps the baked image doesn't know about (e.g. zustand, lodash,
//      anything the AI added) are left untouched — npm install will
//      resolve those from the registry.
//   5. A plain try/catch keeps any JSON glitch non-fatal; install will
//      still run, just without the auto-align safety net.
const ALIGN_VERSIONS_WITH_BAKED =
  'node -e "' +
  'try{' +
  "const fs=require('fs');" +
  "const baked=require('/bv-meta/baked-pkg.json').dependencies||{};" +
  "const p='/app/package.json';" +
  "const u=JSON.parse(fs.readFileSync(p,'utf8'));" +
  'u.dependencies=u.dependencies||{};' +
  'let n=0;' +
  'for(const k of Object.keys(u.dependencies)){' +
  'if(baked[k]&&baked[k]!==u.dependencies[k]){u.dependencies[k]=baked[k];n++;}' +
  '}' +
  "if(n){fs.writeFileSync(p,JSON.stringify(u,null,2));console.log('[bv] aligned '+n+' dep version(s) with baked image');}" +
  "}catch(e){console.error('[bv] version align skipped:',e.message);}" +
  '"';

const EXPO_INSTALL =
  // Replace any leftover symlink/partial node_modules from previous runs,
  // then seed from the baked image via a real recursive copy.
  'if [ -L /app/node_modules ]; then rm /app/node_modules; fi && ' +
  'if [ ! -d /app/node_modules ] && [ -d /bv-meta/node_modules ]; then ' +
  "  echo '[bv] seeding node_modules from baked image (cp -a)...'; " +
  '  cp -a /bv-meta/node_modules /app/node_modules; ' +
  'fi && ' +
  // Align user's declared versions with what's actually in the baked
  // image — see comment on ALIGN_VERSIONS_WITH_BAKED.
  `${ALIGN_VERSIONS_WITH_BAKED} && ` +
  // Re-compute SHAs AFTER alignment so the skip-install fast path kicks
  // in when the user's project matches baked exactly.
  'BAKED_SHA=$(cat /bv-meta/baked-pkg-sha 2>/dev/null || echo "") && ' +
  "USER_SHA=$(node -e \"const d=require('/app/package.json').dependencies||{};" +
  "const h=require('crypto').createHash('sha256');" +
  'h.update(JSON.stringify(d,Object.keys(d).sort()));' +
  'process.stdout.write(h.digest(\'hex\'))" 2>/dev/null || echo "") && ' +
  'if [ -n "$BAKED_SHA" ] && [ "$USER_SHA" = "$BAKED_SHA" ]; then ' +
  "  echo '[bv] deps match baked image — skipping install'; " +
  'else ' +
  // `--legacy-peer-deps` accepts imperfect peer-dep satisfaction instead
  // of failing with ERESOLVE. AI-generated projects occasionally drift
  // a minor version across expo-* packages, and we'd rather see a
  // runtime warning than a preview that refuses to start at all.
  '  npm install --legacy-peer-deps --prefer-offline --no-audit --no-fund; ' +
  'fi';

/** Native preview config for Expo Go over tunnel. */
export const EXPO_NATIVE_CONFIG: FrameworkConfig = {
  image: BV_EXPO_IMAGE,
  installCommand: EXPO_INSTALL,
  devCommand: EXPO_NATIVE_CMD,
  containerPort: 8081,
};

/**
 * Reverse-proxy script injected into fullstack/backend preview containers.
 *
 * Architecture in those containers:
 *   - Port 3100 (internal): Metro dev server (Expo web)
 *   - Port 3001 (internal): Express backend
 *   - Port 3000 (exposed):  this proxy — same-origin gateway
 *
 * The browser iframe only ever talks to port 3000, so AI-generated
 * `fetch('/api/todos')` calls work without CORS, without env injection,
 * and without guessing the host-mapped backend port (which doesn't
 * exist — we only publish one port per container).
 *
 * Uses Node built-ins only (http + net) so it runs on any baked image
 * without extra deps. Handles both HTTP proxying and WS upgrades (Metro's
 * HMR runs over a WebSocket on the same port).
 *
 * Written to /app/bv-proxy.js at build time by preview.service.ts.
 */
export const PROXY_SCRIPT = `// Auto-generated by Bolder Vibes preview service.
// Same-origin reverse proxy: /api/* -> :3001, everything else -> :3100.
/* eslint-disable */
const http = require('http');
const net = require('net');

const isApi = (u) => u === '/api' || u.startsWith('/api/');
const upstream = (u) => (isApi(u) ? 3001 : 3100);

const server = http.createServer((req, res) => {
  const port = upstream(req.url);
  const opts = {
    hostname: '127.0.0.1',
    port,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };
  const pReq = http.request(opts, (pRes) => {
    res.writeHead(pRes.statusCode || 502, pRes.headers);
    pRes.pipe(res);
  });
  pReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain' });
    }
    res.end('[bv-proxy] upstream :' + port + ' error: ' + err.message);
  });
  req.pipe(pReq);
});

server.on('upgrade', (req, socket, head) => {
  const port = upstream(req.url);
  const up = net.connect(port, '127.0.0.1', () => {
    const lines = [req.method + ' ' + req.url + ' HTTP/1.1'];
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) {
        for (const vv of v) lines.push(k + ': ' + vv);
      } else if (v !== undefined) {
        lines.push(k + ': ' + v);
      }
    }
    up.write(lines.join('\\r\\n') + '\\r\\n\\r\\n');
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', () => { try { socket.end(); } catch (_) {} });
  socket.on('error', () => { try { up.end(); } catch (_) {} });
});

server.on('clientError', (err, socket) => {
  try { socket.end('HTTP/1.1 400 Bad Request\\r\\n\\r\\n'); } catch (_) {}
});

server.listen(3000, '0.0.0.0', () => {
  console.log('[bv-proxy] listening on :3000 (/api -> :3001, /* -> :3100)');
});

process.on('SIGTERM', () => process.exit(0));
`;

/** Boot the proxy as a background process before Metro/backend start. */
const PROXY_BOOT = 'node /app/bv-proxy.js &';

export const FRAMEWORK_CONFIGS: Record<string, FrameworkConfig> = {
  expo: {
    image: BV_EXPO_IMAGE,
    installCommand: EXPO_INSTALL,
    devCommand: EXPO_WEB_CMD,
    containerPort: 3000,
  },
  'expo-navigation': {
    image: BV_EXPO_IMAGE,
    installCommand: EXPO_INSTALL,
    devCommand: EXPO_WEB_CMD,
    containerPort: 3000,
  },
  'expo-backend': {
    image: BV_EXPO_IMAGE,
    installCommand: `${EXPO_INSTALL} && (cd server && ${EXPO_INSTALL})`,
    // Proxy fronts port 3000, backend on 3001, Metro on 3100.
    devCommand:
      `${PROXY_BOOT} ` +
      `(cd /app/server && PORT=3001 HOST=0.0.0.0 npm run dev) & ` +
      `${EXPO_WEB_CMD_PROXIED}`,
    containerPort: 3000,
  },
  'expo-fullstack': {
    image: BV_EXPO_IMAGE,
    // Prisma setup (generate + db push) is appended dynamically by
    // buildAndStart() only when a schema.prisma file actually exists.
    installCommand: `${EXPO_INSTALL} && (cd server && ${EXPO_INSTALL})`,
    devCommand:
      `${PROXY_BOOT} ` +
      `(cd /app/server && PORT=3001 HOST=0.0.0.0 npm run dev) & ` +
      `${EXPO_WEB_CMD_PROXIED}`,
    containerPort: 3000,
  },
};
