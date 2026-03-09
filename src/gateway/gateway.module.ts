import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EventsGateway } from './events.gateway.js';

@Module({
  imports: [JwtModule.register({})],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class GatewayModule {}
