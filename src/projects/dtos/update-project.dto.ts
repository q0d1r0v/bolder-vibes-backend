import { IsString, MaxLength, IsOptional, IsEnum } from 'class-validator';
import { ProjectStatus } from '@/common/enums/index.js';

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}
