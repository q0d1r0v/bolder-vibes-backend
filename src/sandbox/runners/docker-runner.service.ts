import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createServer } from 'net';
import {
  ExecutionResult,
  SandboxConfig,
  DEFAULT_SANDBOX_CONFIG,
} from '../sandbox.interface.js';
import { Runner } from './runner.interface.js';

const execFileAsync = promisify(execFile);

@Injectable()
export class DockerRunnerService implements Runner {
  private readonly logger = new Logger(DockerRunnerService.name);

  async execute(
    projectId: string,
    command: string,
    config?: Partial<SandboxConfig>,
  ): Promise<ExecutionResult> {
    const cfg = { ...DEFAULT_SANDBOX_CONFIG, ...config };
    const containerName = `bv-sandbox-${projectId.slice(0, 8)}`;
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
  ): Promise<{ containerId: string; port: number }> {
    const cfg = { ...DEFAULT_SANDBOX_CONFIG, ...config };
    const containerName = `bv-preview-${projectId.slice(0, 8)}`;
    const hostPort = await this.findAvailablePort();

    // Remove any existing container with same name
    try {
      await execFileAsync('docker', ['rm', '-f', containerName]);
    } catch {
      // Container may not exist
    }

    const args = [
      'run',
      '-d',
      '--name',
      containerName,
      '--memory',
      `${cfg.maxMemoryMb}m`,
      '--cpus',
      `${cfg.maxCpuPercent / 100}`,
      '-v',
      `${workDir}:/app`,
      '-w',
      '/app',
      '-p',
      `${hostPort}:3000`,
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

  async getContainerLogs(projectId: string): Promise<string> {
    const containerName = `bv-preview-${projectId.slice(0, 8)}`;
    try {
      const { stdout } = await execFileAsync('docker', [
        'logs',
        '--tail',
        '50',
        containerName,
      ]);
      return stdout;
    } catch {
      return '';
    }
  }

  async cleanup(projectId: string): Promise<void> {
    const sandboxName = `bv-sandbox-${projectId.slice(0, 8)}`;
    const previewName = `bv-preview-${projectId.slice(0, 8)}`;
    for (const name of [sandboxName, previewName]) {
      try {
        await execFileAsync('docker', ['rm', '-f', name]);
      } catch {
        // Container may not exist
      }
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
