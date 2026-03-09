import { ExecutionResult, SandboxConfig } from '../sandbox.interface.js';

export interface Runner {
  execute(
    projectId: string,
    command: string,
    config?: Partial<SandboxConfig>,
  ): Promise<ExecutionResult>;

  cleanup(projectId: string): Promise<void>;
}

export const RUNNER_TOKEN = 'RUNNER_TOKEN';
