import { Test, TestingModule } from '@nestjs/testing';

import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('returns API overview', () => {
    const response = appController.getOverview();

    expect(response.name).toBe('Bolder Vibes API');
    expect(response.workflow).toContain('build-sandbox');
  });
});
