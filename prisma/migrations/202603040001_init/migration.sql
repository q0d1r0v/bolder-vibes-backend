-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'GENERATING', 'READY', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProjectVisibility" AS ENUM ('PRIVATE', 'TEAM', 'PUBLIC');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');

-- CreateEnum
CREATE TYPE "PromptStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VersionSource" AS ENUM ('USER', 'AI', 'ROLLBACK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "RuntimeStatus" AS ENUM ('STOPPED', 'BUILDING', 'RUNNING', 'FAILED', 'RESTARTING');

-- CreateEnum
CREATE TYPE "SandboxProvider" AS ENUM ('DOCKER');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('SOURCE', 'CONFIG', 'ASSET', 'GENERATED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "ProjectVisibility" NOT NULL DEFAULT 'PRIVATE',
    "frontendFramework" TEXT NOT NULL DEFAULT 'nextjs',
    "backendFramework" TEXT NOT NULL DEFAULT 'nestjs',
    "runtimeStrategy" TEXT NOT NULL DEFAULT 'docker-sandbox',
    "previewUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_chats" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "project_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_messages" (
    "id" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chatId" TEXT NOT NULL,

    CONSTRAINT "project_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_files" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "language" TEXT,
    "kind" "FileKind" NOT NULL DEFAULT 'SOURCE',
    "isEntry" BOOLEAN NOT NULL DEFAULT false,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "project_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_versions" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" "VersionSource" NOT NULL DEFAULT 'SYSTEM',
    "summary" TEXT NOT NULL,
    "manifest" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "promptRunId" TEXT,
    "createdById" TEXT,

    CONSTRAINT "project_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_runs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "model" TEXT NOT NULL DEFAULT 'gpt-4.1',
    "prompt" TEXT NOT NULL,
    "status" "PromptStatus" NOT NULL DEFAULT 'QUEUED',
    "plan" JSONB,
    "resultSummary" TEXT,
    "errorMessage" TEXT,
    "tokensInput" INTEGER,
    "tokensOutput" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "projectId" TEXT NOT NULL,
    "chatId" TEXT,
    "requestedById" TEXT,

    CONSTRAINT "prompt_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sandbox_runtimes" (
    "id" TEXT NOT NULL,
    "provider" "SandboxProvider" NOT NULL DEFAULT 'DOCKER',
    "status" "RuntimeStatus" NOT NULL DEFAULT 'STOPPED',
    "containerName" TEXT,
    "imageTag" TEXT,
    "previewUrl" TEXT,
    "hostPort" INTEGER,
    "cpuLimit" TEXT NOT NULL DEFAULT '1',
    "memoryLimitMb" INTEGER NOT NULL DEFAULT 512,
    "networkMode" TEXT NOT NULL DEFAULT 'bridge',
    "lastCommand" TEXT,
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "sandbox_runtimes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runtime_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runtimeId" TEXT NOT NULL,

    CONSTRAINT "runtime_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

-- CreateIndex
CREATE INDEX "projects_ownerId_createdAt_idx" ON "projects"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "project_chats_projectId_createdAt_idx" ON "project_chats"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "project_messages_chatId_createdAt_idx" ON "project_messages"("chatId", "createdAt");

-- CreateIndex
CREATE INDEX "project_files_projectId_updatedAt_idx" ON "project_files"("projectId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_files_projectId_path_key" ON "project_files"("projectId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "project_versions_promptRunId_key" ON "project_versions"("promptRunId");

-- CreateIndex
CREATE INDEX "project_versions_projectId_createdAt_idx" ON "project_versions"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_versions_projectId_version_key" ON "project_versions"("projectId", "version");

-- CreateIndex
CREATE INDEX "prompt_runs_projectId_createdAt_idx" ON "prompt_runs"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "prompt_runs_status_createdAt_idx" ON "prompt_runs"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sandbox_runtimes_projectId_key" ON "sandbox_runtimes"("projectId");

-- CreateIndex
CREATE INDEX "runtime_events_runtimeId_createdAt_idx" ON "runtime_events"("runtimeId", "createdAt");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_chats" ADD CONSTRAINT "project_chats_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_messages" ADD CONSTRAINT "project_messages_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "project_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_promptRunId_fkey" FOREIGN KEY ("promptRunId") REFERENCES "prompt_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_runs" ADD CONSTRAINT "prompt_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_runs" ADD CONSTRAINT "prompt_runs_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "project_chats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_runs" ADD CONSTRAINT "prompt_runs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sandbox_runtimes" ADD CONSTRAINT "sandbox_runtimes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_events" ADD CONSTRAINT "runtime_events_runtimeId_fkey" FOREIGN KEY ("runtimeId") REFERENCES "sandbox_runtimes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
