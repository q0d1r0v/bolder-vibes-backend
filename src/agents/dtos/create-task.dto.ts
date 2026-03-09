import { IsString, MinLength, IsUUID } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  prompt: string;

  @IsUUID()
  projectId: string;
}
