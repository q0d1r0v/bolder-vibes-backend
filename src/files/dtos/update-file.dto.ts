import { IsString, IsOptional } from 'class-validator';

export class UpdateFileDto {
  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  message?: string;
}
