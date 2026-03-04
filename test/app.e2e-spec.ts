import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AppModule } from '@/app.module';
import { configureApp } from '@/bootstrap';
import { HealthController } from '@/health/health.controller';

describe('Health module integration', () => {
  let app: INestApplication;
  let healthController: HealthController;

  beforeAll(async () => {
    process.env.SKIP_DB_CONNECT = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    healthController = app.get(HealthController);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('returns health payload', () => {
    const response = healthController.getHealth();

    expect(response.status).toBe('ok');
    expect(response.service).toBe('Bolder Vibes API');
    expect(response.databaseConnectionSkipped).toBe(true);
  });
});
