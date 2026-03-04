import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { VersionSource } from '@/common/enums/version-source.enum';

export class ProjectFileInputDto {
  @ApiProperty({ example: 'src/app/page.tsx' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  path!: string;

  @ApiProperty({
    example: 'export default function Page() { return <div>Hello</div>; }',
  })
  @IsString()
  content!: string;

  @ApiPropertyOptional({ example: 'typescript' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  language?: string;

  @ApiPropertyOptional({
    enum: ['SOURCE', 'CONFIG', 'ASSET', 'GENERATED'],
    example: 'SOURCE',
  })
  @IsOptional()
  @IsString()
  kind?: 'SOURCE' | 'CONFIG' | 'ASSET' | 'GENERATED';

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isEntry?: boolean;
}

export class UpsertProjectFilesDto {
  @ApiProperty({ type: [ProjectFileInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProjectFileInputDto)
  files!: ProjectFileInputDto[];

  @ApiPropertyOptional({ example: 'Initial AI generation' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  summary?: string;

  @ApiPropertyOptional({ enum: VersionSource })
  @IsOptional()
  @IsEnum(VersionSource)
  source?: VersionSource;

  @ApiPropertyOptional({
    example: 'builder@example.com',
    deprecated: true,
    description: 'Deprecated. The authenticated user is tracked automatically.',
  })
  @IsOptional()
  @IsString()
  requestedByEmail?: string;
}
