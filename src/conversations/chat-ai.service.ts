import { Injectable, Inject, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service.js';
import { PreviewService } from '@/sandbox/preview/preview.service.js';
import { AVAILABLE_MODELS } from '@/config/ai.config.js';
import Anthropic from '@anthropic-ai/sdk';
import type { Tool, MessageParam, ContentBlockParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages.js';

// ─── Types ──────────────────────────────────────────────

interface FileContext {
  path: string;
  content: string;
  size: number;
}

interface FileOperation {
  type: 'create' | 'update' | 'delete';
  path: string;
  content?: string;
  fileId?: string;
}

export interface ChatStreamEvent {
  type: 'text' | 'file_operation' | 'error';
  content?: string;
  fileOperation?: FileOperation;
  error?: string;
}

// ─── Tool Definitions ───────────────────────────────────

const CHAT_TOOLS: Tool[] = [
  {
    name: 'create_file',
    description:
      'Create a new file in the project. Use this when the user asks you to create a new file, generate code, or scaffold something.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description:
            'The file path relative to the project root (e.g., "src/components/Button.tsx")',
        },
        content: {
          type: 'string',
          description: 'The full content of the file',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Edit an existing file in the project. Use this when the user asks you to modify, fix, update, or refactor existing code. Provide the complete new content of the file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'The path of the existing file to edit',
        },
        content: {
          type: 'string',
          description:
            'The complete new content of the file (not a diff, the full file)',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'delete_file',
    description:
      'Delete a file from the project. Use this only when the user explicitly asks to remove/delete a file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'The path of the file to delete',
        },
      },
      required: ['path'],
    },
  },
];

// ─── System Prompt Builder ──────────────────────────────

function buildSystemPrompt(files: FileContext[]): string {
  const fileTree = files.map((f) => `  ${f.path} (${f.size} bytes)`).join('\n');

  const fileContents = files
    .filter((f) => f.size <= 50_000) // Skip very large files
    .map(
      (f) =>
        `--- ${f.path} ---\n${f.content.length > 10_000 ? f.content.slice(0, 10_000) + '\n... (truncated)' : f.content}`,
    )
    .join('\n\n');

  return `You are Bolder Vibes AI — an expert coding assistant integrated into a web-based IDE.

## Your Capabilities
- You can **create**, **edit**, and **delete** files in the user's project using the provided tools.
- You have full visibility into the project's file structure and contents.
- When the user asks you to write, modify, or generate code — USE THE TOOLS to make actual file changes.
- When explaining code or answering questions, respond with text.

## Sandbox Environment (CRITICAL — read before generating code)

All projects run inside a Docker container with these constraints:

### Single-app projects (React, Next.js, Express)
- App runs on **port 3000** inside the container.
- For Express: always use \`const port = process.env.PORT || 3000\` and listen on \`0.0.0.0\`.

### Fullstack projects (frontend/ + backend/ directories)
- **Frontend (Vite/React)**: runs on port **3000** (exposed to user's browser).
- **Backend (Express/Node)**: runs on port **3001** inside the container (NOT directly accessible from the browser).
- Environment variables available: \`PORT=3001\`, \`HOST=0.0.0.0\`, \`DATABASE_URL\` (PostgreSQL).
- **Backend code MUST**: use \`const port = process.env.PORT || 3001\` and listen on \`"0.0.0.0"\`.
- **Frontend-to-backend communication**: Since only port 3000 is exposed, you MUST configure Vite proxy.
  In \`frontend/vite.config.ts\`:
  \`\`\`typescript
  export default defineConfig({
    server: {
      proxy: {
        '/api': 'http://localhost:3001'
      }
    }
  })
  \`\`\`
  Then in frontend code, use relative URLs like \`fetch('/api/todos')\` — never \`http://localhost:3001\`.

### Database
- PostgreSQL is automatically available for fullstack projects.
- Connection string: \`process.env.DATABASE_URL\` (always use this, never hardcode).
- For Prisma: set \`url = env("DATABASE_URL")\` in schema.prisma datasource block.
- For raw pg: use \`new Pool({ connectionString: process.env.DATABASE_URL })\`.

### Networking rules
- NEVER hardcode \`localhost:PORT\` in frontend fetch calls — always use relative paths (\`/api/...\`).
- NEVER use CORS \`*\` in backend — Vite proxy makes it same-origin.
- Backend Express routes MUST be prefixed with \`/api\` (e.g., \`app.use('/api/todos', router)\`).

## Project Files

### File Tree
${fileTree || '(empty project — no files yet)'}

### File Contents
${fileContents || '(no files to display)'}

## Guidelines
- ALWAYS use the tools to create/edit/delete files immediately — never just show code in text and ask the user to copy it.
- When creating or editing files, always provide the COMPLETE file content.
- Follow the existing code style and conventions in the project.
- If the user asks to modify a file, make the changes and explain what you changed.
- For new features, create all necessary files (components, tests, styles, etc.).
- Keep responses concise. Focus on what changed and why.
- Use markdown formatting for explanations.
- If a file is too large to include above, you can still edit it — just reference the path.
- Act proactively: if the user describes what they want, build it immediately without asking for confirmation.`;
}

