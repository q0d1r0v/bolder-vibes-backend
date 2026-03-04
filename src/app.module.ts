import { Module } from '@nestjs/common';
import { AiModule } from '@/ai/ai.module';
import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { AuthModule } from '@/auth/auth.module';
import { ChatsModule } from '@/chats/chats.module';
import { FilesModule } from '@/files/files.module';
import { HealthModule } from '@/health/health.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { ProjectsModule } from '@/projects/projects.module';
import { RealtimeModule } from '@/realtime/realtime.module';
import { RuntimeModule } from '@/runtime/runtime.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    RealtimeModule,
    HealthModule,
    ProjectsModule,
    ChatsModule,
    FilesModule,
    AiModule,
    RuntimeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
