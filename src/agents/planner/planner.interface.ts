export interface PlanStep {
  action: 'create' | 'update' | 'delete';
  filePath: string;
  description: string;
}

export interface ExecutionPlan {
  reasoning: string;
  steps: PlanStep[];
  estimatedChanges: number;
}
