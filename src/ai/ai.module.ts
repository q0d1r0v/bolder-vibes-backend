import { Module } from '@nestjs/common';

import { AiPromptProcessor } from '@/ai/ai-prompt.processor';
import { AiProviderRegistry } from '@/ai/ai-provider.registry';
import { AiQueueService } from '@/ai/ai-queue.service';
import { AiController } from '@/ai/ai.controller';
import { AiService } from '@/ai/ai.service';
import { AnthropicProvider } from '@/ai/providers/anthropic.provider';
import { MockAiProvider } from '@/ai/providers/mock-ai.provider';
import { OpenAiProvider } from '@/ai/providers/openai.provider';
import { ChatsModule } from '@/chats/chats.module';
import { FilesModule } from '@/files/files.module';
import { ProjectsModule } from '@/projects/projects.module';
import { RuntimeModule } from '@/runtime/runtime.module';

@Module({
  imports: [ProjectsModule, ChatsModule, FilesModule, RuntimeModule],
  controllers: [AiController],
  providers: [
    AiService,
    AiQueueService,
    AiPromptProcessor,
    AiProviderRegistry,
    MockAiProvider,
    OpenAiProvider,
    AnthropicProvider,
  ],
  exports: [AiService],
})
export class AiModule {}
