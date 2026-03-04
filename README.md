# Bolder Vibes API

NestJS backend skeleton for an AI app-builder workflow:

`chat -> plan -> generate files -> save version -> docker build/run -> preview`

## Stack

- Backend: NestJS, TypeScript
- Database: PostgreSQL + Prisma schema/migrations
- Cache/queue ready: Redis via Docker Compose
- Runtime: Docker sandbox command generation
- Docs and validation: auto-enabled when optional packages are installed

## Modules

- `projects`: create/list/update projects
- `chats`: project chat sessions and messages
- `files`: save generated files and create version snapshots
- `ai`: prompt runs, agent-plan records, status transitions
- `runtime`: start/stop/restart preview sandbox metadata
- `health`: operational status

## Database Structure

Main tables:

- `users`
- `projects`
- `project_chats`
- `project_messages`
- `project_files`
- `project_versions`
- `prompt_runs`
- `sandbox_runtimes`
- `runtime_events`

Migration SQL is generated at [prisma/migrations/202603040001_init/migration.sql](/home/user/projects/remote-works/remote-startup-apps/bolder-vibes/prisma/migrations/202603040001_init/migration.sql).

## API Shape

Base prefix: `/api`

Important endpoints:

- `POST /api/projects`
- `GET /api/projects`
- `GET /api/projects/:projectId`
- `PATCH /api/projects/:projectId`
- `POST /api/projects/:projectId/chats`
- `POST /api/projects/:projectId/chats/:chatId/messages`
- `POST /api/projects/:projectId/files`
- `POST /api/projects/:projectId/prompts`
- `PATCH /api/projects/:projectId/prompts/:promptRunId/start`
- `PATCH /api/projects/:projectId/prompts/:promptRunId/succeed`
- `PATCH /api/projects/:projectId/prompts/:promptRunId/fail`
- `GET /api/projects/:projectId/runtime`
- `POST /api/projects/:projectId/runtime/start`
- `POST /api/projects/:projectId/runtime/stop`
- `POST /api/projects/:projectId/runtime/restart`
- `GET /api/health`

## Security and Runtime Notes

- Global security headers are enabled.
- In-memory rate limiting is enabled.
- Responses are wrapped in a unified envelope.
- Docker runtime commands include CPU, memory, PID, read-only, and no-new-privileges flags.
- Sandbox CLI lives at [scripts/sandbox-control.mjs](/home/user/projects/remote-works/remote-startup-apps/bolder-vibes/scripts/sandbox-control.mjs).

## WebSocket

Socket.IO namespace:

- `/realtime`

Client flow:

1. Connect to `/realtime`
2. Emit `project.join` with `{ "projectId": "..." }`
3. Listen for project room events

Server events:

- `socket.connected`
- `project.created`
- `project.updated`
- `chat.created`
- `chat.message.created`
- `files.saved`
- `prompt.created`
- `prompt.updated`
- `runtime.updated`

## Local Setup

1. Copy `.env.example` to `.env` and adjust values.
2. Start infra:

```bash
yarn docker:up
```

3. Generate Prisma client:

```bash
yarn prisma:generate
```

4. Run the API:

```bash
yarn start:dev
```

## Docker

Infrastructure and API container definitions live in:

- [docker-compose.yml](/home/user/projects/remote-works/remote-startup-apps/bolder-vibes/docker-compose.yml)
- [Dockerfile](/home/user/projects/remote-works/remote-startup-apps/bolder-vibes/Dockerfile)

Generated project files are expected under `PROJECTS_ROOT` and are mounted into the API container at `/var/lib/bolder-vibes/generated-projects`.

## Optional Packages For Full Production Mode

Current code boots without these packages, but production database/docs features should install them:

```bash
yarn add @prisma/adapter-pg pg @nestjs/swagger swagger-ui-express class-validator class-transformer
```

What they unlock:

- `@prisma/adapter-pg` + `pg`: real PostgreSQL access for Prisma 7
- `@nestjs/swagger` + `swagger-ui-express`: `/api/docs`
- `class-validator` + `class-transformer`: runtime DTO validation

## Verification

Validated locally in this workspace:

- `yarn prisma:generate`
- `yarn build`
- `yarn test --runInBand`
- `yarn test:e2e --runInBand`
# bolder-vibes-backend
