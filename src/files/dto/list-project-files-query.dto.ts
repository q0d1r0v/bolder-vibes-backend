import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ListProjectFilesQueryDto {
  @ApiPropertyOptional({ example: 'src/' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  pathPrefix?: string;
}
