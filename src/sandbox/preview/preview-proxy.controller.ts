import {
  Controller,
  All,
  Get,
  Param,
  Req,
  Res,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PreviewService } from './preview.service.js';
import { PreviewStatus } from './preview.interface.js';
import { ParseUuidPipe } from '@/common/pipes/index.js';
import { CurrentUser } from '@/common/decorators/index.js';
import { Public } from '@/common/decorators/index.js';
import { ProjectsService } from '@/projects/projects.service.js';

/**
 * Reverse-proxy controller that forwards browser requests to the
 * preview Docker container.  The iframe on the frontend loads
 *   /api/v1/projects/:id/preview/*
 * and this controller streams the response back from
 *   http://localhost:<dynamic-port>/*
 *
 * This avoids CORS / mixed-content issues because the iframe URL
 * shares the same origin as the rest of the API.
 */
@ApiTags('Preview Proxy')
@ApiBearerAuth()
@Controller('projects/:projectId/preview')
export class PreviewProxyController {
  private readonly logger = new Logger(PreviewProxyController.name);

  constructor(
    private readonly previewService: PreviewService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Issue a short-lived preview token for iframe authentication.
   * Called by the frontend before loading the iframe src.
   */
  @Get('token')
  async getPreviewToken(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.projectsService.findById(projectId, userId);
    const token = await this.previewService.createPreviewToken(
      projectId,
      userId,
    );
    return { token };
  }

  /**
   * Handle root /preview path (without trailing content).
   * First request arrives with ?preview_token=..., we set a cookie.
   * Subsequent sub-requests (CSS, JS, images) use the cookie.
   */
  @Public()
  @Get()
  async proxyRoot(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = await this.authenticatePreviewRequest(req, res, projectId);
    if (!userId) return; // Response already sent (redirect for cookie set)
    return this.proxyToContainer(projectId, userId, req, res, '');
  }

  /**
   * Handle /preview/*path routes.
   */
  @Public()
  @All('*path')
  async proxyWildcard(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = await this.authenticatePreviewRequest(req, res, projectId);
    if (!userId) return;
    const subPath = (req.params as Record<string, string>).path || '';
    return this.proxyToContainer(projectId, userId, req, res, subPath);
  }

  /**
   * Authenticate preview request via:
   * 1. preview_token query param (first load) → sets httpOnly cookie
   * 2. preview_session cookie (subsequent sub-requests)
   * Returns userId on success, null if response already handled.
   */
  private async authenticatePreviewRequest(
    req: Request,
    res: Response,
    projectId: string,
  ): Promise<string | null> {
    // 1. Check query param token (initial iframe load)
    const queryToken = req.query['preview_token'] as string | undefined;
    if (queryToken) {
      const tokenData = await this.previewService.validatePreviewToken(queryToken);
      if (!tokenData || tokenData.projectId !== projectId) {
        res.status(401).json({ error: 'Invalid or expired preview token' });
        return null;
      }
      // Set httpOnly cookie so sub-requests (CSS/JS/images) are also authenticated
      const cookieName = `pv_${projectId.replace(/-/g, '').slice(0, 12)}`;
      res.cookie(cookieName, queryToken, {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 5 * 60 * 1000, // 5 minutes, matches token TTL
        path: `/api/v1/projects/${projectId}/preview`,
      });
      return tokenData.userId;
    }

    // 2. Check cookie (sub-requests within the iframe)
    const cookieName = `pv_${projectId.replace(/-/g, '').slice(0, 12)}`;
    const cookieToken = req.cookies?.[cookieName] as string | undefined;
    if (cookieToken) {
      const tokenData = await this.previewService.validatePreviewToken(cookieToken);
      if (tokenData && tokenData.projectId === projectId) {
        return tokenData.userId;
      }
    }

    res.status(401).json({ error: 'Preview authentication required' });
    return null;
  }

  /**
   * Common proxy logic - forwards request to the preview container
   */
  private async proxyToContainer(
    projectId: string,
    userId: string,
    req: Request,
    res: Response,
    subPath: string,
  ) {
    // Verify project ownership
    await this.projectsService.findById(projectId, userId);

    const state = await this.previewService.getPreviewStatus(projectId);
    // Record access time for idle reaper
    this.previewService.touchPreview(projectId).catch(() => {});
    if (state.status !== PreviewStatus.READY || !state.url) {
      res.status(503).json({
        success: false,
        error: 'Preview is not running',
        status: state.status,
      });
      return;
    }

    // Build target URL — strip preview_token from query string (it's for auth only)
    const rawQs = req.url.includes('?') ? req.url.split('?').slice(1).join('?') : '';
    const cleanQs = rawQs
      .split('&')
      .filter((p) => !p.startsWith('preview_token='))
      .join('&');
    const targetUrl = `${state.url}/${subPath}${cleanQs ? '?' + cleanQs : ''}`;

    try {
      // For the proxy, we need to handle the body properly
      // GET/HEAD have no body, other methods forward the parsed body
      let proxyBody: string | undefined = undefined;
      
      if (!['GET', 'HEAD'].includes(req.method)) {
        // If body exists, forward it as-is
        // Express has already parsed req.body, so we serialize it appropriately
        if (req.body !== undefined && req.body !== null) {
          // Check if it's already a string (raw body) or object (parsed JSON)
          if (typeof req.body === 'string') {
            proxyBody = req.body;
          } else {
            // It's a parsed object - convert back to JSON
            proxyBody = JSON.stringify(req.body);
          }
        }
      }

      const proxyRes = await fetch(targetUrl, {
        method: req.method,
        headers: {
          'accept': req.headers.accept || '*/*',
          'accept-encoding': req.headers['accept-encoding'] as string || '',
          ...(req.headers['content-type']
            ? { 'content-type': req.headers['content-type'] as string }
            : {}),
          ...(proxyBody ? { 'content-length': Buffer.byteLength(proxyBody, 'utf8').toString() } : {}),
        },
        body: proxyBody,
        signal: AbortSignal.timeout(30000),
      });

      // Forward status
      res.status(proxyRes.status);

      // Forward relevant headers
      const headersToForward = [
        'content-type',
        'cache-control',
        'etag',
        'last-modified',
        'content-encoding',
      ];
      for (const header of headersToForward) {
        const value = proxyRes.headers.get(header);
        if (value) {
          res.setHeader(header, value);
        }
      }

      // Allow same-origin iframe embedding only
      res.setHeader('x-frame-options', 'SAMEORIGIN');

      // Stream body
      if (proxyRes.body) {
        const reader = proxyRes.body.getReader();
        const pump = async (): Promise<void> => {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            return;
          }
          res.write(Buffer.from(value));
          return pump();
        };
        await pump();
      } else {
        res.end();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Proxy error';
      this.logger.warn(`Preview proxy failed for ${projectId}: ${msg}`);
      if (!res.headersSent) {
        res.status(502).json({ success: false, error: 'Preview unavailable' });
      }
    }
  }
}
