import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreatePromptRunDto {
  @ApiProperty({ example: 'Create a todo app with login and dark theme.' })
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  prompt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  chatId?: string;

  @ApiPropertyOptional({ example: 'openai' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  provider?: string;

  @ApiPropertyOptional({ example: 'gpt-4.1' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @IsString()
  requestedByEmail?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  autoRecordUserMessage?: boolean;
}
