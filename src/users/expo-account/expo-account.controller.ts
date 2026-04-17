import { Body, Controller, Delete, Get, HttpCode, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ExpoAccountService } from './expo-account.service.js';
import { SetExpoTokenDto } from './dtos/set-expo-token.dto.js';
import { CurrentUser } from '@/common/decorators/index.js';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users/me/expo-token')
export class ExpoAccountController {
  constructor(private readonly service: ExpoAccountService) {}

  @Get()
  async getStatus(@CurrentUser('id') userId: string) {
    return this.service.getStatus(userId);
  }

  @Put()
  async setToken(
    @CurrentUser('id') userId: string,
    @Body() dto: SetExpoTokenDto,
  ) {
    return this.service.setToken(userId, dto.token);
  }

  @Delete()
  @HttpCode(204)
  async clear(@CurrentUser('id') userId: string) {
    await this.service.clearToken(userId);
  }
}
