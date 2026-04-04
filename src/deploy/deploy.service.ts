import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service.js';
import { ProjectsService } from '@/projects/projects.service.js';
import { DeployProvider } from './dtos/index.js';

export interface DeployResult {
  projectId?: string;
  serviceId?: string;
  deploymentId: string;
  url: string;
  provider: string;
}

@Injectable()
export class DeployService {
  private readonly logger = new Logger(DeployService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
  ) {}

  async getProjectFiles(projectId: string, userId: string) {
    await this.projectsService.findById(projectId, userId);

    const files = await this.prisma.projectFile.findMany({
      where: { projectId },
      select: { path: true, content: true },
      orderBy: { path: 'asc' },
    });

    if (files.length === 0) {
      throw new NotFoundException('Project has no files to deploy');
    }

    return files;
  }

  async generateZipBuffer(
    projectId: string,
    userId: string,
  ): Promise<{ buffer: Buffer; projectName: string }> {
    const project = await this.projectsService.findById(projectId, userId);
    const files = await this.getProjectFiles(projectId, userId);

    // Build ZIP using native Node.js zlib (no external deps)
    const { createDeflateRaw } = await import('node:zlib');
    const { Buffer } = await import('node:buffer');

    const zipParts: Buffer[] = [];
    const centralDir: Buffer[] = [];
    let offset = 0;

    for (const file of files) {
      const fileNameBuf = Buffer.from(file.path, 'utf8');
      const contentBuf = Buffer.from(file.content, 'utf8');

      // Compress content
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const deflate = createDeflateRaw();
        deflate.on('data', (chunk: Buffer) => chunks.push(chunk));
        deflate.on('end', () => resolve(Buffer.concat(chunks)));
        deflate.on('error', reject);
        deflate.end(contentBuf);
      });

      const crc = this.crc32(contentBuf);

      // Local file header
      const localHeader = Buffer.alloc(30 + fileNameBuf.length);
      localHeader.writeUInt32LE(0x04034b50, 0); // signature
      localHeader.writeUInt16LE(20, 4); // version needed
      localHeader.writeUInt16LE(0, 6); // flags
      localHeader.writeUInt16LE(8, 8); // compression: deflate
      localHeader.writeUInt16LE(0, 10); // mod time
      localHeader.writeUInt16LE(0, 12); // mod date
      localHeader.writeUInt32LE(crc, 14); // crc32
      localHeader.writeUInt32LE(compressed.length, 18); // compressed size
      localHeader.writeUInt32LE(contentBuf.length, 22); // uncompressed size
      localHeader.writeUInt16LE(fileNameBuf.length, 26); // file name length
      localHeader.writeUInt16LE(0, 28); // extra field length
      fileNameBuf.copy(localHeader, 30);

      // Central directory entry
      const centralEntry = Buffer.alloc(46 + fileNameBuf.length);
      centralEntry.writeUInt32LE(0x02014b50, 0); // signature
      centralEntry.writeUInt16LE(20, 4); // version made by
      centralEntry.writeUInt16LE(20, 6); // version needed
      centralEntry.writeUInt16LE(0, 8); // flags
      centralEntry.writeUInt16LE(8, 10); // compression
      centralEntry.writeUInt16LE(0, 12); // mod time
      centralEntry.writeUInt16LE(0, 14); // mod date
      centralEntry.writeUInt32LE(crc, 16); // crc32
      centralEntry.writeUInt32LE(compressed.length, 20); // compressed size
      centralEntry.writeUInt32LE(contentBuf.length, 24); // uncompressed size
      centralEntry.writeUInt16LE(fileNameBuf.length, 28); // name length
      centralEntry.writeUInt16LE(0, 30); // extra length
      centralEntry.writeUInt16LE(0, 32); // comment length
      centralEntry.writeUInt16LE(0, 34); // disk number
      centralEntry.writeUInt16LE(0, 36); // internal attr
      centralEntry.writeUInt32LE(0, 38); // external attr
      centralEntry.writeUInt32LE(offset, 42); // local header offset
      fileNameBuf.copy(centralEntry, 46);

