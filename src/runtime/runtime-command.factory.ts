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
    const docker = this.config.dockerBinary;
    const buildArgs = [docker, 'build', '-t', imageTag, projectPath];
    const startArgs = [
      docker,
      'run',
      '-d',
      '--name',
      containerName,
      `--cpus=${this.config.runtimeCpuLimit}`,
      `--memory=${this.config.runtimeMemoryMb}m`,
      '--pids-limit=256',
      '--security-opt=no-new-privileges',
      '--read-only',
      '--network',
      this.config.dockerNetwork,
      '-p',
      `${hostPort}:${this.config.runtimeInternalPort}`,
      imageTag,
    ];
    const stopArgs = [docker, 'stop', containerName];
    const removeArgs = [docker, 'rm', '-f', containerName];

    return {
      hostPort,
      imageTag,
      containerName,
      projectPath,
      previewUrl: `${this.config.previewBaseUrl}/projects/${projectId}`,
      cpuLimit: this.config.runtimeCpuLimit,
      memoryLimitMb: this.config.runtimeMemoryMb,
      networkMode: this.config.dockerNetwork,
      buildArgs,
      startArgs,
      stopArgs,
      removeArgs,
      buildCommand: buildArgs.join(' '),
      startCommand: startArgs.join(' '),
      stopCommand: `${stopArgs.join(' ')} && ${removeArgs.join(' ')}`,
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
