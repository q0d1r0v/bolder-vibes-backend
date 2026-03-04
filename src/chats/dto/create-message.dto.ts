import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { MessageRole } from '@/common/enums/message-role.enum';

export class CreateMessageDto {
  @ApiProperty({ enum: MessageRole, example: MessageRole.USER })
  @IsEnum(MessageRole)
  role!: MessageRole;

  @ApiProperty({ example: 'Create a dashboard with auth and charts.' })
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  content!: string;

  @ApiPropertyOptional({ example: 'gpt-4.1' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
