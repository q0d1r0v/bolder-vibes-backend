import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service.js';
import { computeDiff } from './diff.util.js';

@Injectable()
export class VersioningService {
  constructor(private readonly prisma: PrismaService) {}

  async createVersion(
    fileId: string,
    newContent: string,
    oldContent: string | null,
    filePath: string,
    message?: string,
    agentStepId?: string,
  ) {
    const lastVersion = await this.prisma.fileVersion.findFirst({
      where: { fileId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const nextVersion = (lastVersion?.version ?? 0) + 1;
    const diff = oldContent ? computeDiff(oldContent, newContent, filePath) : null;

    return this.prisma.fileVersion.create({
      data: {
        fileId,
        version: nextVersion,
        content: newContent,
        diff,
        message: message || `Version ${nextVersion}`,
        agentStepId,
      },
    });
  }

  async getVersions(fileId: string) {
    return this.prisma.fileVersion.findMany({
      where: { fileId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        message: true,
        createdAt: true,
      },
    });
  }

  async getVersion(fileId: string, versionId: string) {
    return this.prisma.fileVersion.findFirst({
      where: { id: versionId, fileId },
    });
  }
}
