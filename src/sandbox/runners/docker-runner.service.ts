import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
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
    } catch (error: any) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
        durationMs: Date.now() - start,
      };
    }
  }

  async cleanup(projectId: string): Promise<void> {
    const containerName = `bv-sandbox-${projectId.slice(0, 8)}`;
    try {
      await execFileAsync('docker', ['rm', '-f', containerName]);
    } catch {
      // Container may not exist
    }
  }
}
