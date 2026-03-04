import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class RuntimeActionDto {
  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @IsString()
  requestedBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  @ApiPropertyOptional({ example: 4300 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  port?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  forceRebuild?: boolean;
}
