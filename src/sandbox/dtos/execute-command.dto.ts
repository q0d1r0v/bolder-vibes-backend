import {
  IsString,
  MinLength,
  IsOptional,
  IsNumber,
  IsBoolean,
} from 'class-validator';

export class ExecuteCommandDto {
  @IsString()
  @MinLength(1)
  command: string;

  @IsOptional()
  @IsNumber()
  timeoutMs?: number;

  @IsOptional()
  @IsNumber()
  maxMemoryMb?: number;

  @IsOptional()
  @IsBoolean()
  networkEnabled?: boolean;
}
