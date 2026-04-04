export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  framework: string;
  category: 'frontend' | 'backend' | 'fullstack';
  files: { path: string; content: string }[];
}

// ────────────────────────────────────────────────────────────
// Shared fragments — keeps templates DRY
// ────────────────────────────────────────────────────────────

const GLOBAL_CSS = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
body{min-height:100vh;color:#1a1a2e;background:#fafafa}
a{color:#6366f1;text-decoration:none}a:hover{text-decoration:underline}
button{cursor:pointer;font:inherit}
input,textarea{font:inherit}
`;

const VITE_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
    },
    include: ['src'],
  },
  null,
  2,
);

const NODE_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      isolatedModules: true,
      outDir: './dist',
      rootDir: './src',
    },
    include: ['src'],
  },
  null,
  2,
);

// ────────────────────────────────────────────────────────────
// Templates
// ────────────────────────────────────────────────────────────

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  // ─── 1. React + Vite + TypeScript ────────────────────────
  {
    id: 'react-vite',
    name: 'React + Vite',
    description: 'Modern React SPA with TypeScript and Vite',
    framework: 'react',
    category: 'frontend',
    files: [
      {
        path: 'package.json',
        content: JSON.stringify(
          {
            name: 'my-react-app',
            private: true,
            version: '1.0.0',
            type: 'module',
            scripts: {
              dev: 'vite',
              build: 'tsc -b && vite build',
              preview: 'vite preview',
            },
            dependencies: {
              react: '^19.0.0',
              'react-dom': '^19.0.0',
            },
            devDependencies: {
              '@types/react': '^19.0.0',
              '@types/react-dom': '^19.0.0',
              '@vitejs/plugin-react': '^4.3.0',
              typescript: '^5.7.0',
              vite: '^6.0.0',
            },
          },
          null,
          2,
        ),
      },
      { path: 'tsconfig.json', content: VITE_TSCONFIG },
      {
        path: 'vite.config.ts',
        content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
})
`,
      },
      {
        path: 'index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      },
      {
        path: 'src/vite-env.d.ts',
        content: `/// <reference types="vite/client" />\n`,
      },
      {
        path: 'src/main.tsx',
        content: `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,
      },
      { path: 'src/index.css', content: GLOBAL_CSS },
      {
        path: 'src/App.tsx',
        content: `import { useState } from 'react'

export function App() {
  const [count, setCount] = useState(0)

  return (
    <div style={{ maxWidth: 600, margin: '4rem auto', padding: '0 1.5rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 700 }}>React + TypeScript</h1>
      <p style={{ color: '#666', margin: '0.5rem 0 2rem' }}>Edit <code>src/App.tsx</code> to get started</p>
      <button
        onClick={() => setCount((c) => c + 1)}
        style={{
          padding: '0.75rem 2rem',
          fontSize: '1rem',
          borderRadius: '0.5rem',
          border: 'none',
          background: '#6366f1',
          color: '#fff',
        }}
      >
        Count: {count}
      </button>
    </div>
  )
}
`,
      },
    ],
  },

  // ─── 2. Next.js + TypeScript ─────────────────────────────
  {
    id: 'nextjs',
    name: 'Next.js',
    description: 'Full-stack React framework with App Router and TypeScript',
    framework: 'nextjs',
    category: 'frontend',
    files: [
      {
        path: 'package.json',
        content: JSON.stringify(
          {
            name: 'my-nextjs-app',
            version: '1.0.0',
            private: true,
            scripts: {
              dev: 'next dev',
              build: 'next build',
              start: 'next start',
            },
            dependencies: {
              next: '^15.0.0',
              react: '^19.0.0',
              'react-dom': '^19.0.0',
            },
            devDependencies: {
              '@types/node': '^22.0.0',
              '@types/react': '^19.0.0',
              '@types/react-dom': '^19.0.0',
              typescript: '^5.7.0',
            },
          },
          null,
          2,
        ),
      },
      {
        path: 'tsconfig.json',
        content: JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              lib: ['dom', 'dom.iterable', 'esnext'],
              allowJs: true,
              skipLibCheck: true,
              strict: true,
              noEmit: true,
              esModuleInterop: true,
              module: 'esnext',
              moduleResolution: 'bundler',
              resolveJsonModule: true,
              isolatedModules: true,
              jsx: 'preserve',
              incremental: true,
              plugins: [{ name: 'next' }],
              paths: { '@/*': ['./src/*'] },
            },
            include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
            exclude: ['node_modules'],
          },
          null,
          2,
        ),
      },
      {
        path: 'next.config.ts',
        content: `import type { NextConfig } from 'next'

const nextConfig: NextConfig = {}

export default nextConfig
`,
      },
      {
        path: 'app/globals.css',
        content: GLOBAL_CSS,
      },
      {
        path: 'app/layout.tsx',
        content: `import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'My App',
  description: 'Built with Next.js and TypeScript',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`,
      },
      {
        path: 'app/page.tsx',
        content: `export default function Home() {
  return (
    <main style={{ maxWidth: 600, margin: '4rem auto', padding: '0 1.5rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 700 }}>Next.js + TypeScript</h1>
      <p style={{ color: '#666', margin: '0.5rem 0' }}>
        Edit <code>app/page.tsx</code> to get started
      </p>
    </main>
  )
}
`,
      },
    ],
  },

  // ─── 3. Express API + TypeScript ─────────────────────────
  {
    id: 'express-api',
    name: 'Express API',
    description: 'REST API backend with Express.js and TypeScript',
    framework: 'express',
    category: 'backend',
    files: [
      {
        path: 'package.json',
        content: JSON.stringify(
          {
            name: 'my-api',
            private: true,
            version: '1.0.0',
            type: 'module',
            scripts: {
              dev: 'tsx watch src/index.ts',
              build: 'tsc',
              start: 'node dist/index.js',
            },
            dependencies: {
              express: '^4.21.0',
              cors: '^2.8.5',
            },
            devDependencies: {
              '@types/express': '^5.0.0',
              '@types/cors': '^2.8.17',
              '@types/node': '^22.0.0',
              tsx: '^4.19.0',
              typescript: '^5.7.0',
            },
          },
          null,
          2,
        ),
      },
      { path: 'tsconfig.json', content: NODE_TSCONFIG },
      {
        path: 'src/index.ts',
        content: `import express from 'express'
import cors from 'cors'
import { apiRouter } from './routes/index.js'

const app = express()
const port = Number(process.env.PORT) || 3000

app.use(cors())
app.use(express.json())
app.use('/api', apiRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(port, '0.0.0.0', () => {
  console.log(\`Server running on http://localhost:\${port}\`)
})
`,
      },
      {
        path: 'src/routes/index.ts',
        content: `import { Router } from 'express'

export const apiRouter = Router()

interface Item {
  id: number
  name: string
  createdAt: string
}

const items: Item[] = []
let nextId = 1

apiRouter.get('/items', (_req, res) => {
  res.json({ data: items })
})

apiRouter.post('/items', (req, res) => {
  const { name } = req.body as { name?: string }
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const item: Item = { id: nextId++, name, createdAt: new Date().toISOString() }
  items.push(item)
  res.status(201).json({ data: item })
})

apiRouter.delete('/items/:id', (req, res) => {
  const id = Number(req.params.id)
  const idx = items.findIndex((i) => i.id === id)
  if (idx === -1) {
    res.status(404).json({ error: 'Item not found' })
    return
  }
  items.splice(idx, 1)
  res.json({ deleted: true })
})
`,
      },
    ],
  },

  // ─── 4. Express + Prisma + TypeScript ────────────────────
  {
    id: 'express-prisma',
    name: 'Express + Prisma',
    description: 'REST API with Express.js, Prisma ORM and PostgreSQL',
    framework: 'express-prisma',
    category: 'backend',
    files: [
      {
        path: 'package.json',
        content: JSON.stringify(
          {
            name: 'my-api',
            private: true,
            version: '1.0.0',
            type: 'module',
            scripts: {
              dev: 'tsx watch src/index.ts',
              build: 'tsc',
              start: 'node dist/index.js',
            },
            dependencies: {
              express: '^4.21.0',
              cors: '^2.8.5',
              '@prisma/client': '^6.0.0',
            },
            devDependencies: {
              '@types/express': '^5.0.0',
              '@types/cors': '^2.8.17',
              '@types/node': '^22.0.0',
              prisma: '^6.0.0',
              tsx: '^4.19.0',
              typescript: '^5.7.0',
            },
          },
          null,
          2,
        ),
      },
      { path: 'tsconfig.json', content: NODE_TSCONFIG },
      {
        path: 'prisma/schema.prisma',
        content: `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`,
      },
      {
        path: 'src/index.ts',
        content: `import express from 'express'
import cors from 'cors'
import { PrismaClient } from '@prisma/client'
import { apiRouter } from './routes/index.js'

const app = express()
const prisma = new PrismaClient()
const port = Number(process.env.PORT) || 3000

app.use(cors())
app.use(express.json())

// Share prisma with route handlers
app.locals.prisma = prisma

app.use('/api', apiRouter)

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw\`SELECT 1\`
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() })
  } catch {
    res.status(500).json({ status: 'error', database: 'disconnected' })
  }
})

app.listen(port, '0.0.0.0', () => {
  console.log(\`Server running on http://localhost:\${port}\`)
})
`,
      },
      {
        path: 'src/routes/index.ts',
        content: `import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'

export const apiRouter = Router()

function db(req: Express.Request): PrismaClient {
  return (req as unknown as { app: { locals: { prisma: PrismaClient } } }).app.locals.prisma
}

// GET /api/users
apiRouter.get('/users', async (req, res) => {
  try {
    const users = await db(req).user.findMany({ orderBy: { createdAt: 'desc' } })
    res.json({ data: users })
  } catch {
    res.status(500).json({ error: 'Failed to fetch users' })
  }
})

// POST /api/users
apiRouter.post('/users', async (req, res) => {
  const { email, name } = req.body as { email?: string; name?: string }
  if (!email) {
    res.status(400).json({ error: 'email is required' })
    return
  }
  try {
    const user = await db(req).user.create({ data: { email, name } })
    res.status(201).json({ data: user })
  } catch {
    res.status(400).json({ error: 'Failed to create user (email may already exist)' })
  }
})
`,
      },
    ],
  },

  // ─── 5. React + Express + TypeScript (fullstack) ─────────
  {
    id: 'react-express',
    name: 'React + Express',
    description: 'Full-stack TypeScript app with React frontend and Express API',
    framework: 'react-express',
    category: 'fullstack',
    files: [
      {
        path: 'package.json',
        content: JSON.stringify(
          {
            name: 'my-fullstack-app',
            private: true,
            version: '1.0.0',
            scripts: {
              dev: 'concurrently "npm run dev:client" "npm run dev:server"',
              'dev:client': 'cd client && npm run dev',
              'dev:server': 'cd server && npm run dev',
            },
            devDependencies: {
              concurrently: '^9.0.0',
            },
          },
          null,
          2,
        ),
      },
      // ── Client ──
      {
        path: 'client/package.json',
        content: JSON.stringify(
          {
            name: 'client',
            private: true,
            version: '1.0.0',
            type: 'module',
            scripts: {
              dev: 'vite',
              build: 'tsc -b && vite build',
            },
            dependencies: {
              react: '^19.0.0',
              'react-dom': '^19.0.0',
            },
            devDependencies: {
              '@types/react': '^19.0.0',
              '@types/react-dom': '^19.0.0',
              '@vitejs/plugin-react': '^4.3.0',
              typescript: '^5.7.0',
              vite: '^6.0.0',
            },
          },
          null,
          2,
        ),
      },
      { path: 'client/tsconfig.json', content: VITE_TSCONFIG },
      {
        path: 'client/vite.config.ts',
        content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
`,
      },
      {
        path: 'client/index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      },
      {
        path: 'client/src/vite-env.d.ts',
        content: `/// <reference types="vite/client" />\n`,
      },
      { path: 'client/src/index.css', content: GLOBAL_CSS },
      {
        path: 'client/src/main.tsx',
        content: `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,
      },
      {
        path: 'client/src/App.tsx',
        content: `import { useState, useEffect } from 'react'

interface HealthResponse {
  status: string
  timestamp: string
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data: HealthResponse) => setHealth(data))
      .catch(() => setError('Failed to connect to API'))
  }, [])

  return (
    <div style={{ maxWidth: 600, margin: '4rem auto', padding: '0 1.5rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 700 }}>React + Express</h1>
      <p style={{ color: '#666', margin: '0.5rem 0 1.5rem' }}>Full-stack TypeScript starter</p>
      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
      {health && (
        <p style={{ color: '#22c55e', fontWeight: 500 }}>
          API: {health.status}
        </p>
      )}
    </div>
  )
}
`,
      },
      // ── Server ──
      {
        path: 'server/package.json',
        content: JSON.stringify(
          {
            name: 'server',
            private: true,
            version: '1.0.0',
            type: 'module',
            scripts: {
              dev: 'tsx watch src/index.ts',
              build: 'tsc',
              start: 'node dist/index.js',
            },
            dependencies: {
              express: '^4.21.0',
              cors: '^2.8.5',
            },
            devDependencies: {
              '@types/express': '^5.0.0',
              '@types/cors': '^2.8.17',
              '@types/node': '^22.0.0',
              tsx: '^4.19.0',
              typescript: '^5.7.0',
            },
          },
          null,
          2,
        ),
      },
      { path: 'server/tsconfig.json', content: NODE_TSCONFIG },
      {
        path: 'server/src/index.ts',
        content: `import express from 'express'
import cors from 'cors'
import { apiRouter } from './routes/index.js'

const app = express()
const port = Number(process.env.PORT) || 3001

app.use(cors())
app.use(express.json())
app.use('/api', apiRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(port, '0.0.0.0', () => {
  console.log(\`Server running on http://localhost:\${port}\`)
})
`,
      },
      {
        path: 'server/src/routes/index.ts',
        content: `import { Router } from 'express'

export const apiRouter = Router()

apiRouter.get('/', (_req, res) => {
  res.json({ message: 'Welcome to the API' })
})
`,
      },
    ],
  },

  // ─── 6. React + Express + Prisma + TypeScript (fullstack) ─
  {
    id: 'react-express-prisma',
    name: 'React + Express + Prisma',
    description: 'Full-stack TypeScript app with React, Express and PostgreSQL',
    framework: 'react-express-prisma',
    category: 'fullstack',
    files: [
      {
        path: 'package.json',
        content: JSON.stringify(
          {
            name: 'my-fullstack-app',
            private: true,
            version: '1.0.0',
            scripts: {
              dev: 'concurrently "npm run dev:client" "npm run dev:server"',
              'dev:client': 'cd client && npm run dev',
              'dev:server': 'cd server && npm run dev',
            },
            devDependencies: {
              concurrently: '^9.0.0',
            },
          },
          null,
          2,
        ),
      },
      // ── Client ──
      {
        path: 'client/package.json',
        content: JSON.stringify(
          {
            name: 'client',
            private: true,
            version: '1.0.0',
            type: 'module',
            scripts: {
              dev: 'vite',
              build: 'tsc -b && vite build',
            },
            dependencies: {
              react: '^19.0.0',
              'react-dom': '^19.0.0',
            },
            devDependencies: {
              '@types/react': '^19.0.0',
              '@types/react-dom': '^19.0.0',
              '@vitejs/plugin-react': '^4.3.0',
              typescript: '^5.7.0',
              vite: '^6.0.0',
            },
          },
          null,
          2,
        ),
      },
      { path: 'client/tsconfig.json', content: VITE_TSCONFIG },
      {
        path: 'client/vite.config.ts',
        content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
`,
      },
      {
        path: 'client/index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      },
      {
        path: 'client/src/vite-env.d.ts',
        content: `/// <reference types="vite/client" />\n`,
      },
      { path: 'client/src/index.css', content: GLOBAL_CSS },
      {
        path: 'client/src/main.tsx',
        content: `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,
      },
      {
        path: 'client/src/App.tsx',
        content: `import { useState, useEffect, useCallback } from 'react'

interface User {
  id: number
  email: string
  name: string | null
  createdAt: string
}

interface HealthResponse {
  status: string
  database: string
}

export function App() {
  const [users, setUsers] = useState<User[]>([])
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')

  const fetchUsers = useCallback(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((d: { data: User[] }) => setUsers(d.data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d: HealthResponse) => setHealth(d))
      .catch(() => {})
    fetchUsers()
  }, [fetchUsers])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: name || undefined }),
    })
      .then((r) => r.json())
      .then(() => { setEmail(''); setName(''); fetchUsers() })
      .catch(() => {})
  }

  return (
    <div style={{ maxWidth: 600, margin: '2rem auto', padding: '0 1.5rem' }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700 }}>React + Express + Prisma</h1>
      {health && (
        <p style={{ color: health.database === 'connected' ? '#22c55e' : '#ef4444', fontSize: '0.875rem', margin: '0.5rem 0 1.5rem' }}>
          API: {health.status} | DB: {health.database}
        </p>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required
          style={{ flex: 1, padding: '0.5rem 0.75rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.875rem' }} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
          style={{ flex: 1, padding: '0.5rem 0.75rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.875rem' }} />
        <button type="submit"
          style={{ padding: '0.5rem 1rem', borderRadius: '0.375rem', border: 'none', background: '#6366f1', color: '#fff', fontSize: '0.875rem', fontWeight: 500 }}>
          Add
        </button>
      </form>

      <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.75rem' }}>Users ({users.length})</h2>
      {users.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>No users yet. Add one above.</p>
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {users.map((u) => (
            <li key={u.id} style={{ padding: '0.75rem', background: '#fff', borderRadius: '0.5rem', border: '1px solid #e5e7eb' }}>
              <strong>{u.name || 'No name'}</strong> — {u.email}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
`,
      },
      // ── Server ──
      {
        path: 'server/package.json',
        content: JSON.stringify(
          {
            name: 'server',
            private: true,
            version: '1.0.0',
            type: 'module',
            scripts: {
              dev: 'tsx watch src/index.ts',
              build: 'tsc',
              start: 'node dist/index.js',
            },
            dependencies: {
              express: '^4.21.0',
              cors: '^2.8.5',
              '@prisma/client': '^6.0.0',
            },
            devDependencies: {
              '@types/express': '^5.0.0',
              '@types/cors': '^2.8.17',
              '@types/node': '^22.0.0',
              prisma: '^6.0.0',
              tsx: '^4.19.0',
              typescript: '^5.7.0',
            },
          },
          null,
          2,
        ),
      },
      { path: 'server/tsconfig.json', content: NODE_TSCONFIG },
      {
        path: 'server/prisma/schema.prisma',
        content: `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`,
      },
      {
        path: 'server/src/index.ts',
        content: `import express from 'express'
import cors from 'cors'
import { PrismaClient } from '@prisma/client'
import { apiRouter } from './routes/index.js'

const app = express()
const prisma = new PrismaClient()
const port = Number(process.env.PORT) || 3001

app.use(cors())
app.use(express.json())

app.locals.prisma = prisma

app.use('/api', apiRouter)

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw\`SELECT 1\`
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() })
  } catch {
    res.status(500).json({ status: 'error', database: 'disconnected' })
  }
})

app.listen(port, '0.0.0.0', () => {
  console.log(\`Server running on http://localhost:\${port}\`)
})
`,
      },
      {
        path: 'server/src/routes/index.ts',
        content: `import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'

export const apiRouter = Router()

function db(req: Express.Request): PrismaClient {
  return (req as unknown as { app: { locals: { prisma: PrismaClient } } }).app.locals.prisma
}

// GET /api/users
apiRouter.get('/users', async (req, res) => {
  try {
    const users = await db(req).user.findMany({ orderBy: { createdAt: 'desc' } })
    res.json({ data: users })
  } catch {
    res.status(500).json({ error: 'Failed to fetch users' })
  }
})

// POST /api/users
apiRouter.post('/users', async (req, res) => {
  const { email, name } = req.body as { email?: string; name?: string }
  if (!email) {
    res.status(400).json({ error: 'email is required' })
    return
  }
  try {
    const user = await db(req).user.create({ data: { email, name } })
    res.status(201).json({ data: user })
  } catch {
    res.status(400).json({ error: 'Failed to create user (email may already exist)' })
  }
})
`,
      },
    ],
  },
];
