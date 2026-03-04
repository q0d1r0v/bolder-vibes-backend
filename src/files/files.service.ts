import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

import { PrismaService } from '@/prisma/prisma.service';
import { ProjectsService } from '@/projects/projects.service';
import { RealtimeService } from '@/realtime/realtime.service';
import { ListProjectFilesQueryDto } from '@/files/dto/list-project-files-query.dto';
import {
  ProjectFileInputDto,
  UpsertProjectFilesDto,
} from '@/files/dto/upsert-project-file.dto';

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async listFiles(projectId: string, query: ListProjectFilesQueryDto) {
    await this.projectsService.ensureProject(projectId);

    return this.prisma.projectFile.findMany({
      where: {
        projectId,
        path: query.pathPrefix
          ? {
              startsWith: query.pathPrefix,
            }
          : undefined,
      },
      orderBy: {
        path: 'asc',
      },
    });
  }

  async saveFiles(projectId: string, dto: UpsertProjectFilesDto) {
    await this.projectsService.ensureProject(projectId);

    if (!dto.files?.length) {
      throw new BadRequestException('files must contain at least one item.');
    }

    const deduplicatedPaths = new Set<string>();
    dto.files.forEach((file) => {
      this.assertFile(file);
      if (deduplicatedPaths.has(file.path)) {
        throw new BadRequestException(`Duplicate file path: ${file.path}`);
      }
      deduplicatedPaths.add(file.path);
    });

    const requestedBy = dto.requestedByEmail?.trim()
      ? await this.prisma.user.upsert({
          where: { email: dto.requestedByEmail.trim() },
          update: {},
          create: { email: dto.requestedByEmail.trim() },
        })
      : null;

    const result = await this.prisma.$transaction(async (transaction) => {
      for (const file of dto.files) {
        await transaction.projectFile.upsert({
          where: {
            projectId_path: {
              projectId,
              path: file.path,
            },
          },
          create: this.buildFilePayload(projectId, file),
          update: this.buildFilePayload(projectId, file),
        });
      }

      const latestVersion = await transaction.projectVersion.findFirst({
        where: { projectId },
        orderBy: {
          version: 'desc',
        },
        select: {
          version: true,
        },
      });

      const version = await transaction.projectVersion.create({
        data: {
          projectId,
          version: (latestVersion?.version ?? 0) + 1,
          source: dto.source ?? 'AI',
          summary: dto.summary ?? `Updated ${dto.files.length} files`,
          createdById: requestedBy?.id,
          manifest: {
            changedPaths: dto.files.map((file) => file.path),
            fileCount: dto.files.length,
          },
        },
      });

      const files = await transaction.projectFile.findMany({
        where: { projectId },
        orderBy: {
          path: 'asc',
        },
      });

      return {
        version,
        files,
      };
    });

    this.realtimeService.emitProjectEvent(projectId, 'files.saved', {
      changedPaths: dto.files.map((file) => file.path),
      version: result.version,
      totalFiles: result.files.length,
    });

    return result;
  }

  private assertFile(file: ProjectFileInputDto) {
    if (!file.path?.trim()) {
      throw new BadRequestException('file path is required.');
    }

    if (!file.content?.trim() && file.content !== '') {
      throw new BadRequestException(`content is required for ${file.path}.`);
    }
  }

  private buildFilePayload(projectId: string, file: ProjectFileInputDto) {
    return {
      projectId,
      path: file.path.trim(),
      content: file.content,
      language: file.language?.trim(),
      kind: file.kind ?? 'SOURCE',
      isEntry: Boolean(file.isEntry),
      sizeBytes: Buffer.byteLength(file.content, 'utf8'),
      checksum: createHash('sha256').update(file.content).digest('hex'),
    };
  }
}
