import { Injectable, NotFoundException } from '@nestjs/common';
import { PROJECT_TEMPLATES, ProjectTemplate } from './template-registry.js';

@Injectable()
export class TemplatesService {
  getAll(): ProjectTemplate[] {
    return PROJECT_TEMPLATES;
  }

  findById(id: string): ProjectTemplate {
    const template = PROJECT_TEMPLATES.find((t) => t.id === id);
    if (!template) {
      throw new NotFoundException(`Template "${id}" not found`);
    }
    return template;
  }
}
