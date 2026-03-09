import { createPatch } from 'diff';

export function computeDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
): string {
  return createPatch(filePath, oldContent, newContent, 'previous', 'current');
}
