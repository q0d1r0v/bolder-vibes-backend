import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

import { projectRoom } from '@/realtime/realtime.constants';

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  registerServer(server: Server) {
    this.server = server;
  }

  emitProjectEvent(
    projectId: string,
    event: string,
    payload: Record<string, unknown>,
  ) {
    if (!this.server) {
      this.logger.debug(`Socket server not ready. Skipping ${event}.`);
      return;
    }

    this.server.to(projectRoom(projectId)).emit(event, {
      projectId,
      ...payload,
      emittedAt: new Date().toISOString(),
    });
  }

  emitSystemEvent(event: string, payload: Record<string, unknown>) {
    if (!this.server) {
      this.logger.debug(`Socket server not ready. Skipping ${event}.`);
      return;
    }

    this.server.emit(event, {
      ...payload,
      emittedAt: new Date().toISOString(),
    });
  }
}
