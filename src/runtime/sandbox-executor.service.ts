import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';

import { getAppConfig } from '@/config/app.config';
import { RuntimeCommandFactory } from '@/runtime/runtime-command.factory';

type CommandExecutionResult = {
  command: string[];
  stdout: string;
  stderr: string;
};

@Injectable()
export class SandboxExecutorService {
  private readonly config = getAppConfig();
  private readonly logger = new Logger(SandboxExecutorService.name);

  constructor(private readonly runtimeCommandFactory: RuntimeCommandFactory) {}

  async startProject(
    projectId: string,
    requestedPort?: number,
    forceRebuild?: boolean,
  ) {
    const commandSet = this.runtimeCommandFactory.build(
      projectId,
      requestedPort,
    );
    const outputs: CommandExecutionResult[] = [];

    if (!this.config.runtimeExecutionEnabled) {
      return {
        executed: false,
        commands: [commandSet.buildArgs, commandSet.startArgs],
      };
    }

    if (forceRebuild) {
      outputs.push(await this.runCommand(commandSet.buildArgs));
    }

    outputs.push(await this.runCommand(commandSet.startArgs));
    return {
      executed: true,
      commands: outputs,
    };
  }

  async stopProject(projectId: string, requestedPort?: number) {
    const commandSet = this.runtimeCommandFactory.build(
      projectId,
      requestedPort,
    );

    if (!this.config.runtimeExecutionEnabled) {
      return {
        executed: false,
        commands: [commandSet.stopArgs, commandSet.removeArgs],
      };
    }

    const results: CommandExecutionResult[] = [];

    try {
      results.push(await this.runCommand(commandSet.stopArgs));
    } catch (error) {
      this.logger.warn(
        `docker stop failed for ${projectId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }

    results.push(await this.runCommand(commandSet.removeArgs));

    return {
      executed: true,
      commands: results,
    };
  }

  async restartProject(
    projectId: string,
    requestedPort?: number,
    forceRebuild?: boolean,
  ) {
    await this.stopProject(projectId, requestedPort);
    return this.startProject(projectId, requestedPort, forceRebuild);
  }

  private runCommand(command: string[]) {
    return new Promise<CommandExecutionResult>((resolve, reject) => {
      const [binary, ...args] = command;
      const child = spawn(binary, args, {
        env: process.env,
      });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({
            command,
            stdout,
            stderr,
          });
          return;
        }

        reject(
          new Error(
            `Command "${command.join(' ')}" failed with code ${code}. ${stderr}`,
          ),
        );
      });
    });
  }
}
