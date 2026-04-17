export interface JoinProjectPayload {
  projectId: string;
}

export interface SendMessagePayload {
  conversationId: string;
  content: string;
  model?: string;
  planMode?: boolean;
}

export interface StopChatPayload {
  conversationId: string;
}

export interface CancelTaskPayload {
  taskId: string;
}

export interface AgentTaskStartedPayload {
  taskId: string;
  prompt: string;
  status: string;
}

export interface AgentStepStartedPayload {
  taskId: string;
  stepId: string;
  agentType: string;
  stepOrder: number;
}

export interface AgentStepProgressPayload {
  taskId: string;
  stepId: string;
  agentType: string;
  partialOutput: string;
}

export interface AgentStepCompletedPayload {
  taskId: string;
  stepId: string;
  agentType: string;
  output: unknown;
  durationMs: number;
}

export interface FileEventPayload {
  fileId: string;
  path: string;
  projectId: string;
  diff?: string;
  versionId?: string;
}

export interface NativePreviewStartingPayload {
  projectId: string;
}

export interface NativePreviewReadyPayload {
  projectId: string;
  expoUrl: string;
}

export interface NativePreviewErrorPayload {
  projectId: string;
  error: string;
}

export interface NativePreviewStoppedPayload {
  projectId: string;
  reason?: string;
}

export interface ApkBuildStartedPayload {
  projectId: string;
}

export interface ApkBuildProgressPayload {
  projectId: string;
  line: string;
  timestamp: string;
}

export interface ApkBuildReadyPayload {
  projectId: string;
  downloadUrl: string;
  sizeBytes: number;
  builtAt: string;
}

export interface ApkBuildErrorPayload {
  projectId: string;
  error: string;
}
