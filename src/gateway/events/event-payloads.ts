export interface JoinProjectPayload {
  projectId: string;
}

export interface SendMessagePayload {
  conversationId: string;
  content: string;
  model?: string;
  planMode?: boolean;
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
