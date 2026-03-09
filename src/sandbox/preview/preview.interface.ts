export enum PreviewStatus {
  IDLE = 'idle',
  BUILDING = 'building',
  READY = 'ready',
  ERROR = 'error',
}

export interface PreviewState {
  projectId: string;
  status: PreviewStatus;
  url?: string;
  error?: string;
  startedAt?: Date;
}
