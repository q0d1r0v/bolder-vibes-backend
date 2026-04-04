import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { createServer } from 'net';
import {
  ExecutionResult,
  SandboxConfig,
  DEFAULT_SANDBOX_CONFIG,
} from '../sandbox.interface.js';
import { Runner } from './runner.interface.js';
import { sanitizeCommand } from '../command-sanitizer.js';

const execFileAsync = promisify(execFile);

/**
 * Generates a deterministic but collision-safe container suffix from projectId.
 * Uses full UUID (hyphens removed) to prevent cross-project collisions.
 */
function containerSuffix(projectId: string): string {
  return projectId.replace(/-/g, '');
}

@Injectable()
export class DockerRunnerService implements Runner {
  private readonly logger = new Logger(DockerRunnerService.name);

  // Track active log streams so we can clean them up
  private readonly activeLogStreams = new Map<string, { stop: () => void }>();

  async execute(
    projectId: string,
    command: string,
    config?: Partial<SandboxConfig>,
  ): Promise<ExecutionResult> {
    const sanitization = sanitizeCommand(command);
    if (!sanitization.isValid) {
      throw new BadRequestException(sanitization.error);
    }

    const cfg = { ...DEFAULT_SANDBOX_CONFIG, ...config };
    const suffix = containerSuffix(projectId);
    const containerName = `bv-sandbox-${suffix}`;
    const start = Date.now();

    try {
      const args = [
        'run',
        '--rm',
        '--name',
        containerName,
        '--memory',
        `${cfg.maxMemoryMb}m`,
        '--cpus',
        `${cfg.maxCpuPercent / 100}`,
        ...(cfg.networkEnabled ? [] : ['--network', 'none']),
        '--read-only',
        '--tmpfs',
        '/tmp:rw,size=100m',
        'node:20-alpine',
        'sh',
        '-c',
        command,
      ];

      const { stdout, stderr } = await execFileAsync('docker', args, {
        timeout: cfg.timeoutMs,
      });

      return {
        stdout,
        stderr,
        exitCode: 0,
        durationMs: Date.now() - start,
      };
    } catch (error: unknown) {
      const err = error as Record<string, unknown>;
      return {
        stdout: (err.stdout as string) || '',
        stderr: (err.stderr as string) || (err.message as string) || 'Unknown error',
        exitCode: (err.code as number) || 1,
        durationMs: Date.now() - start,
      };
    }
  }

  async startLongRunning(
    projectId: string,
    workDir: string,
    command: string,
    config?: Partial<SandboxConfig>,
    containerPort?: number,
  ): Promise<{ containerId: string; port: number }> {
    const cfg = { ...DEFAULT_SANDBOX_CONFIG, ...config };
    const suffix = containerSuffix(projectId);
    const containerName = `bv-preview-${suffix}`;
    const hostPort = await this.findAvailablePort();

    // Force remove any existing container with same name
    await this.forceRemoveContainer(containerName);

    // Pull image first to avoid timeout issues
    try {
      await execFileAsync('docker', ['image', 'inspect', 'node:20-alpine']);
    } catch {
      this.logger.log('Pulling node:20-alpine image...');
      await execFileAsync('docker', ['pull', 'node:20-alpine'], {
        timeout: 300000,
      });
    }

    // Build env var flags
    const envFlags: string[] = [];
    if (cfg.envVars) {
      for (const [key, value] of Object.entries(cfg.envVars)) {
        envFlags.push('-e', `${key}=${value}`);
      }
    }

    // Build network flags
    const networkFlags: string[] = [];
    if (cfg.dockerNetwork) {
      networkFlags.push('--network', cfg.dockerNetwork);
    }

    // Ensure shared npm cache volume exists (created once, reused by all containers)
    await this.ensureNpmCacheVolume();

    const args = [
      'run',
      '-d',
      '--name',
      containerName,
      '--memory',
      `${cfg.maxMemoryMb}m`,
      '--cpus',
      `${cfg.maxCpuPercent / 100}`,
      ...networkFlags,
      ...envFlags,
      '-v',
      `${workDir}:/app`,
      '-v',
      'bv-npm-cache:/root/.npm',  // Shared npm cache across all preview containers
      '-w',
      '/app',
      '-p',
      `${hostPort}:${containerPort ?? 3000}`,
      'node:20-alpine',
      'sh',
      '-c',
      command,
    ];

    const { stdout } = await execFileAsync('docker', args, {
      timeout: cfg.timeoutMs,
    });

    this.logger.log(
      `Preview container started: ${containerName} on port ${hostPort}`,
    );

    return { containerId: stdout.trim(), port: hostPort };
  }

  private async forceRemoveContainer(name: string): Promise<void> {
    try {
      await execFileAsync('docker', ['stop', name], { timeout: 10000 });
    } catch {
      // Container may not exist or already stopped
    }
    try {
      await execFileAsync('docker', ['rm', '-f', name], { timeout: 10000 });
    } catch {
      // Container may not exist
    }
  }

  async execInContainer(
    projectId: string,
    command: string,
    timeoutMs = 120000,
  ): Promise<{ stdout: string; stderr: string }> {
    const suffix = containerSuffix(projectId);
    const containerName = `bv-preview-${suffix}`;
    try {
      const { stdout, stderr } = await execFileAsync(
        'docker',
        ['exec', containerName, 'sh', '-c', command],
        { timeout: timeoutMs },
      );
      this.logger.log(
        `Exec in container ${containerName}: ${command.slice(0, 50)}`,
      );
      return { stdout, stderr };
    } catch (error: unknown) {
      const err = error as Record<string, unknown>;
      this.logger.warn(
        `Exec failed in ${containerName}: ${(err.stderr as string) || (err.message as string) || 'Unknown error'}`,
      );
      return {
        stdout: (err.stdout as string) || '',
        stderr:
          (err.stderr as string) ||
          (err.message as string) ||
          'Unknown error',
      };
    }
  }

