import { Injectable } from '@nestjs/common';

import { getAppConfig } from '@/config/app.config';

@Injectable()
export class RuntimeCommandFactory {
  private readonly config = getAppConfig();

  build(projectId: string, requestedPort?: number) {
    const hostPort = requestedPort ?? deriveProjectPort(projectId);
    const imageTag = `bolder-vibes-project-${projectId.slice(0, 12)}`;
    const containerName = `bolder-vibes-sandbox-${projectId.slice(0, 12)}`;
    const projectPath = `${this.config.projectsRoot}/${projectId}`;

    return {
      hostPort,
      imageTag,
      containerName,
      previewUrl: `${this.config.previewBaseUrl}/projects/${projectId}`,
      cpuLimit: this.config.runtimeCpuLimit,
      memoryLimitMb: this.config.runtimeMemoryMb,
      networkMode: this.config.dockerNetwork,
      buildCommand: `docker build -t ${imageTag} ${projectPath}`,
      startCommand: [
        'docker run -d',
        `--name ${containerName}`,
        `--cpus=${this.config.runtimeCpuLimit}`,
        `--memory=${this.config.runtimeMemoryMb}m`,
        '--pids-limit=256',
        '--security-opt=no-new-privileges',
        '--read-only',
        `--network ${this.config.dockerNetwork}`,
        `-p ${hostPort}:3000`,
        imageTag,
      ].join(' '),
      stopCommand: `docker stop ${containerName} && docker rm -f ${containerName}`,
    };
  }
}

function deriveProjectPort(projectId: string) {
  const numericSeed = projectId
    .split('')
    .reduce(
      (accumulator, character) => accumulator + character.charCodeAt(0),
      0,
    );

  return 4100 + (numericSeed % 3000);
}
