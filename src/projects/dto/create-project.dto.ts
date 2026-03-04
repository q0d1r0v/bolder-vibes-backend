export class CreateProjectDto {
  name!: string;
  description?: string;
  ownerEmail!: string;
  ownerDisplayName?: string;
  frontendFramework?: string;
  backendFramework?: string;
  runtimeStrategy?: string;
}
