import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

import { getAppConfig } from '@/config/app.config';
import { projectRoom, REALTIME_NAMESPACE } from '@/realtime/realtime.constants';
import type { ProjectRoomPayload } from '@/realtime/interfaces/project-room-payload.interface';
import { RealtimeService } from '@/realtime/realtime.service';

@WebSocketGateway({
  namespace: REALTIME_NAMESPACE,
  cors: {
    origin: getAppConfig().corsOrigin,
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly realtimeService: RealtimeService) {}

  afterInit(server: Server) {
    this.realtimeService.registerServer(server);
    this.logger.log(`Socket namespace ready: /${REALTIME_NAMESPACE}`);
  }

  handleConnection(client: Socket) {
    client.emit('socket.connected', {
      socketId: client.id,
      namespace: REALTIME_NAMESPACE,
      emittedAt: new Date().toISOString(),
    });
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Socket disconnected: ${client.id}`);
  }

  @SubscribeMessage('project.join')
  handleProjectJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ProjectRoomPayload,
  ) {
    const room = projectRoom(payload.projectId);
    void client.join(room);

    return {
      event: 'project.joined',
      room,
      projectId: payload.projectId,
      socketId: client.id,
    };
  }

  @SubscribeMessage('project.leave')
  handleProjectLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ProjectRoomPayload,
  ) {
    const room = projectRoom(payload.projectId);
    void client.leave(room);

    return {
      event: 'project.left',
      room,
      projectId: payload.projectId,
      socketId: client.id,
    };
  }

  @SubscribeMessage('project.ping')
  handlePing(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ProjectRoomPayload,
  ) {
    return {
      event: 'project.pong',
      projectId: payload.projectId,
      socketId: client.id,
      emittedAt: new Date().toISOString(),
    };
  }
}
