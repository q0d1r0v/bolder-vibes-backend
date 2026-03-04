import { spawnSync } from 'node:child_process';

const [, , action, projectId, requestedPort] = process.argv;

if (!['start', 'stop', 'restart'].includes(action || '')) {
  console.error('Usage: yarn sandbox:<action> <projectId> [port]');
  process.exit(1);
}

if (!projectId) {
  console.error('projectId is required.');
  process.exit(1);
}

const hostPort = requestedPort ? Number(requestedPort) : deriveProjectPort(projectId);
const projectRoot =
  process.env.PROJECTS_ROOT || '/var/lib/bolder-vibes/generated-projects';
const network = process.env.DOCKER_SANDBOX_NETWORK || 'bridge';
const cpuLimit = process.env.RUNTIME_CPU_LIMIT || '1';
const memoryMb = Number(process.env.RUNTIME_MEMORY_MB || 512);
const imageTag = `bolder-vibes-project-${projectId.slice(0, 12)}`;
const containerName = `bolder-vibes-sandbox-${projectId.slice(0, 12)}`;
const buildCommand = [
  'docker',
  'build',
  '-t',
  imageTag,
  `${projectRoot}/${projectId}`,
];
const startCommand = [
  'docker',
  'run',
  '-d',
  '--name',
  containerName,
  `--cpus=${cpuLimit}`,
  `--memory=${memoryMb}m`,
  '--pids-limit=256',
  '--security-opt=no-new-privileges',
  '--read-only',
  '--network',
  network,
  '-p',
  `${hostPort}:3000`,
  imageTag,
];
const stopCommand = ['docker', 'stop', containerName];
const removeCommand = ['docker', 'rm', '-f', containerName];

const sequences = {
  start: [buildCommand, startCommand],
  stop: [stopCommand, removeCommand],
  restart: [stopCommand, removeCommand, buildCommand, startCommand],
};

console.log(
  JSON.stringify(
    {
      action,
      projectId,
      previewUrl: `${process.env.PREVIEW_BASE_URL || 'http://preview.local'}/projects/${projectId}`,
      commands: sequences[action],
    },
    null,
    2,
  ),
);

if (process.env.EXECUTE_DOCKER !== 'true') {
  process.exit(0);
}

for (const command of sequences[action]) {
  const result = spawnSync(command[0], command.slice(1), {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function deriveProjectPort(value) {
  const numericSeed = value
    .split('')
    .reduce((accumulator, character) => accumulator + character.charCodeAt(0), 0);

  return 4100 + (numericSeed % 3000);
}
