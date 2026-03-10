import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service.js';
import { ProjectsService } from '@/projects/projects.service.js';
import { VersioningService } from './versioning/versioning.service.js';
import { CreateFileDto, UpdateFileDto } from './dtos/index.js';

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly versioningService: VersioningService,
  ) { }

  async create(projectId: string, dto: CreateFileDto, userId: string) {
    await this.projectsService.findById(projectId, userId);

    const file = await this.prisma.projectFile.create({
      data: {
        path: dto.path,
        content: dto.content,
        mimeType: dto.mimeType,
        size: Buffer.byteLength(dto.content, 'utf8'),
        projectId,
      },
    });

    // Create initial version
    await this.versioningService.createVersion(
      file.id,
      dto.content,
      null,
      dto.path,
      'Initial version',
    );

    return file;
  }

  async findAll(projectId: string, userId: string) {
    await this.projectsService.findById(projectId, userId);

    return this.prisma.projectFile.findMany({
      where: { projectId },
      select: {
        id: true,
        path: true,
        content: true,
        mimeType: true,
        size: true,
        updatedAt: true,
      },
      orderBy: { path: 'asc' },
    });
  }

  async findById(projectId: string, fileId: string, userId: string) {
    await this.projectsService.findById(projectId, userId);

    const file = await this.prisma.projectFile.findFirst({
      where: { id: fileId, projectId },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    return file;
  }

  async update(
    projectId: string,
    fileId: string,
    dto: UpdateFileDto,
    userId: string,
  ) {
    const file = await this.findById(projectId, fileId, userId);
    const oldContent = file.content;

    const updated = await this.prisma.projectFile.update({
      where: { id: fileId },
      data: {
        content: dto.content,
        size: Buffer.byteLength(dto.content, 'utf8'),
      },
    });

    // Create new version with diff
    await this.versioningService.createVersion(
      fileId,
      dto.content,
      oldContent,
      file.path,
      dto.message,
    );

    return updated;
  }

  async remove(projectId: string, fileId: string, userId: string) {
    await this.findById(projectId, fileId, userId);
    await this.prisma.projectFile.delete({ where: { id: fileId } });
    return { deleted: true };
  }

  async getVersions(projectId: string, fileId: string, userId: string) {
    await this.findById(projectId, fileId, userId);
    return this.versioningService.getVersions(fileId);
  }

  async restoreVersion(
    projectId: string,
    fileId: string,
    versionId: string,
    userId: string,
  ) {
    const file = await this.findById(projectId, fileId, userId);
    const version = await this.versioningService.getVersion(fileId, versionId);

    if (!version) {
      throw new NotFoundException('Version not found');
    }

    const updated = await this.prisma.projectFile.update({
      where: { id: fileId },
      data: {
        content: version.content,
        size: Buffer.byteLength(version.content, 'utf8'),
      },
    });

    await this.versioningService.createVersion(
      fileId,
      version.content,
      file.content,
      file.path,
      `Restored to version ${version.version}`,
    );

    return updated;
  }
}
