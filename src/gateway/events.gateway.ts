import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service.js';
import { AgentOrchestratorService } from '@/agents/orchestrator/agent-orchestrator.service.js';
import { ChatAiService } from '@/conversations/chat-ai.service.js';
import type { ChatStreamEvent } from '@/conversations/chat-ai.service.js';
import { CLIENT_EVENTS, SERVER_EVENTS } from './events/event-types.js';
import type {
  JoinProjectPayload,
  SendMessagePayload,
  CancelTaskPayload,
} from './events/event-payloads.js';
import type { JwtPayload } from '@/common/interfaces/index.js';

@WebSocketGateway({
  namespace: '/ws',
  cors: {
    origin: (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim()),
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AgentOrchestratorService))
    private readonly orchestrator: AgentOrchestratorService,
    @Inject(forwardRef(() => ChatAiService))
    private readonly chatAiService: ChatAiService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.split(' ')[1];

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.get<string>('auth.accessSecret'),
      });

      (client as unknown as Record<string, unknown>).user = payload;
      this.logger.log(`Client connected: ${client.id} (user: ${payload.sub})`);
    } catch {
      this.logger.warn(`Unauthorized connection attempt: ${client.id}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage(CLIENT_EVENTS.JOIN_PROJECT)
  async handleJoinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: JoinProjectPayload,
  ) {
    const room = `project:${data.projectId}`;
    await client.join(room);
    this.logger.log(`Client ${client.id} joined room ${room}`);
    return { event: 'joined', data: { room } };
  }

  @SubscribeMessage(CLIENT_EVENTS.LEAVE_PROJECT)
  async handleLeaveProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: JoinProjectPayload,
  ) {
    const room = `project:${data.projectId}`;
    await client.leave(room);
    this.logger.log(`Client ${client.id} left room ${room}`);
    return { event: 'left', data: { room } };
  }

  @SubscribeMessage(CLIENT_EVENTS.SEND_MESSAGE)
  handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SendMessagePayload,
  ) {
    this.logger.log(`>>> send_message received: ${JSON.stringify(data)}`);
    const user = (client as unknown as Record<string, unknown>).user as JwtPayload;
    if (!user) {
      this.logger.warn('>>> No user on socket, ignoring message');
      return { status: 'error', error: 'Not authenticated' };
    }
    this.logger.log(`>>> User: ${user.sub}, processing chat message...`);

    // Fire-and-forget: run streaming in background so socket handler returns immediately
    this.processChatMessage(client, user, data).catch((error) => {
      this.logger.error(
        `Chat response error: ${error instanceof Error ? error.message : error}`,
      );
      // Notify client of unhandled error
      client.emit(SERVER_EVENTS.CHAT_RESPONSE_ERROR, {
        conversationId: data.conversationId,
        error: error instanceof Error ? error.message : 'AI response failed',
      });
    });

    // Acknowledge receipt so the client knows the server got the message
    return { status: 'ok' };
  }

  private async processChatMessage(
    client: Socket,
    user: JwtPayload,
    data: SendMessagePayload,
  ) {
    this.logger.log(`>>> processChatMessage started for conv: ${data.conversationId}`);
    // Validate conversation ownership
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: data.conversationId },
    });
    this.logger.log(`>>> conversation found: ${!!conversation}, userId match: ${conversation?.userId === user.sub}`);

    if (!conversation || conversation.userId !== user.sub) {
      client.emit(SERVER_EVENTS.CHAT_RESPONSE_ERROR, {
        conversationId: data.conversationId,
        error: 'Conversation not found',
      });
      return;
    }

    try {
      // Save user message
      const userMsg = await this.prisma.message.create({
        data: {
          role: 'USER',
          content: data.content,
          conversationId: data.conversationId,
        },
      });

      // Emit user message to all clients in the project room
      this.emitMessage(
        conversation.projectId,
        userMsg.id,
        'USER',
        data.content,
        userMsg.createdAt.toISOString(),
      );

      // Auto-generate title on first message (fire-and-forget)
      if (conversation.title === 'New Conversation') {
        this.chatAiService.generateTitle(data.content).then(async (title) => {
          await this.prisma.conversation.update({
            where: { id: data.conversationId },
            data: { title },
          });
          this.emitToProject(
            conversation.projectId,
            SERVER_EVENTS.CONVERSATION_TITLE_UPDATED,
            { conversationId: data.conversationId, title },
          );
        }).catch((err) => {
          this.logger.warn(`Title generation failed: ${err}`);
        });
      }

      // Start streaming AI response
      this.emitToProject(
        conversation.projectId,
        SERVER_EVENTS.CHAT_RESPONSE_START,
        { conversationId: data.conversationId },
      );

      let fullResponse = '';

      for await (const event of this.chatAiService.streamChatResponse(
        data.conversationId,
        conversation.projectId,
        { model: data.model, planMode: data.planMode },
      )) {
        switch (event.type) {
          case 'text':
            fullResponse += event.content || '';
            this.emitToProject(
              conversation.projectId,
              SERVER_EVENTS.CHAT_RESPONSE_CHUNK,
              {
                conversationId: data.conversationId,
                chunk: event.content,
              },
            );
            break;

          case 'file_operation':
            if (event.fileOperation) {
              const op = event.fileOperation;
              switch (op.type) {
                case 'create':
                  if (op.fileId) {
                    this.emitFileCreated(conversation.projectId, op.fileId, op.path);
                  }
                  break;
                case 'update':
                  if (op.fileId) {
                    this.emitFileUpdated(conversation.projectId, op.fileId, op.path);
                  }
                  break;
                case 'delete':
                  if (op.fileId) {
                    this.emitFileDeleted(conversation.projectId, op.fileId, op.path);
                  }
                  break;
              }
              // Also send file operation info to chat stream
              this.emitToProject(
                conversation.projectId,
                SERVER_EVENTS.CHAT_RESPONSE_CHUNK,
                {
                  conversationId: data.conversationId,
                  chunk: '',
                  fileOperation: op,
                },
              );
            }
            break;

          case 'error':
            this.logger.warn(`AI tool error: ${event.error}`);
            break;
        }
      }

      // Save assistant message to DB
      const assistantMsg = await this.prisma.message.create({
        data: {
          role: 'ASSISTANT',
          content: fullResponse,
          conversationId: data.conversationId,
        },
      });

      // Signal stream end
      this.emitToProject(
        conversation.projectId,
        SERVER_EVENTS.CHAT_RESPONSE_END,
        {
          conversationId: data.conversationId,
          messageId: assistantMsg.id,
          content: fullResponse,
        },
      );
    } catch (error) {
      this.logger.error(
        `Chat stream error: ${error instanceof Error ? error.message : error}`,
      );
      client.emit(SERVER_EVENTS.CHAT_RESPONSE_ERROR, {
        conversationId: data.conversationId,
        error: error instanceof Error ? error.message : 'AI response failed',
      });
    }
  }

  @SubscribeMessage(CLIENT_EVENTS.CANCEL_TASK)
  async handleCancelTask(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: CancelTaskPayload,
  ) {
    this.logger.log(`Cancel task request: ${data.taskId}`);
    await this.orchestrator.requestCancellation(data.taskId);
    return { event: 'cancel_acknowledged', data: { taskId: data.taskId } };
  }

  // Methods to emit events to project rooms
  emitToProject(projectId: string, event: string, payload: unknown) {
    this.server.to(`project:${projectId}`).emit(event, payload);
  }

  emitTaskStarted(projectId: string, taskId: string, prompt: string) {
    this.emitToProject(projectId, SERVER_EVENTS.AGENT_TASK_STARTED, {
      taskId,
      prompt,
      status: 'PENDING',
    });
  }

  emitStepStarted(
    projectId: string,
    taskId: string,
    stepId: string,
    agentType: string,
    stepOrder: number,
  ) {
    this.emitToProject(projectId, SERVER_EVENTS.AGENT_STEP_STARTED, {
      taskId,
      stepId,
      agentType,
      stepOrder,
    });
  }

  emitStepProgress(
    projectId: string,
    taskId: string,
    stepId: string,
    partialOutput: string,
  ) {
    this.emitToProject(projectId, SERVER_EVENTS.AGENT_STEP_PROGRESS, {
      taskId,
      stepId,
      partialOutput,
    });
  }

  emitStepCompleted(
    projectId: string,
    taskId: string,
    stepId: string,
    agentType: string,
    output: unknown,
    durationMs: number,
  ) {
    this.emitToProject(projectId, SERVER_EVENTS.AGENT_STEP_COMPLETED, {
      taskId,
      stepId,
      agentType,
      output,
      durationMs,
    });
  }

  emitTaskCompleted(projectId: string, taskId: string, result: unknown) {
    this.emitToProject(projectId, SERVER_EVENTS.AGENT_TASK_COMPLETED, {
      taskId,
      status: 'COMPLETED',
      result,
    });
  }

  emitTaskFailed(projectId: string, taskId: string, error: string) {
    this.emitToProject(projectId, SERVER_EVENTS.AGENT_TASK_FAILED, {
      taskId,
      error,
    });
  }

  emitFileCreated(projectId: string, fileId: string, path: string) {
    this.emitToProject(projectId, SERVER_EVENTS.FILE_CREATED, {
      fileId,
      path,
      projectId,
    });
  }

  emitFileUpdated(
    projectId: string,
    fileId: string,
    path: string,
    diff?: string,
  ) {
    this.emitToProject(projectId, SERVER_EVENTS.FILE_UPDATED, {
      fileId,
      path,
      projectId,
      diff,
    });
  }

  emitFileDeleted(projectId: string, fileId: string, path: string) {
    this.emitToProject(projectId, SERVER_EVENTS.FILE_DELETED, {
      fileId,
      path,
      projectId,
    });
  }

  emitMessage(
    projectId: string,
    messageId: string,
    role: string,
    content: string,
    createdAt?: string,
  ) {
    this.emitToProject(projectId, SERVER_EVENTS.MESSAGE_RECEIVED, {
      messageId,
      role,
      content,
      createdAt,
    });
  }
}
