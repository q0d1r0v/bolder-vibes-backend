import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../decorators/index.js';
import { MetricsService } from './metrics.service.js';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  // Public + no-throttle: Prometheus scrapes every ~15 s. If this endpoint
  // is exposed to the public internet, protect it at the ingress layer
  // (IP allow-list or mTLS), not inside the app.
  @Public()
  @SkipThrottle()
  @Get()
  @Header('Cache-Control', 'no-store')
  async render(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', this.metrics.contentType());
    res.send(await this.metrics.render());
  }
}
