import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { ExpoAccountService } from './expo-account/expo-account.service.js';
import { ExpoAccountController } from './expo-account/expo-account.controller.js';

@Module({
  controllers: [UsersController, ExpoAccountController],
  providers: [UsersService, ExpoAccountService],
  exports: [UsersService, ExpoAccountService],
})
export class UsersModule {}
