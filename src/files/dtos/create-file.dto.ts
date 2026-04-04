import { IsString, MinLength, MaxLength, IsOptional, Matches } from 'class-validator';

export class CreateFileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/^(?!.*\.\.\/)(?!\/)[a-zA-Z0-9_\-\/.@+ ]+$/, {
    message:
      'Path must be relative and must not contain ".." segments, null bytes, or special characters',
  })
  path: string;

  @IsString()
  @MaxLength(500000, {
    message: 'File content must not exceed 500KB',
  })
  content: string;

  @IsOptional()
  @IsString()
  mimeType?: string;
}
