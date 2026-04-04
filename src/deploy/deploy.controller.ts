import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Res,
  Header,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProduces } from '@nestjs/swagger';
import type { Response } from 'express';
import { DeployService } from './deploy.service.js';
import { DeployProjectDto, DeployProvider } from './dtos/index.js';
import { CurrentUser } from '@/common/decorators/index.js';
import { ParseUuidPipe } from '@/common/pipes/index.js';

@ApiTags('Deploy')
@ApiBearerAuth()
@Controller('projects/:projectId/deploy')
export class DeployController {
  constructor(private readonly deployService: DeployService) {}

  @Get('download')
  @ApiProduces('application/zip')
  @Header('Content-Type', 'application/zip')
  async downloadZip(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @CurrentUser('id') userId: string,
    @Res() res: Response,
  ) {
    const { buffer, projectName } = await this.deployService.generateZipBuffer(
      projectId,
      userId,
    );

    const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName}.zip"`,
    );
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Post()
  async deploy(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @Body() dto: DeployProjectDto,
    @CurrentUser('id') userId: string,
  ) {
    if (dto.provider === DeployProvider.DOWNLOAD) {
      return {
        success: true,
        data: {
          provider: 'download',
          downloadUrl: `/api/v1/projects/${projectId}/deploy/download`,
        },
      };
    }

    if (dto.provider === DeployProvider.VERCEL) {
      const result = await this.deployService.deployToVercel(
        projectId,
        userId,
        dto.token!,
        dto.projectName,
      );
      return { success: true, data: result };
    }

    if (dto.provider === DeployProvider.RAILWAY) {
      const result = await this.deployService.deployToRailway(
        projectId,
        userId,
        dto.token || dto.railwayToken!,
        dto.projectName,
      );
      return { success: true, data: result };
    }

    return { success: false, error: 'Unsupported provider' };
  }
}
