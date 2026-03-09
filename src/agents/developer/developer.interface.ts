export interface FileChange {
  filePath: string;
  operation: 'create' | 'update' | 'delete';
  content?: string;
  diff?: string;
}

export interface DeveloperOutput {
  changes: FileChange[];
  summary: string;
}
