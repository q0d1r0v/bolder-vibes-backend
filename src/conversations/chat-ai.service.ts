import { Injectable, Inject, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service.js';
import { PreviewService } from '@/sandbox/preview/preview.service.js';
import { NativePreviewService } from '@/sandbox/preview/native-preview.service.js';
import { AVAILABLE_MODELS } from '@/config/ai.config.js';
import Anthropic from '@anthropic-ai/sdk';
import type {
  Tool,
  MessageParam,
  ContentBlockParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages.js';

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
    name: 'read_file',
    description:
      'Read the full contents of an existing file in the project. Call this BEFORE editing a file so you can see its current content, and whenever you need to understand how existing code works. The file tree in the system prompt lists every available file — this tool returns the actual bytes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description:
            'The file path relative to the project root, exactly as it appears in the file tree (e.g., "src/screens/home/HomeScreen.tsx")',
        },
      },
      required: ['path'],
    },
  },
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
  const fileTree = files.length
    ? files.map((f) => `  ${f.path} (${f.size} bytes)`).join('\n')
    : '(empty project — no files yet)';

  return `You are Bolder Vibes AI — an expert React Native mobile app coding assistant.

## Your Capabilities
- You can **create**, **edit**, and **delete** files in the user's React Native Expo project using the provided tools.
- You have full visibility into the project's file structure and contents.
- When the user asks you to build something — USE THE TOOLS to make actual file changes immediately.
- When explaining features or answering questions, respond with text.
- The user is a no-coder — keep explanations simple, avoid technical jargon.

## React Native Rules (CRITICAL — follow strictly)

### Components
- Use ONLY React Native components — NEVER use HTML elements:
  - div → View
  - span, p, h1-h6 → Text
  - img → Image (from react-native)
  - button → TouchableOpacity or Pressable
  - input → TextInput
  - scroll → ScrollView (short) or FlatList (long lists)
- Import from 'react-native', NOT 'react-dom' or any web library.

### Styling
- ALWAYS use StyleSheet.create() — NEVER use CSS files.
- No CSS units (px, rem, em, %, vh, vw) — use plain numbers.
- flexDirection defaults to 'column' in React Native.
- No web-only CSS: display: grid, position: fixed, hover, cursor.

### Navigation
- Use @react-navigation/native for screen navigation.
- Stack: @react-navigation/native-stack
- Tabs: @react-navigation/bottom-tabs
- navigation.navigate('ScreenName') to navigate.

### Icons & Assets
- Use @expo/vector-icons (Ionicons, MaterialIcons, FontAwesome, Feather).
- Example: import { Ionicons } from '@expo/vector-icons';

### Project Structure
- Screens in src/screens/ (e.g., HomeScreen.tsx)
- Components in src/components/ (e.g., ProductCard.tsx)
- Navigation in src/navigation/ (e.g., AppNavigator.tsx)
- Hooks in src/hooks/, services in src/services/
- Entry point: App.tsx

## Backend Decision (CRITICAL)
When the user's request needs server-side logic (user auth, database, real data storage):
- Create a server/ directory with Express.js backend.
- Backend listens on port 3001 inside the sandbox and MUST mount every route under the /api/ prefix.
- The mobile app MUST call the API with a RELATIVE path: fetch('/api/todos'), fetch('/api/login'), etc.
- ALWAYS use relative paths like '/api/...'. The preview runtime proxies /api/* to the backend same-origin, so relative URLs work from both the web iframe AND on-device builds routed through the same origin.
- NEVER hardcode http://localhost:3001, 127.0.0.1, or any hostname/IP.
- NEVER read process.env.EXPO_PUBLIC_API_URL for API base URL — leave it unset, use '/api/...'.
- NEVER try to detect the host via window.location or hostname.replace(...) — rely on the same-origin proxy.

When the user's request is simple (calculator, local notes, timer, UI-only):
- No backend needed. Use AsyncStorage for local data.

## Sandbox Environment
- Container port 3000 is a same-origin reverse proxy:
  - /api/* routes to Express on :3001 inside the container.
  - everything else routes to Metro dev server on :3100 inside the container.
- Database: PostgreSQL available via process.env.DATABASE_URL (only inside server/).
- For Prisma: schema at server/prisma/schema.prisma.
- The browser iframe and the Metro bundler are on the SAME ORIGIN as the backend, so no CORS configuration is needed. Do not set Access-Control-Allow-Origin on the server — it is unnecessary.

## Project Files

Below is the complete file tree for this project. The CONTENTS of these files are NOT included in this system prompt — instead, whenever you need to see what is inside a file, call the \`read_file\` tool. This keeps the context small and lets you work on large projects without hitting rate limits.

### File Tree
${fileTree}

### How to use the file tree
- Before editing an existing file, call \`read_file\` on it first so you see the real current content.
- When the user mentions a feature, scan the tree for related files (by name/path) and read the ones that matter.
- You can read multiple files in parallel in a single response — prefer batching reads over sequential.
- You do NOT need to read a file to CREATE a new one at a path that does not exist in the tree.
- Treat the tree as authoritative: if a path is not listed, the file does not exist.

## File Dependency Ordering (CRITICAL — breaks the build if violated)
- NEVER import a file that you have not already created in this same response, or that does not already exist in the File Tree above.
- ALWAYS create leaf files FIRST, then the files that import them. Correct order:
  1. Types / interfaces (src/types/*)
  2. Theme / constants (src/theme/*, src/constants/*)
  3. Stores / hooks / services (src/store/*, src/hooks/*, src/services/*)
  4. Small components (src/components/*)
  5. Screens (src/screens/*)
  6. Navigation (src/navigation/*)
  7. App.tsx LAST
- Before you write App.tsx or any navigator, mentally list every import it will contain and make sure each target file has already been created via create_file in this response or already exists in the File Tree.
- If you are about to reference a screen like @/screens/orders/OrdersScreen, you MUST have created src/screens/orders/OrdersScreen.tsx first. No exceptions.
- If you run out of budget before finishing, prefer shipping a SMALLER but COMPLETE app (fewer screens, all imports resolved) over a larger app with missing files.
- It is better to write a placeholder screen with "Coming soon" than to import a file that does not exist.

## Guidelines
- ALWAYS use the tools to create/edit/delete files immediately — never just show code in text.
- When creating or editing files, always provide the COMPLETE file content.
- Follow the existing code style and conventions in the project.
- Keep responses concise and simple — the user is not a developer.
- Act proactively: if the user describes what they want, build it immediately without asking for confirmation.
- Focus on mobile UX: proper spacing, touch-friendly buttons, smooth navigation.
- Always wrap screens in SafeAreaView from react-native-safe-area-context.`;
}

