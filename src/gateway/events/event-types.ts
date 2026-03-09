// Client → Server events
export const CLIENT_EVENTS = {
  JOIN_PROJECT: 'join_project',
  LEAVE_PROJECT: 'leave_project',
  SEND_MESSAGE: 'send_message',
  CANCEL_TASK: 'cancel_task',
} as const;

// Server → Client events
export const SERVER_EVENTS = {
  // Agent pipeline events
  AGENT_TASK_STARTED: 'agent:task_started',
  AGENT_STEP_STARTED: 'agent:step_started',
  AGENT_STEP_PROGRESS: 'agent:step_progress',
  AGENT_STEP_COMPLETED: 'agent:step_completed',
  AGENT_STEP_FAILED: 'agent:step_failed',
  AGENT_TASK_COMPLETED: 'agent:task_completed',
  AGENT_TASK_FAILED: 'agent:task_failed',

  // File events
  FILE_CREATED: 'file:created',
  FILE_UPDATED: 'file:updated',
  FILE_DELETED: 'file:deleted',

  // Preview events
  PREVIEW_BUILDING: 'preview:building',
  PREVIEW_READY: 'preview:ready',
  PREVIEW_ERROR: 'preview:error',

  // Message events
  MESSAGE_RECEIVED: 'message:received',

  // Error
  ERROR: 'error',
} as const;
