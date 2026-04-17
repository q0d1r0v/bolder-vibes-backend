import { ExecutionResult, SandboxConfig } from '../sandbox.interface.js';

export interface Runner {
  execute(
    projectId: string,
    command: string,
    config?: Partial<SandboxConfig>,
  ): Promise<ExecutionResult>;

  startLongRunning?(
    projectId: string,
    workDir: string,
    command: string,
    config?: Partial<SandboxConfig>,
    containerPort?: number,
  ): Promise<{ containerId: string; port: number; reused?: boolean }>;

  cleanup(projectId: string): Promise<void>;

  execInContainer?(
    projectId: string,
    command: string,
    timeoutMs?: number,
  ): Promise<{ stdout: string; stderr: string }>;

  streamLogs?(
    projectId: string,
    onLog: (line: string) => void,
  ): { stop: () => void };

  getContainerLogs?(projectId: string): Promise<string>;

  containerExists?(projectId: string): Promise<boolean>;

  createNetwork?(name: string): Promise<void>;
  startDatabase?(
    projectId: string,
    networkName: string,
    dbPassword?: string,
  ): Promise<{ containerId: string }>;
  stopDatabase?(projectId: string): Promise<void>;
  removeNetwork?(name: string): Promise<void>;
}

export const RUNNER_TOKEN = 'RUNNER_TOKEN';
