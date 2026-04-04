export enum PreviewStatus {
  IDLE = 'idle',
  BUILDING = 'building',
  READY = 'ready',
  ERROR = 'error',
}

export interface PreviewState {
  projectId: string;
  status: PreviewStatus;
  url?: string;
  error?: string;
  startedAt?: Date;
}

export interface FrameworkConfig {
  installCommand: string;
  devCommand: string;
  containerPort: number;
}

export const FRAMEWORK_CONFIGS: Record<string, FrameworkConfig> = {
  react: {
    installCommand: 'npm install',
    devCommand: 'npx vite --host 0.0.0.0 --port 3000',
    containerPort: 3000,
  },
  nextjs: {
    installCommand: 'npm install',
    devCommand: 'npx next dev --hostname 0.0.0.0 --port 3000',
    containerPort: 3000,
  },
  express: {
    installCommand: 'npm install',
    devCommand: 'HOST=0.0.0.0 PORT=3000 npm run dev',
    containerPort: 3000,
  },
  'react-express': {
    installCommand:
      'npm install && (cd client && npm install) && (cd server && npm install)',
    devCommand: 'npm run dev',
    containerPort: 3000,
  },
  'react-express-fb': {
    installCommand:
      '(cd frontend && npm install) && (cd backend && npm install)',
    devCommand:
      '(cd /app/backend && PORT=3001 HOST=0.0.0.0 npm run dev) & cd /app/frontend && npx vite --host 0.0.0.0 --port 3000',
    containerPort: 3000,
  },
  'express-prisma': {
    installCommand: 'npm install && npx prisma generate && npx prisma db push',
    devCommand: 'HOST=0.0.0.0 PORT=3000 npm run dev',
    containerPort: 3000,
  },
  'react-express-prisma': {
    installCommand:
      'npm install && (cd client && npm install) && (cd server && npm install && npx prisma generate && npx prisma db push)',
    devCommand: 'npm run dev',
    containerPort: 3000,
  },
  'react-express-prisma-fb': {
    installCommand:
      '(cd frontend && npm install) && (cd backend && npm install && npx prisma generate && npx prisma db push)',
    devCommand:
      '(cd /app/backend && PORT=3001 HOST=0.0.0.0 npm run dev) & cd /app/frontend && npx vite --host 0.0.0.0 --port 3000',
    containerPort: 3000,
  },
  // Subdirectory layouts — framework inside frontend/ folder
  'react-sub:frontend': {
    installCommand: 'cd frontend && npm install',
    devCommand: 'cd frontend && npx vite --host 0.0.0.0 --port 3000',
    containerPort: 3000,
  },
  'nextjs-sub:frontend': {
    installCommand: 'cd frontend && npm install',
    devCommand: 'cd frontend && npx next dev --hostname 0.0.0.0 --port 3000',
    containerPort: 3000,
  },
  default: {
    installCommand: 'npm install',
    devCommand: 'npx vite --host 0.0.0.0 --port 3000 || npm run dev',
    containerPort: 3000,
  },
};
