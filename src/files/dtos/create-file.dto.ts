import { IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

export class CreateFileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  path: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  mimeType?: string;
}
