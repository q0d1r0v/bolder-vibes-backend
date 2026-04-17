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
  envVars?: Record<string, string>;
  dockerNetwork?: string;
  /** Docker image tag. Defaults to `node:20-alpine` for short-lived exec
   *  sandboxes. Long-running previews override this with the pre-warmed
   *  `bv-expo-preview:latest` image. */
  image?: string;
  /** Optional Docker container labels (e.g. project id, pkg SHA) used by
   *  the runner to decide whether an existing container can be reused. */
  labels?: Record<string, string>;
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  timeoutMs: 30000,
  maxMemoryMb: 512,
  maxCpuPercent: 50,
  networkEnabled: false,
};
