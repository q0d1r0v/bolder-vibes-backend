import type { PromptRun, Project } from '@prisma/client';

import type { AiGeneratedProject } from '@/ai/interfaces/ai-generated-project.interface';

export interface AiProviderContext {
  promptRun: PromptRun;
  project: Project & {
    owner: {
      id: string;
      email: string;
      displayName: string | null;
    };
  };
}

export interface AiProvider {
  readonly name: string;
  generate(context: AiProviderContext): Promise<AiGeneratedProject>;
}
