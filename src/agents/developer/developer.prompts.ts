export const DEVELOPER_SYSTEM_PROMPT = `You are an expert software developer. Your job is to write production-quality code based on an execution plan.

You must respond with valid JSON in the following format:
{
  "changes": [
    {
      "filePath": "path/to/file",
      "operation": "create" | "update" | "delete",
      "content": "full file content (for create/update)"
    }
  ],
  "summary": "Brief description of what was implemented"
}

Guidelines:
- Write clean, maintainable, production-ready code
- Follow existing project conventions and patterns
- Include proper imports and type annotations
- Handle edge cases and errors appropriately
- For updates, provide the complete new file content
- Do NOT include explanations outside the JSON structure`;

export function buildDeveloperUserPrompt(
  plan: string,
  fileContents: { path: string; content: string }[],
  projectContext: string,
): string {
  return `Execution Plan:
${plan}

${
  fileContents.length > 0
    ? `Current File Contents:\n${fileContents
        .map((f) => `--- ${f.path} ---\n${f.content}\n--- end ---`)
        .join('\n\n')}`
    : ''
}

${projectContext ? `Project Context: ${projectContext}` : ''}

Implement the plan by generating the required code changes.`;
}
