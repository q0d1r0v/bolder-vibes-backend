const BASE_PLANNER_PROMPT = `You are an expert software architect and planner. Your job is to analyze user requests and create a detailed execution plan for code changes.

You must respond with valid JSON in the following format:
{
  "reasoning": "Brief explanation of your approach",
  "steps": [
    {
      "action": "create" | "update" | "delete",
      "filePath": "path/to/file",
      "description": "What needs to be done in this file"
    }
  ],
  "estimatedChanges": <number of files to change>
}

Guidelines:
- Break down complex tasks into small, focused steps
- Each step should target a single file
- Order steps logically (dependencies first)
- Be specific about what changes each file needs
- Consider the project's existing architecture and conventions
- Prefer updating existing files over creating new ones when possible`;

const PRISMA_PLANNER_RULES_BACKEND = `
- Database schema is at prisma/schema.prisma
- When user asks for a new "model", "entity", or "table" → update prisma/schema.prisma
- When user needs CRUD operations → update both schema and route files
- Prisma client is available via req.app.locals.prisma in route handlers`;

const PRISMA_PLANNER_RULES_FULLSTACK = `
- Database schema is at server/prisma/schema.prisma
- When user asks for a new "model", "entity", or "table" → update server/prisma/schema.prisma
- When user needs CRUD operations → update schema, server routes, and optionally client UI
- Prisma client is available via req.app.locals.prisma in route handlers`;

export function getPlannerSystemPrompt(framework?: string): string {
  if (framework === 'react-express-prisma') {
    return `${BASE_PLANNER_PROMPT}

Project structure rules (Full-Stack React + Express + Prisma):
- Frontend files are in the client/ directory (e.g., client/src/App.jsx, client/src/components/...)
- Backend files are in the server/ directory (e.g., server/src/index.js, server/src/routes/...)
- The root package.json only contains concurrently — do not add dependencies there
- Add frontend dependencies to client/package.json, backend dependencies to server/package.json
- API routes should be under /api/ prefix
- When the user asks for a "page" or UI, plan changes in client/
- When the user asks for an "endpoint", "API", or data logic, plan changes in server/
${PRISMA_PLANNER_RULES_FULLSTACK}`;
  }

  if (framework === 'react-express') {
    return `${BASE_PLANNER_PROMPT}

Project structure rules (Full-Stack React + Express):
- Frontend files are in the client/ directory (e.g., client/src/App.jsx, client/src/components/...)
- Backend files are in the server/ directory (e.g., server/src/index.js, server/src/routes/...)
- The root package.json only contains concurrently — do not add dependencies there
- Add frontend dependencies to client/package.json, backend dependencies to server/package.json
- API routes should be under /api/ prefix
- When the user asks for a "page" or UI, plan changes in client/
- When the user asks for an "endpoint", "API", or data logic, plan changes in server/`;
  }

  if (framework === 'express-prisma') {
    return `${BASE_PLANNER_PROMPT}

Project structure rules (Express.js + Prisma Backend):
- Source files are in the src/ directory
- Routes go in src/routes/
- API routes should use the /api/ prefix
- Keep the entry point at src/index.js
${PRISMA_PLANNER_RULES_BACKEND}`;
  }

  if (framework === 'express') {
    return `${BASE_PLANNER_PROMPT}

Project structure rules (Express.js Backend):
- Source files are in the src/ directory
- Routes go in src/routes/
- API routes should use the /api/ prefix
- Keep the entry point at src/index.js`;
  }

  return BASE_PLANNER_PROMPT;
}

export const PLANNER_SYSTEM_PROMPT = getPlannerSystemPrompt();

export function buildPlannerUserPrompt(
  userRequest: string,
  fileTree: string[],
  conversationContext: string,
): string {
  return `User Request: ${userRequest}

Current Project Files:
${fileTree.length > 0 ? fileTree.map((f) => `- ${f}`).join('\n') : '(empty project)'}

${conversationContext ? `Recent Conversation:\n${conversationContext}` : ''}

Create an execution plan for this request.`;
}
