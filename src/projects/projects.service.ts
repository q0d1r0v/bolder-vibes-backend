import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { buildPaginatedResponse } from '@/common/utils/pagination.util';
import { slugify } from '@/common/utils/slugify.util';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateProjectDto } from '@/projects/dto/create-project.dto';
import { ListProjectsQueryDto } from '@/projects/dto/list-projects-query.dto';
import { UpdateProjectDto } from '@/projects/dto/update-project.dto';
import { RealtimeService } from '@/realtime/realtime.service';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async createProject(dto: CreateProjectDto) {
    this.assertRequiredString(dto.name, 'name');
    this.assertRequiredString(dto.ownerEmail, 'ownerEmail');

    const owner = await this.prisma.user.upsert({
      where: { email: dto.ownerEmail },
      update: {
        displayName: dto.ownerDisplayName,
      },
      create: {
        email: dto.ownerEmail,
        displayName: dto.ownerDisplayName,
      },
    });

    const slug = await this.generateUniqueSlug(dto.name);

    const project = await this.prisma.project.create({
      data: {
        name: dto.name.trim(),
        slug,
        description: dto.description?.trim(),
        frontendFramework: dto.frontendFramework ?? 'nextjs',
        backendFramework: dto.backendFramework ?? 'nestjs',
        runtimeStrategy: dto.runtimeStrategy ?? 'docker-sandbox',
        ownerId: owner.id,
        versions: {
          create: {
            version: 1,
            summary: 'Project created',
            source: 'SYSTEM',
            manifest: {
              stage: 'foundation',
              changedPaths: [],
            },
          },
        },
        runtime: {
          create: {
            status: 'STOPPED',
            provider: 'DOCKER',
          },
        },
      },
      include: projectDetailInclude,
    });

    this.realtimeService.emitProjectEvent(project.id, 'project.created', {
      project,
    });

    return project;
  }

  async listProjects(query: ListProjectsQueryDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(50, Math.max(1, Number(query.limit ?? 10)));

    const where: Prisma.ProjectWhereInput = {
      owner: query.ownerEmail
        ? {
            email: query.ownerEmail,
          }
        : undefined,
      status: query.status,
      OR: query.search
        ? [
            { name: { contains: query.search, mode: 'insensitive' } },
            { slug: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        include: projectListInclude,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.project.count({ where }),
    ]);

    return buildPaginatedResponse(items, total, page, limit);
  }

  async getProject(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: projectDetailInclude,
    });

    if (!project) {
      throw new NotFoundException(`Project ${projectId} was not found.`);
    }

    return project;
  }

  async updateProject(projectId: string, dto: UpdateProjectDto) {
    await this.ensureProject(projectId);

    const project = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        name: dto.name?.trim(),
        description: dto.description?.trim(),
        status: dto.status,
        previewUrl: dto.previewUrl,
      },
      include: projectDetailInclude,
    });

    this.realtimeService.emitProjectEvent(projectId, 'project.updated', {
      project,
    });

    return project;
  }

  async ensureProject(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        previewUrl: true,
      },
    });

    if (!project) {
      throw new NotFoundException(`Project ${projectId} was not found.`);
    }

    return project;
  }

  private async generateUniqueSlug(name: string) {
    const baseSlug = slugify(name) || 'project';
    let slug = baseSlug;
    let index = 1;

    while (
      await this.prisma.project.findUnique({
        where: { slug },
        select: { id: true },
      })
    ) {
      index += 1;
      slug = `${baseSlug}-${index}`;
    }

    return slug;
  }

  private assertRequiredString(value: string | undefined, fieldName: string) {
    if (!value?.trim()) {
      throw new BadRequestException(`${fieldName} is required.`);
    }
  }
}

const projectListInclude = {
  owner: {
    select: {
      id: true,
      email: true,
      displayName: true,
    },
  },
  runtime: {
    select: {
      id: true,
      status: true,
      previewUrl: true,
      updatedAt: true,
    },
  },
  _count: {
    select: {
      chats: true,
      files: true,
      versions: true,
      promptRuns: true,
    },
  },
} satisfies Prisma.ProjectInclude;

const projectDetailInclude = {
  owner: {
    select: {
      id: true,
      email: true,
      displayName: true,
    },
  },
  chats: {
    orderBy: {
      updatedAt: 'desc',
    },
    include: {
      _count: {
        select: {
          messages: true,
        },
      },
    },
  },
  files: {
    orderBy: {
      updatedAt: 'desc',
    },
  },
  versions: {
    orderBy: {
      version: 'desc',
    },
    take: 10,
  },
  promptRuns: {
    orderBy: {
      createdAt: 'desc',
    },
    take: 10,
  },
  runtime: {
    include: {
      events: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 15,
      },
    },
  },
} satisfies Prisma.ProjectInclude;