// ─── Service ────────────────────────────────────────────

@Injectable()
export class ChatAiService {
  private readonly logger = new Logger(ChatAiService.name);
  private readonly client: Anthropic;

  // Tracks in-flight chat streams so they can be aborted via `abortChat()`.
  // Key is the conversationId (one active stream per conversation at a time).
  private readonly activeStreams = new Map<string, AbortController>();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => PreviewService))
    private readonly previewService: PreviewService,
    @Inject(forwardRef(() => NativePreviewService))
    private readonly nativePreviewService: NativePreviewService,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.get<string>('ai.anthropic.apiKey'),
    });
  }

  /**
   * Fan a file write out to every live preview container (web iframe +
   * phone tunnel) in parallel. We use `allSettled` so a single container
   * being down doesn't swallow the whole tool call — each failure logs
   * individually.
   */
  private async syncFileToPreviews(
    projectId: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    const results = await Promise.allSettled([
      this.previewService.syncFile(projectId, filePath, content),
      this.nativePreviewService.syncFile(projectId, filePath, content),
    ]);
    const labels = ['web', 'native'];
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        this.logger.warn(
          `syncFile to ${labels[i]} preview failed for ${filePath}: ${
            r.reason instanceof Error ? r.reason.message : String(r.reason)
          }`,
        );
      }
    });
  }

  private async deleteFileFromPreviews(
    projectId: string,
    filePath: string,
  ): Promise<void> {
    await Promise.allSettled([
      this.previewService.syncFile(projectId, filePath, null),
      this.nativePreviewService.deleteFile(projectId, filePath),
    ]);
  }

  /**
   * Request cancellation of the in-flight chat stream for a conversation.
   * Returns true if a stream was actually aborted.
   */
  abortChat(conversationId: string): boolean {
    const controller = this.activeStreams.get(conversationId);
    if (!controller) return false;
    controller.abort();
    this.activeStreams.delete(conversationId);
    this.logger.log(`Chat stream aborted for conversation ${conversationId}`);
    return true;
  }

  /**
   * Generate a short conversation title from the first user message using the cheapest model.
   */
  async generateTitle(userMessage: string): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5',
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
      this.logger.warn(
        `Title generation failed: ${error instanceof Error ? error.message : error}`,
      );
      return 'New Chat';
    }
  }

  private isAbortError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { name?: string; message?: string };
    return (
      e.name === 'AbortError' ||
      e.name === 'APIUserAbortError' ||
      (typeof e.message === 'string' &&
        e.message.toLowerCase().includes('abort'))
    );
  }

  async *streamChatResponse(
    conversationId: string,
    projectId: string,
    options?: { model?: string; planMode?: boolean },
  ): AsyncGenerator<ChatStreamEvent> {
    // Load project file tree (paths + sizes only — contents are fetched
    // lazily via the read_file tool to keep the system prompt small and
    // avoid hitting Anthropic's per-minute input-token rate limit).
    const projectFiles = await this.prisma.projectFile.findMany({
      where: { projectId },
      select: { path: true, size: true },
      orderBy: { path: 'asc' },
    });

    const fileContext: FileContext[] = projectFiles.map((f) => ({
      path: f.path,
      content: '',
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
    const model =
      options?.model ||
      this.configService.get<string>('ai.anthropic.model', 'claude-sonnet-4-6');
    const modelConfig = AVAILABLE_MODELS.find((m) => m.id === model);
    const maxTokens =
      modelConfig?.maxTokens ||
      this.configService.get<number>('ai.anthropic.maxTokens', 8192);
    const planMode = options?.planMode ?? false;

    // Abort any stream that may still be registered for this conversation
    // (shouldn't happen in normal flow, but be defensive).
    const existing = this.activeStreams.get(conversationId);
    if (existing) {
      existing.abort();
    }
    const controller = new AbortController();
    this.activeStreams.set(conversationId, controller);

    try {
      yield* this.runAgenticLoop(
        aiMessages,
        fileContext,
        projectId,
        model,
        maxTokens,
        planMode,
        controller.signal,
      );
    } catch (err) {
      if (this.isAbortError(err) || controller.signal.aborted) {
        this.logger.log(
          `Chat stream for ${conversationId} aborted — returning partial response`,
        );
        return; // graceful stop; caller will emit CHAT_RESPONSE_END with what was streamed
      }
      throw err;
    } finally {
      // Only clear if the controller we set is still the active one
      if (this.activeStreams.get(conversationId) === controller) {
        this.activeStreams.delete(conversationId);
      }
    }
  }

  private async *runAgenticLoop(
    messages: MessageParam[],
    fileContext: FileContext[],
    projectId: string,
    model: string,
    maxTokens: number,
    planMode = false,
    signal?: AbortSignal,
    maxIterations = 25,
  ): AsyncGenerator<ChatStreamEvent> {
    let currentMessages = [...messages];
    let iteration = 0;
    // Track consecutive max_tokens truncations so we can bail out rather
    // than loop forever if the model keeps generating long output.
    let consecutiveTruncations = 0;
    const MAX_TRUNCATION_CONTINUATIONS = 3;

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
      if (signal?.aborted) return;
      iteration++;

      let stream: ReturnType<typeof this.client.messages.stream>;
      try {
        stream = this.client.messages.stream(
          {
            model,
            max_tokens: maxTokens,
            temperature: planMode ? 0.3 : 0.7,
            system: systemPrompt,
            tools: CHAT_TOOLS,
            messages: currentMessages,
          },
          signal ? { signal } : undefined,
        );
      } catch (err) {
        if (this.isAbortError(err)) return;
        const msg = err instanceof Error ? err.message : 'stream init failed';
        this.logger.error(`messages.stream init failed: ${msg}`);
        yield { type: 'text', content: `\n\n❌ AI request failed: ${msg}` };
        return;
      }

      let hasToolUse = false;
      const assistantContentBlocks: ContentBlockParam[] = [];

      try {
        for await (const event of stream) {
          if (signal?.aborted) return;
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            yield { type: 'text', content: event.delta.text };
          }
        }
      } catch (err) {
        if (this.isAbortError(err) || signal?.aborted) return;
        const msg = err instanceof Error ? err.message : 'stream read failed';
        this.logger.error(
          `stream iteration failed (iter ${iteration}): ${msg}`,
        );
        yield { type: 'text', content: `\n\n❌ Stream error: ${msg}` };
        return;
      }

      // Retrieve the fully-parsed message. finalMessage() may throw if
      // the stream was aborted or a network error occurred — treat both
      // as recoverable and surface a clear message rather than exploding.
      let finalMessage: Awaited<ReturnType<typeof stream.finalMessage>>;
      try {
        finalMessage = await stream.finalMessage();
      } catch (err) {
        if (this.isAbortError(err) || signal?.aborted) return;
        const msg =
          err instanceof Error ? err.message : 'finalMessage read failed';
        this.logger.error(`finalMessage failed (iter ${iteration}): ${msg}`);
        yield {
          type: 'text',
          content: `\n\n❌ AI response incomplete: ${msg}`,
        };
        return;
      }

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

      const hitMaxTokens = finalMessage.stop_reason === 'max_tokens';

      // Truncated without any tool calls → the user's visible text got cut
      // off mid-word. Ask the model to keep writing so the reply finishes
      // cleanly. Cap continuations so a buggy response can't loop forever.
      if (hitMaxTokens && !hasToolUse) {
        consecutiveTruncations++;
        if (consecutiveTruncations > MAX_TRUNCATION_CONTINUATIONS) {
          yield {
            type: 'text',
            content:
              '\n\n⚠️ Response truncated (hit token limit repeatedly). Please ask me to continue or narrow the request.',
          };
          return;
        }
        this.logger.warn(
          `max_tokens truncation (iter ${iteration}, run ${consecutiveTruncations}/${MAX_TRUNCATION_CONTINUATIONS}) — auto-continuing`,
        );
        currentMessages = [
          ...currentMessages,
          { role: 'assistant', content: assistantContentBlocks },
          {
            role: 'user',
            content: 'Please continue exactly where you left off.',
          },
        ];
        continue;
      }

      if (!hasToolUse) {
        // No tool calls and a clean stop — the reply is finished.
        break;
      }

      // A tool call executed successfully → reset the truncation counter
      // since forward progress was made.
      consecutiveTruncations = 0;

      if (signal?.aborted) return;

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

    if (iteration >= maxIterations) {
      this.logger.warn(`Agentic loop hit maxIterations (${maxIterations})`);
      yield {
        type: 'text',
        content:
          `\n\n⚠️ Reached the maximum tool-call limit (${maxIterations}). ` +
          'Send a follow-up to continue.',
      };
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
        case 'read_file':
          return await this.handleReadFile(projectId, input.path, fileContext);
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

  private async handleReadFile(
    projectId: string,
    path: string,
    fileContext: FileContext[],
  ): Promise<{ message: string }> {
    // Prefer in-memory cache so we don't re-hit the DB within a single loop.
    // Tree-only entries have empty content, so only trust the cache when content is populated.
    const cached = fileContext.find((f) => f.path === path);
    if (cached && cached.content) {
      return {
        message: `--- ${path} (${cached.size} bytes) ---\n${cached.content}`,
      };
    }

    const file = await this.prisma.projectFile.findFirst({
      where: { projectId, path },
      select: { path: true, content: true, size: true },
    });

    if (!file) {
      return {
        message: `Error: file not found at path "${path}". Check the file tree in the system prompt for the exact path.`,
      };
    }

    // Populate cache for subsequent calls in this loop
    if (cached) {
      cached.content = file.content;
      cached.size = file.size;
    } else {
      fileContext.push({
        path: file.path,
        content: file.content,
        size: file.size,
      });
    }

    return {
      message: `--- ${file.path} (${file.size} bytes) ---\n${file.content}`,
    };
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

    // Sync to every live preview (web iframe + phone tunnel) so Metro
    // hot-reloads both surfaces without a manual Stop/Start.
    await this.syncFileToPreviews(projectId, path, content);

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

    // Sync to every live preview (web iframe + phone tunnel).
    await this.syncFileToPreviews(projectId, path, content);

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
      return {
        message: `File not found: ${path}`,
        fileOperation: { type: 'delete', path },
      };
    }

    await this.prisma.projectFile.delete({ where: { id: file.id } });

    // Update local file context
    const idx = fileContext.findIndex((f) => f.path === path);
    if (idx >= 0) {
      fileContext.splice(idx, 1);
    }

    // Remove the file from every live preview so Metro HMR clears it.
    await this.deleteFileFromPreviews(projectId, path);

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