  /**
   * Stream container logs in real-time via `docker logs -f`.
   * Returns a handle to stop streaming.
   */
  streamLogs(
    projectId: string,
    onLog: (line: string) => void,
  ): { stop: () => void } {
    // Stop any existing stream for this project
    this.stopLogStream(projectId);

    const suffix = containerSuffix(projectId);
    const containerName = `bv-preview-${suffix}`;

    const child = spawn('docker', ['logs', '-f', '--tail', '100', containerName]);

    const handleData = (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          onLog(line);
        }
      }
    };

    child.stdout.on('data', handleData);
    child.stderr.on('data', handleData);

    child.on('error', (err) => {
      this.logger.debug(`Log stream error for ${containerName}: ${err.message}`);
    });

    child.on('close', () => {
      this.activeLogStreams.delete(projectId);
    });

    const handle = {
      stop: () => {
        child.kill();
        this.activeLogStreams.delete(projectId);
      },
    };

    this.activeLogStreams.set(projectId, handle);
    return handle;
  }

  private stopLogStream(projectId: string): void {
    const existing = this.activeLogStreams.get(projectId);
    if (existing) {
      existing.stop();
    }
  }

  async getContainerLogs(projectId: string): Promise<string> {
    const suffix = containerSuffix(projectId);
    const containerName = `bv-preview-${suffix}`;
    try {
      const { stdout, stderr } = await execFileAsync('docker', [
        'logs',
        '--tail',
        '100',
        containerName,
      ]);
      return stdout + stderr;
    } catch {
      return '';
    }
  }

  async cleanup(projectId: string): Promise<void> {
    // Stop log streaming first
    this.stopLogStream(projectId);

    const suffix = containerSuffix(projectId);
    const sandboxName = `bv-sandbox-${suffix}`;
    const previewName = `bv-preview-${suffix}`;
    for (const name of [sandboxName, previewName]) {
      await this.forceRemoveContainer(name);
    }
    // Also clean up database container and network
    await this.stopDatabase(projectId);
    await this.removeNetwork(`bv-net-${suffix}`);
  }

  async createNetwork(name: string): Promise<void> {
    try {
      await execFileAsync('docker', ['network', 'create', name], {
        timeout: 10000,
      });
      this.logger.log(`Docker network created: ${name}`);
    } catch (error: unknown) {
      const err = error as Record<string, unknown>;
      const stderr = (err.stderr as string) || '';
      if (!stderr.includes('already exists')) {
        throw error;
      }
      this.logger.debug(`Docker network already exists: ${name}`);
    }
  }

  async removeNetwork(name: string): Promise<void> {
    try {
      await execFileAsync('docker', ['network', 'rm', name], {
        timeout: 10000,
      });
      this.logger.log(`Docker network removed: ${name}`);
    } catch {
      // Network may not exist
    }
  }

  async startDatabase(
    projectId: string,
    networkName: string,
    dbPassword?: string,
  ): Promise<{ containerId: string }> {
    const suffix = containerSuffix(projectId);
    const containerName = `bv-db-${suffix}`;
    const password = dbPassword || 'postgres';

    await this.forceRemoveContainer(containerName);

    // Pull postgres image if not present
    try {
      await execFileAsync('docker', [
        'image',
        'inspect',
        'postgres:16-alpine',
      ]);
    } catch {
      this.logger.log('Pulling postgres:16-alpine image...');
      await execFileAsync('docker', ['pull', 'postgres:16-alpine'], {
        timeout: 300000,
      });
    }

    const args = [
      'run',
      '-d',
      '--name',
      containerName,
      '--network',
      networkName,
      '--memory',
      '256m',
      '-e',
      'POSTGRES_USER=postgres',
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      '-e',
      'POSTGRES_DB=app',
      'postgres:16-alpine',
    ];

    const { stdout } = await execFileAsync('docker', args, {
      timeout: 30000,
    });

    this.logger.log(`Database container started: ${containerName}`);
    return { containerId: stdout.trim() };
  }

  async stopDatabase(projectId: string): Promise<void> {
    const suffix = containerSuffix(projectId);
    const containerName = `bv-db-${suffix}`;
    await this.forceRemoveContainer(containerName);
  }

  /**
   * Create the shared npm cache Docker volume if it doesn't already exist.
   * This volume is mounted into every preview container at /root/.npm,
   * so npm install reuses cached packages across all users' previews.
   * Cuts subsequent npm installs from minutes to seconds.
   */
  private async ensureNpmCacheVolume(): Promise<void> {
    try {
      await execFileAsync('docker', ['volume', 'inspect', 'bv-npm-cache'], { timeout: 5000 });
    } catch {
      await execFileAsync('docker', ['volume', 'create', 'bv-npm-cache'], { timeout: 5000 });
      this.logger.log('Created shared npm cache volume: bv-npm-cache');
    }
  }

  private findAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          const port = address.port;
          server.close(() => resolve(port));
        } else {
          server.close(() =>
            reject(new Error('Could not find available port')),
          );
        }
      });
      server.on('error', reject);
    });
  }
}