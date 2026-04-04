import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service.js';
import { CreateProjectDto, UpdateProjectDto } from './dtos/index.js';
import { PaginationDto, PaginatedResponseDto } from '@/common/dtos/index.js';
import { TemplatesService } from './templates/templates.service.js';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templatesService: TemplatesService,
  ) {}

  async create(dto: CreateProjectDto, userId: string) {
    const project = await this.prisma.project.create({
      data: {
        name: dto.name,
        description: dto.description,
        templateId: dto.templateId,
        ownerId: userId,
      },
    });

    // If template is specified, create template files
    if (dto.templateId) {
      const template = this.templatesService.findById(dto.templateId);
      await this.prisma.projectFile.createMany({
        data: template.files.map((file) => ({
          path: file.path,
          content: file.content,
          size: Buffer.byteLength(file.content, 'utf8'),
          projectId: project.id,
        })),
      });
    }

    return project;
  }

  async findAll(userId: string, pagination: PaginationDto) {
    const where: Record<string, unknown> = {
      ownerId: userId,
      status: pagination.status
        ? pagination.status
        : { not: 'DELETED' as const },
    };

    if (pagination.search) {
      where.name = { contains: pagination.search, mode: 'insensitive' };
    }

    const [projects, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { updatedAt: 'desc' },
        include: { _count: { select: { files: true } } },
      }),
      this.prisma.project.count({ where }),
    ]);

    return new PaginatedResponseDto(
      projects,
      total,
      pagination.page!,
      pagination.limit!,
    );
  }

  async findById(id: string, userId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        _count: { select: { files: true, conversations: true } },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (project.ownerId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return project;
  }

  async update(id: string, dto: UpdateProjectDto, userId: string) {
    await this.findById(id, userId);
    return this.prisma.project.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, userId: string) {
    await this.findById(id, userId);
    return this.prisma.project.update({
      where: { id },
      data: { status: 'DELETED' },
    });
  }

  getTemplates() {
    return this.templatesService.getAll();
  }
}
