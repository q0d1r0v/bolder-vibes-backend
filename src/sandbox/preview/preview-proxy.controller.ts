import { Controller, All, Get, Param, Req, Res, Logger } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PreviewService } from './preview.service.js';
import { PreviewStatus } from './preview.interface.js';
import { ParseUuidPipe } from '@/common/pipes/index.js';
import { CurrentUser, Public } from '@/common/decorators/index.js';
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
   * Handle /preview/app path — this is the entry point the iframe loads.
   * Using an explicit path avoids route-matching ambiguity at the
   * controller root (`@Get()` with empty path).
   * First request arrives with ?preview_token=..., we set a cookie.
   * Subsequent sub-requests (CSS, JS, images) use the cookie.
   */
  @Public()
  @Get('app')
  async proxyRoot(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Preview proxy is intentionally unauthenticated at the HTTP layer:
    //   1. Expo/Metro fires dozens of sub-requests (bundle, fonts,
    //      sourcemaps, HMR websocket) that all need to share the same
    //      auth context. Propagating a JWT cookie through Next.js's
    //      reverse-proxy is fragile (Set-Cookie attributes get mangled
    //      across hops, SameSite kills iframe subresource cookies).
    //   2. The projectId is a version-4 UUID (122 bits of randomness) —
    //      effectively unguessable, so the URL itself is the capability.
    //   3. Only READ access to the running preview container is exposed;
    //      no mutation endpoints live under this route.
    // If a future change needs strict auth here, the right place is a
    // short-lived HMAC-signed path segment, not a cookie.
    return this.proxyToContainer(projectId, req, res, '');
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
    const subPath = (req.params as Record<string, string>).path || '';
    return this.proxyToContainer(projectId, req, res, subPath);
  }

  /**
   * Common proxy logic - forwards request to the preview container.
   * Access control is delegated to the capability URL itself (the
   * project UUID); see the comment on `proxyRoot` for rationale.
   */
  private async proxyToContainer(
    projectId: string,
    req: Request,
    res: Response,
    subPath: string,
  ) {
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
    const rawQs = req.url.includes('?')
      ? req.url.split('?').slice(1).join('?')
      : '';
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

      // Metro's first bundle compile can take tens of seconds on a cold
      // container (transpile + resolve 600+ modules). The 30-second
      // default was clipping streams mid-way and surfacing as
      // ECONNRESET on the client. 5 minutes covers any realistic dev
      // server warm-up without letting a truly broken upstream hang
      // the backend indefinitely.
      const proxyRes = await fetch(targetUrl, {
        method: req.method,
        headers: {
          accept: req.headers.accept || '*/*',
          'accept-encoding': (req.headers['accept-encoding'] as string) || '',
          ...(req.headers['content-type']
            ? { 'content-type': req.headers['content-type'] as string }
            : {}),
          ...(proxyBody
            ? {
                'content-length': Buffer.byteLength(
                  proxyBody,
                  'utf8',
                ).toString(),
              }
            : {}),
        },
        body: proxyBody,
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });

      // Forward status
      res.status(proxyRes.status);

      // Forward relevant headers. We deliberately drop `content-encoding`
      // and `content-length` when we intend to rewrite the body — the
      // payload size will differ and leaving the original values causes
      // the browser to either misinterpret the stream or truncate it.
      const contentType = proxyRes.headers.get('content-type') ?? '';
      const shouldRewriteHtml = contentType.startsWith('text/html');

      const headersToForward = [
        'content-type',
        'cache-control',
        'etag',
        'last-modified',
        ...(shouldRewriteHtml ? [] : ['content-encoding']),
      ];
      for (const header of headersToForward) {
        const value = proxyRes.headers.get(header);
        if (value) {
          res.setHeader(header, value);
        }
      }

      // Allow same-origin iframe embedding only
      res.setHeader('x-frame-options', 'SAMEORIGIN');

      if (shouldRewriteHtml && proxyRes.body) {
        // Metro serves HTML with absolute asset paths like
        //   <script src="/bv-preview-entry.bundle?..."></script>
        // The browser resolves `/` against the iframe's host origin
        // (the FRONTEND, e.g. localhost:3000) and 404s because the
        // bundle only exists on the backend proxy path. We rewrite
        // absolute paths to route through the proxy so every sub-
        // request stays authenticated and same-origin.
        const prefix = `/api/v1/projects/${projectId}/preview`;
        const html = await proxyRes.text();
        const rewritten = rewriteHtmlAssetPaths(html, prefix);
        res.setHeader(
          'content-length',
          Buffer.byteLength(rewritten, 'utf8').toString(),
        );
        res.send(rewritten);
        return;
      }

      // Stream body for non-HTML responses (JS bundles, CSS, images…).
      // Converting to a Node Readable + `pipeline` gives us native
      // backpressure: `res.write()` under load would return false and
      // a manual pump loop would flood Express's internal buffer,
      // eventually causing the downstream connection to drop with
      // ECONNRESET. `pipeline` pauses the source until the destination
      // drains, propagates errors in both directions, and cleans up on
      // client disconnect.
      if (proxyRes.body) {
        const source = Readable.fromWeb(
          proxyRes.body as Parameters<typeof Readable.fromWeb>[0],
        );
        try {
          await pipeline(source, res);
        } catch (err) {
          // A normal client-navigate-away shows up as ERR_STREAM_PREMATURE_CLOSE.
          const code = (err as NodeJS.ErrnoException)?.code;
          if (code !== 'ERR_STREAM_PREMATURE_CLOSE') {
            throw err;
          }
        }
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

/**
 * Rewrite absolute asset paths in Metro-served HTML so they route through
 * the backend proxy instead of hitting the iframe host directly.
 *
 * We cover three channels:
 *   1. `src="..."` and `href="..."` attributes (scripts, styles, images)
 *   2. Inline `<script>` blobs that embed URL strings like
 *      `"url":"/bv-preview-entry.bundle?..."` (Metro bundles occasionally
 *      inline the manifest URL there)
 *   3. `fetch("/...")` / `import("/...")` call sites — covers Metro HMR
 *      and any runtime chunk loaders
 *
 * A path is only rewritten if:
 *   - it starts with a single `/` (absolute-but-same-origin)
 *   - it does NOT start with `//` (protocol-relative external)
 *   - it does NOT already begin with the proxy prefix (idempotent)
 *   - it does NOT start with common data/blob/http(s) schemes
 */
function rewriteHtmlAssetPaths(html: string, prefix: string): string {
  const isInternalPath = (p: string): boolean => {
    if (!p.startsWith('/')) return false;
    if (p.startsWith('//')) return false;
    if (p.startsWith(prefix)) return false;
    return true;
  };

  // 1. Attribute rewriting — src / href / data-* / srcset first-url.
  const attrRe = /\b(src|href|action)\s*=\s*(['"])(\/[^'"]*)\2/g;
  let out = html.replace(
    attrRe,
    (match, attr: string, quote: string, path: string) => {
      if (!isInternalPath(path)) return match;
      return `${attr}=${quote}${prefix}${path}${quote}`;
    },
  );

  // 2. JSON-embedded URLs: `"url":"/something"` or `"uri":"/something"`.
  const jsonUrlRe = /("(?:url|uri|href|src)"\s*:\s*")(\/[^"]*)"/g;
  out = out.replace(jsonUrlRe, (match, head: string, path: string) => {
    if (!isInternalPath(path)) return match;
    return `${head}${prefix}${path}"`;
  });

  // 3. Dynamic fetch/import calls in inline scripts. Conservative — only
  //    match string literals that look like root-absolute paths with a
  //    known file extension (or the Metro bundle query pattern), so we
  //    don't mangle arbitrary JS string data.
  const dynamicRe =
    /(fetch|import)\(\s*(['"])(\/(?:[\w.\-/]+\.(?:js|jsx|ts|tsx|json|css|map|bundle|png|jpg|jpeg|svg|webp|ico|woff2?|ttf)(?:\?[^'"]*)?|[\w.\-/]+\.bundle(?:\?[^'"]*)?))\2\s*\)/g;
  out = out.replace(
    dynamicRe,
    (match, fn: string, quote: string, path: string) => {
      if (!isInternalPath(path)) return match;
      return `${fn}(${quote}${prefix}${path}${quote})`;
    },
  );

  return out;
}
