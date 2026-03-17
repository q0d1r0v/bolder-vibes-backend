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
import { AgentOrchestratorService } from '@/agents/orchestrator/agent-orchestrator.service.js';
import { CLIENT_EVENTS, SERVER_EVENTS } from './events/event-types.js';
import type {
  JoinProjectPayload,
  CancelTaskPayload,
} from './events/event-payloads.js';
import type { JwtPayload } from '@/common/interfaces/index.js';

@WebSocketGateway({
  namespace: '/ws',
  cors: {
    origin: process.env.CORS_ALLOWED_ORIGINS?.split(',').map((s) =>
      s.trim(),
    ) || ['http://localhost:5173'],
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
    @Inject(forwardRef(() => AgentOrchestratorService))
    private readonly orchestrator: AgentOrchestratorService,
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
  ) {
    this.emitToProject(projectId, SERVER_EVENTS.MESSAGE_RECEIVED, {
      messageId,
      role,
      content,
    });
  }
}
