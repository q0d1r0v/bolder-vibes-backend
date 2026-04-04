import { IsString, IsOptional, MaxLength } from 'class-validator';

export class UpdateFileDto {
  @IsString()
  @MaxLength(500000, {
    message: 'File content must not exceed 500KB',
  })
  content: string;

  @IsOptional()
  @IsString()
  message?: string;
}
