import { FileChange } from '../developer/developer.interface.js';

export interface RefactorOutput {
  changes: FileChange[];
  qualityReport: {
    issuesFound: number;
    improvements: string[];
  };
  summary: string;
}
