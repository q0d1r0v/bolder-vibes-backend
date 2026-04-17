import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import archiver from 'archiver';
import { PrismaService } from '@/prisma/prisma.service.js';
import { CreateProjectDto, UpdateProjectDto } from './dtos/index.js';
import { PaginationDto, PaginatedResponseDto } from '@/common/dtos/index.js';
import { TemplatesService } from './templates/templates.service.js';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templatesService: TemplatesService,
  ) {}

  async create(dto: CreateProjectDto, userId: string) {
    // Default to 'custom' industry so every project gets Expo starter files.
    const industryId = dto.templateId || 'custom';

    const project = await this.prisma.project.create({
      data: {
        name: dto.name,
        description: dto.description,
        templateId: industryId,
        settings: { industry: industryId },
        ownerId: userId,
      },
    });

    const template = this.templatesService.findById(industryId);
    await this.prisma.projectFile.createMany({
      data: template.files.map((file) => ({
        path: file.path,
        content: file.content,
        size: Buffer.byteLength(file.content, 'utf8'),
        projectId: project.id,
      })),
    });

    return project;
  }

  async findAll(userId: string, pagination: PaginationDto) {
    const where: Record<string, unknown> = {
      ownerId: userId,
      status: pagination.status
        ? pagination.status
        : { not: 'DELETED' as const },
    };

    if (pagination.search) {
      where.name = { contains: pagination.search, mode: 'insensitive' };
    }

    const [projects, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { updatedAt: 'desc' },
        include: { _count: { select: { files: true } } },
      }),
      this.prisma.project.count({ where }),
    ]);

    return new PaginatedResponseDto(
      projects,
      total,
      pagination.page!,
      pagination.limit!,
    );
  }

  async findById(id: string, userId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        _count: { select: { files: true, conversations: true } },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (project.ownerId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return project;
  }

  async update(id: string, dto: UpdateProjectDto, userId: string) {
    await this.findById(id, userId);
    return this.prisma.project.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, userId: string) {
    await this.findById(id, userId);
    return this.prisma.project.update({
      where: { id },
      data: { status: 'DELETED' },
    });
  }

  getTemplates() {
    return this.templatesService.getAll();
  }

  /**
   * Build a streaming ZIP archive of the project's full source code,
   * ready to be piped straight into an HTTP response. The archive
   * contains every file the AI ever wrote (DB is the source of truth),
   * plus a few deploy-helper files so users who self-host don't have to
   * assemble them manually.
   *
   * Streams to avoid buffering the whole project in memory — works even
   * for large projects (hundreds of files, tens of MB).
   */
  async buildProjectZip(
    id: string,
    userId: string,
  ): Promise<{ archive: archiver.Archiver; filename: string }> {
    const project = await this.findById(id, userId);

    const files = await this.prisma.projectFile.findMany({
      where: { projectId: id },
      select: { path: true, content: true },
      orderBy: { path: 'asc' },
    });

    const archive = archiver('zip', { zlib: { level: 9 } });

    for (const file of files) {
      archive.append(file.content, { name: file.path });
    }

    const hasServer = files.some((f) => f.path.startsWith('server/'));
    const hasPrismaSchema = files.some((f) =>
      f.path.includes('prisma/schema.prisma'),
    );

    archive.append(buildDownloadReadme(project.name, hasServer, hasPrismaSchema), {
      name: 'README.md',
    });
    archive.append(buildGitignore(), { name: '.gitignore' });

    if (hasServer) {
      archive.append(buildServerEnvExample(hasPrismaSchema), {
        name: 'server/.env.example',
      });
    }

    archive.finalize().catch(() => {
      /* archiver emits 'error' on the stream; controller handles it */
    });

    const slug = project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'project';

    return { archive, filename: `${slug}-source.zip` };
  }
}

function buildDownloadReadme(
  projectName: string,
  hasServer: boolean,
  hasPrismaSchema: boolean,
): string {
  const mobileSection = `## Mobile app (Expo)

\`\`\`bash
npm install
npx expo start
\`\`\`

- Web preview: press \`w\`
- Android/iOS on device: scan the QR code with Expo Go
`;

  const serverSection = hasServer
    ? `
## Backend (Express + Node)

\`\`\`bash
cd server
cp .env.example .env   # edit values
npm install
${hasPrismaSchema ? 'npx prisma generate\nnpx prisma db push\n' : ''}npm run dev
\`\`\`

Backend listens on port 3001 and serves routes under \`/api/*\`.

### Connecting the mobile app to the backend

During Bolder Vibes preview, a built-in reverse proxy routes \`/api/*\`
to the backend automatically — that is why the mobile code uses
relative URLs like \`fetch('/api/todos')\`.

Outside Bolder Vibes, you have two options:

1. **Quick local dev** — run the backend on \`http://localhost:3001\`
   and set \`EXPO_PUBLIC_API_URL\` in the Expo app to the same URL
   (adjust fetches from \`/api/...\` to \`\${process.env.EXPO_PUBLIC_API_URL}/api/...\`).
2. **Production deploy** — host the backend on Railway, Render, Fly.io
   or any Node-compatible platform, then point \`EXPO_PUBLIC_API_URL\`
   at the public URL.

### Deploy checklist

- Node ≥ 20
${hasPrismaSchema ? '- PostgreSQL database (the `DATABASE_URL` env var)\n' : ''}- Set any extra env vars your routes read
- Run \`npm run build && npm start\` (or let your host do it)
`
    : '';

  return `# ${projectName}

Generated with [Bolder Vibes](https://boldervibes.com) — an AI-powered
mobile app builder.

${mobileSection}${serverSection}
## License

You own the code. Do whatever you want with it.
`;
}

function buildGitignore(): string {
  return `# Dependencies
node_modules/
server/node_modules/

# Builds
.expo/
dist/
web-build/
*.tsbuildinfo

# Env
.env
.env.local
server/.env

# OS / editor
.DS_Store
Thumbs.db
.vscode/
.idea/

# Prisma
server/prisma/migrations/dev.db*

# Logs
*.log
npm-debug.log*
`;
}

function buildServerEnvExample(hasPrisma: boolean): string {
  const lines = ['PORT=3001', 'HOST=0.0.0.0'];
  if (hasPrisma) {
    lines.push('DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app');
  }
  return lines.join('\n') + '\n';
}
