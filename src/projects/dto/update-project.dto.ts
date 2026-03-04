import { ProjectStatus } from '@/common/enums/project-status.enum';

export class UpdateProjectDto {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  previewUrl?: string;
}