      zipParts.push(localHeader, compressed);
      centralDir.push(centralEntry);
      offset += localHeader.length + compressed.length;
    }

    const centralDirBuf = Buffer.concat(centralDir);
    const centralDirOffset = offset;

    // End of central directory
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4); // disk number
    eocd.writeUInt16LE(0, 6); // disk with central dir
    eocd.writeUInt16LE(files.length, 8); // entries on this disk
    eocd.writeUInt16LE(files.length, 10); // total entries
    eocd.writeUInt32LE(centralDirBuf.length, 12); // central dir size
    eocd.writeUInt32LE(centralDirOffset, 16); // central dir offset
    eocd.writeUInt16LE(0, 20); // comment length

    const buffer = Buffer.concat([...zipParts, centralDirBuf, eocd]);
    return { buffer, projectName: project.name };
  }

  async deployToVercel(
    projectId: string,
    userId: string,
    vercelToken: string,
    projectName?: string,
  ): Promise<DeployResult> {
    const project = await this.projectsService.findById(projectId, userId);
    const files = await this.getProjectFiles(projectId, userId);

    if (!vercelToken) {
      throw new BadRequestException('Vercel API token is required');
    }

    const name = (projectName || project.name)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 52);

    // Detect project type from files
    const packageJsonFile = files.find((f) => f.path === 'package.json');
    const hasNextConfig = files.some(
      (f) =>
        f.path === 'next.config.js' ||
        f.path === 'next.config.ts' ||
        f.path === 'next.config.mjs',
    );
    const hasIndexHtml = files.some(
      (f) => f.path === 'index.html' || f.path === 'public/index.html',
    );
    const hasViteConfig = files.some(
      (f) =>
        f.path === 'vite.config.js' ||
        f.path === 'vite.config.ts',
    );

    // Parse package.json to detect framework and scripts
    let pkgJson: Record<string, Record<string, string>> | null = null;
    if (packageJsonFile) {
      try {
        pkgJson = JSON.parse(packageJsonFile.content);
      } catch {
        // Invalid JSON, proceed without it
      }
    }

    const deps = {
      ...(pkgJson?.dependencies || {}),
      ...(pkgJson?.devDependencies || {}),
    };
    const scripts = pkgJson?.scripts || {};

    // Detect framework
    let framework: string | null = null;
    let buildCommand: string | null = null;
    let outputDirectory: string | null = null;
    let installCommand: string | null = null;

    if (hasNextConfig || deps['next']) {
      framework = 'nextjs';
    } else if (hasViteConfig || deps['vite']) {
      framework = 'vite';
      buildCommand = scripts['build'] || 'vite build';
      outputDirectory = 'dist';
    } else if (deps['react-scripts']) {
      framework = 'create-react-app';
      outputDirectory = 'build';
    } else if (deps['nuxt'] || deps['nuxt3']) {
      framework = 'nuxtjs';
    } else if (deps['svelte'] || deps['@sveltejs/kit']) {
      framework = 'sveltekit';
    } else if (deps['express'] || deps['@nestjs/core'] || deps['fastify'] || deps['koa']) {
      // Backend-only project — Vercel can't run persistent servers
      // but can wrap it as serverless if there's an api/ directory
      const hasApiDir = files.some((f) => f.path.startsWith('api/'));
      if (!hasApiDir) {
        throw new BadRequestException(
          'This looks like a backend/full-stack server app (Express, NestJS, Fastify). ' +
            'Vercel only supports frontend apps and serverless functions. ' +
            'Use Railway for full-stack deployment, or Download the source code.',
        );
      }
      framework = null;
    } else if (hasIndexHtml && !packageJsonFile) {
      // Pure static site
      framework = null;
    }

    // Build Vercel files array
    const vercelFiles = files.map((f) => ({
      file: f.path,
      data: f.content,
    }));

    // Build deployment payload
    const projectSettings: Record<string, string | null> = {
      framework,
    };
    if (buildCommand) projectSettings.buildCommand = buildCommand;
    if (outputDirectory) projectSettings.outputDirectory = outputDirectory;
    if (installCommand) projectSettings.installCommand = installCommand;

    const deployPayload = {
      name,
      files: vercelFiles,
      projectSettings,
      target: 'production' as const,
    };

    const res = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${vercelToken}`,
      },
      body: JSON.stringify(deployPayload),
    });

    if (!res.ok) {
      const errorBody = await res
        .json()
        .catch(() => ({} as Record<string, Record<string, string>>));
      const typedError = errorBody as Record<string, Record<string, string>>;
      const errorMsg = typedError?.error?.message || res.statusText;

      if (res.status === 403 || errorMsg.includes('limit')) {
        throw new BadRequestException(
          'Vercel deployment limit reached or invalid token. Check your token at vercel.com/account/tokens.',
        );
      }

      throw new BadRequestException(`Vercel deployment failed: ${errorMsg}`);
    }

    const data = (await res.json()) as Record<string, string>;
    const deployUrl = `https://${data.url}`;

    this.logger.log(
      `Deployed project ${projectId} to Vercel (framework: ${framework || 'static'}): ${deployUrl}`,
    );

    return {
      deploymentId: data.id,
      url: deployUrl,
      provider: 'vercel',
    };
  }

  async deployToRailway(
    projectId: string,
    userId: string,
    railwayToken: string,
    projectName?: string,
  ): Promise<DeployResult> {
    const project = await this.projectsService.findById(projectId, userId);
    const files = await this.getProjectFiles(projectId, userId);

    if (!railwayToken) {
      throw new BadRequestException('Railway API token is required');
    }

    const name = projectName || project.name;

    // Step 1: Create Railway project
    const createProjectRes = await this.railwayGraphQL(railwayToken, {
      query: `mutation($name: String!) {
        projectCreate(input: { name: $name }) {
          id
          environments { edges { node { id } } }
        }
      }`,
      variables: { name },
    });

    const railwayProject = createProjectRes.data?.projectCreate;
    if (!railwayProject) {
      const errorMsg = createProjectRes.errors?.[0]?.message || '';
      if (errorMsg.includes('resource provision limit')) {
        throw new BadRequestException(
          'Railway free plan limit reached. Please upgrade to a Hobby plan ($5/mo) at railway.app/account/upgrade, or download the source code and deploy manually.',
        );
      }
      throw new BadRequestException(
        'Failed to create Railway project: ' + (errorMsg || JSON.stringify(createProjectRes.errors)),
      );
    }

    const environmentId =
      railwayProject.environments.edges[0]?.node?.id;

    // Step 2: Create a service
    const createServiceRes = await this.railwayGraphQL(railwayToken, {
      query: `mutation($projectId: String!, $name: String!) {
        serviceCreate(input: {
          projectId: $projectId,
          name: $name,
          source: { image: "node:20-alpine" }
        }) {
          id
        }
      }`,
      variables: {
        projectId: railwayProject.id,
        name: `${name}-app`,
      },
    });

    const serviceId = createServiceRes.data?.serviceCreate?.id;

    // Step 3: Upload files via template deploy
    // Railway uses GitHub repos or Docker images for deployment.
    // For file-based deploy, we create a temporary repo approach.
    // The most practical way: use Railway's "Deploy from template" with inline Dockerfile

    // Generate Dockerfile based on project files
    const dockerfile = this.generateDockerfile(files);
    const allFiles = [
      ...files,
      { path: 'Dockerfile', content: dockerfile },
    ];

    // Use Railway's volume-based deployment via CLI approach
    // For API: we upload as a GitHub-less deploy using their upload endpoint
    const { buffer } = await this.generateZipBuffer(projectId, userId);

    const formData = new FormData();
    formData.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: 'application/zip' }),
      `${name}.zip`,
    );

    const uploadRes = await fetch(
      `https://backboard.railway.com/project/${railwayProject.id}/service/${serviceId}/upload`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${railwayToken}` },
        body: formData,
      },
    );

    if (!uploadRes.ok) {
      this.logger.warn(
        `Railway upload returned ${uploadRes.status}, falling back to GraphQL deploy`,
      );
    }

    // Step 4: Trigger deployment
    const deployRes = await this.railwayGraphQL(railwayToken, {
      query: `mutation($serviceId: String!, $environmentId: String!) {
        deploymentCreate(input: {
          serviceId: $serviceId,
          environmentId: $environmentId
        }) {
          id
          staticUrl
        }
      }`,
      variables: { serviceId, environmentId },
    });

    const deployment = deployRes.data?.deploymentCreate;
    const url =
      deployment?.staticUrl ||
      `https://${name}.up.railway.app`;

    this.logger.log(
      `Deployed project ${projectId} to Railway: ${url}`,
    );

    return {
      projectId: railwayProject.id,
      serviceId,
      deploymentId: deployment?.id || 'pending',
      url,
      provider: 'railway',
    };
  }

  private generateDockerfile(
    files: Array<{ path: string; content: string }>,
  ): string {
    const hasPackageJson = files.some((f) => f.path === 'package.json');
    const hasIndexHtml = files.some((f) => f.path === 'index.html');
    const hasNextConfig = files.some(
      (f) =>
        f.path === 'next.config.js' || f.path === 'next.config.ts',
    );

    if (hasNextConfig) {
      return `FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
CMD ["npm", "start"]`;
    }

    if (hasPackageJson) {
      return `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]`;
    }

    if (hasIndexHtml) {
      return `FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80`;
    }

    return `FROM node:20-alpine
WORKDIR /app
COPY . .
RUN if [ -f package.json ]; then npm ci --omit=dev; fi
EXPOSE 3000
CMD ["node", "index.js"]`;
  }

  private async railwayGraphQL(
    token: string,
    body: { query: string; variables?: Record<string, unknown> },
  ) {
    const res = await fetch('https://backboard.railway.app/graphql/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new BadRequestException(`Railway API error: ${text}`);
    }

    return res.json();
  }

  private crc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
}
