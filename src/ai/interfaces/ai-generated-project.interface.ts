export interface AiGeneratedProjectFile {
  path: string;
  content: string;
  language?: string;
  kind?: 'SOURCE' | 'CONFIG' | 'ASSET' | 'GENERATED';
  isEntry?: boolean;
}

export interface AiGeneratedProject {
  provider: string;
  model: string;
  summary: string;
  files: AiGeneratedProjectFile[];
  rawText?: string;
}
