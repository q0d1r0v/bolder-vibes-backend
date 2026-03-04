import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({ example: 'Todo Builder' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'AI generated todo app with auth' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    example: 'builder@example.com',
    deprecated: true,
    description:
      'Deprecated. The authenticated user becomes the owner automatically.',
  })
  @IsOptional()
  @IsEmail()
  ownerEmail?: string;

  @ApiPropertyOptional({
    example: 'Builder',
    description: 'Optional profile name update for the current user.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  ownerDisplayName?: string;

  @ApiPropertyOptional({ example: 'nextjs' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  frontendFramework?: string;

  @ApiPropertyOptional({ example: 'nestjs' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  backendFramework?: string;

  @ApiPropertyOptional({ example: 'docker-sandbox' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  runtimeStrategy?: string;
}
