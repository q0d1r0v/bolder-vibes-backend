import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsNumber,
  IsBoolean,
  Matches,
} from 'class-validator';

export class ExecuteCommandDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000, {
    message: 'Command must not exceed 1000 characters',
  })
  @Matches(/^[^;|`$><&\\]+$/, {
    message:
      'Command must not contain shell operators (;, |, `, $, >, <, &, \\)',
  })
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
