export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface SandboxConfig {
  timeoutMs: number;
  maxMemoryMb: number;
  maxCpuPercent: number;
  networkEnabled: boolean;
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  timeoutMs: 30000,
  maxMemoryMb: 512,
  maxCpuPercent: 50,
  networkEnabled: false,
};
