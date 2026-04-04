import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DeployProvider {
  VERCEL = 'vercel',
  RAILWAY = 'railway',
  DOWNLOAD = 'download',
}

export class DeployProjectDto {
  @ApiProperty({ enum: DeployProvider })
  @IsEnum(DeployProvider)
  provider: DeployProvider;

  @ApiPropertyOptional({ description: 'Provider API token (Vercel or Railway)' })
  @IsString()
  @IsOptional()
  token?: string;

  @ApiPropertyOptional({ description: 'Railway API token for deployment (deprecated, use token)' })
  @IsString()
  @IsOptional()
  railwayToken?: string;

  @ApiPropertyOptional({ description: 'Custom project name' })
  @IsString()
  @IsOptional()
  projectName?: string;
}