// ─── Service ────────────────────────────────────────────

@Injectable()
export class ChatAiService {
  private readonly logger = new Logger(ChatAiService.name);
  private readonly client: Anthropic;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => PreviewService))
    private readonly previewService: PreviewService,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.get<string>('ai.anthropic.apiKey'),
    });
  }

  /**
   * Generate a short conversation title from the first user message using the cheapest model.
   */
  async generateTitle(userMessage: string): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 30,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: `Generate a very short title (3-6 words, no quotes) for a chat that starts with this message:\n\n"${userMessage.slice(0, 500)}"`,
          },
        ],
      });

      const text = response.content[0];
      if (text?.type === 'text') {
        return text.text.trim().replace(/^["']|["']$/g, '');
      }
      return 'New Chat';
    } catch (error) {
      this.logger.warn(`Title generation failed: ${error instanceof Error ? error.message : error}`);
      return 'New Chat';
    }
  }

  async *streamChatResponse(
    conversationId: string,
    projectId: string,
    options?: { model?: string; planMode?: boolean },
  ): AsyncGenerator<ChatStreamEvent> {
    // Load project files for context
    const projectFiles = await this.prisma.projectFile.findMany({
      where: { projectId },
      select: { path: true, content: true, size: true },
      orderBy: { path: 'asc' },
    });

    const fileContext: FileContext[] = projectFiles.map((f) => ({
      path: f.path,
      content: f.content,
      size: f.size,
    }));

    // Load conversation history
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { role: true, content: true },
    });

    const aiMessages: MessageParam[] = messages.map((m) => ({
      role: m.role === 'USER' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));

    // Use requested model or fall back to configured default
    const model = options?.model || this.configService.get<string>(
      'ai.anthropic.model',
      'claude-sonnet-4-6-20260402',
    );
    const modelConfig = AVAILABLE_MODELS.find((m) => m.id === model);
    const maxTokens = modelConfig?.maxTokens || this.configService.get<number>(
      'ai.anthropic.maxTokens',
      8192,
    );
    const planMode = options?.planMode ?? false;

    // Agentic loop: handle tool use responses
    yield* this.runAgenticLoop(
      aiMessages,
      fileContext,
      projectId,
      model,
      maxTokens,
      planMode,
    );
  }

  private async *runAgenticLoop(
    messages: MessageParam[],
    fileContext: FileContext[],
    projectId: string,
    model: string,
    maxTokens: number,
    planMode = false,
    maxIterations = 10,
  ): AsyncGenerator<ChatStreamEvent> {
    let currentMessages = [...messages];
    let iteration = 0;

    const systemPrompt = planMode
      ? buildSystemPrompt(fileContext) +
        `\n\n## PLAN MODE ACTIVE
You are in PLAN MODE. Follow this process:
1. First, briefly explain your plan (which files to create/edit/delete and why)
2. Then IMMEDIATELY execute the plan using the tools — do NOT wait for user approval
3. After executing, summarize what you did

Always think step-by-step, then act. The user expects you to both plan AND execute.`
      : buildSystemPrompt(fileContext);

    while (iteration < maxIterations) {
      iteration++;

      const stream = this.client.messages.stream({
        model,
        max_tokens: maxTokens,
        temperature: planMode ? 0.3 : 0.7,
        system: systemPrompt,
        tools: CHAT_TOOLS,
        messages: currentMessages,
      });

      let hasToolUse = false;
      const assistantContentBlocks: ContentBlockParam[] = [];
      let currentText = '';

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          currentText += event.delta.text;
          yield { type: 'text', content: event.delta.text };
        }
      }

      // Get final message to check for tool use
      const finalMessage = await stream.finalMessage();

      for (const block of finalMessage.content) {
        if (block.type === 'text') {
          assistantContentBlocks.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          hasToolUse = true;
          assistantContentBlocks.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          });
        }
      }

      if (!hasToolUse) {
        // No tool calls — done
        break;
      }

      // Process tool calls
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: assistantContentBlocks },
      ];

      const toolResults: ToolResultBlockParam[] = [];

      for (const block of finalMessage.content) {
        if (block.type !== 'tool_use') continue;

        const input = block.input as Record<string, string>;
        const result = await this.executeToolCall(
          block.name,
          input,
          projectId,
          fileContext,
        );

        // Emit file operation event to frontend
        if (result.fileOperation) {
          yield { type: 'file_operation', fileOperation: result.fileOperation };
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result.message,
        });
      }

      currentMessages.push({ role: 'user', content: toolResults });
    }
  }

  private async executeToolCall(
    toolName: string,
    input: Record<string, string>,
    projectId: string,
    fileContext: FileContext[],
  ): Promise<{ message: string; fileOperation?: FileOperation }> {
    try {
      switch (toolName) {
        case 'create_file':
          return await this.handleCreateFile(
            projectId,
            input.path,
            input.content,
            fileContext,
          );
        case 'edit_file':
          return await this.handleEditFile(
            projectId,
            input.path,
            input.content,
            fileContext,
          );
        case 'delete_file':
          return await this.handleDeleteFile(
            projectId,
            input.path,
            fileContext,
          );
        default:
          return { message: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : 'Tool execution failed';
      this.logger.error(`Tool ${toolName} failed: ${msg}`);
      return { message: `Error: ${msg}` };
    }
  }

  private async handleCreateFile(
    projectId: string,
    path: string,
    content: string,
    fileContext: FileContext[],
  ): Promise<{ message: string; fileOperation: FileOperation }> {
    // Check if file already exists
    const existing = await this.prisma.projectFile.findFirst({
      where: { projectId, path },
    });

    if (existing) {
      return this.handleEditFile(projectId, path, content, fileContext);
    }

    const file = await this.prisma.projectFile.create({
      data: {
        path,
        content,
        size: Buffer.byteLength(content, 'utf8'),
        projectId,
      },
    });

    // Update local file context for subsequent tool calls
    fileContext.push({ path, content, size: file.size });

    // Sync to preview sandbox (HMR picks up the change)
    await this.previewService.syncFile(projectId, path, content);

    return {
      message: `File created: ${path} (${file.size} bytes)`,
      fileOperation: {
        type: 'create',
        path,
        content,
        fileId: file.id,
      },
    };
  }

  private async handleEditFile(
    projectId: string,
    path: string,
    content: string,
    fileContext: FileContext[],
  ): Promise<{ message: string; fileOperation: FileOperation }> {
    const file = await this.prisma.projectFile.findFirst({
      where: { projectId, path },
    });

    if (!file) {
      // File doesn't exist — create it instead
      return this.handleCreateFile(projectId, path, content, fileContext);
    }

    const newSize = Buffer.byteLength(content, 'utf8');

    await this.prisma.projectFile.update({
      where: { id: file.id },
      data: { content, size: newSize },
    });

    // Update local file context
    const idx = fileContext.findIndex((f) => f.path === path);
    if (idx >= 0) {
      fileContext[idx] = { path, content, size: newSize };
    }

    // Sync to preview sandbox (HMR picks up the change)
    await this.previewService.syncFile(projectId, path, content);

    return {
      message: `File updated: ${path} (${newSize} bytes)`,
      fileOperation: {
        type: 'update',
        path,
        content,
        fileId: file.id,
      },
    };
  }

  private async handleDeleteFile(
    projectId: string,
    path: string,
    fileContext: FileContext[],
  ): Promise<{ message: string; fileOperation: FileOperation }> {
    const file = await this.prisma.projectFile.findFirst({
      where: { projectId, path },
    });

    if (!file) {
      return { message: `File not found: ${path}`, fileOperation: { type: 'delete', path } };
    }

    await this.prisma.projectFile.delete({ where: { id: file.id } });

    // Update local file context
    const idx = fileContext.findIndex((f) => f.path === path);
    if (idx >= 0) {
      fileContext.splice(idx, 1);
    }

    // Sync to preview sandbox (removes the file, HMR picks up)
    await this.previewService.syncFile(projectId, path, null);

    return {
      message: `File deleted: ${path}`,
      fileOperation: {
        type: 'delete',
        path,
        fileId: file.id,
      },
    };
  }
}