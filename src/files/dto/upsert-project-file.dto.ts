import { VersionSource } from '@/common/enums/version-source.enum';

export class ProjectFileInputDto {
  path!: string;
  content!: string;
  language?: string;
  kind?: 'SOURCE' | 'CONFIG' | 'ASSET' | 'GENERATED';
  isEntry?: boolean;
}

export class UpsertProjectFilesDto {
  files!: ProjectFileInputDto[];
  summary?: string;
  source?: VersionSource;
  requestedByEmail?: string;
}
