import { AgentTaskStatus } from '@/common/enums/index.js';

export interface PipelineContext {
  taskId: string;
  projectId: string;
  conversationId: string;
  userPrompt: string;
  userId: string;
}

export interface PipelineResult {
  taskId: string;
  status: AgentTaskStatus;
  summary: string;
  filesChanged: number;
}
