import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';
import { ProjectStatus } from '@/common/enums/project-status.enum';

export class ListProjectsQueryDto extends PaginationQueryDto {
  search?: string;
  ownerEmail?: string;
  status?: ProjectStatus;
}
