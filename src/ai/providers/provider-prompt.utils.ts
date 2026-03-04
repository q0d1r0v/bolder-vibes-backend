import type { AiGeneratedProject } from '@/ai/interfaces/ai-generated-project.interface';
import type { AiProviderContext } from '@/ai/interfaces/ai-provider.interface';

export function buildSystemPrompt() {
  return [
    'You generate project files for an AI app builder.',
    'Return only JSON.',
    'The JSON shape must be:',
    '{"summary":"string","files":[{"path":"string","content":"string","language":"string","kind":"SOURCE|CONFIG|ASSET|GENERATED","isEntry":true}]}',
    'Generate concise but working starter files.',
  ].join(' ');
}

export function buildUserPrompt(context: AiProviderContext) {
  return JSON.stringify(
    {
      project: {
        id: context.project.id,
        name: context.project.name,
        description: context.project.description,
        frontendFramework: context.project.frontendFramework,
        backendFramework: context.project.backendFramework,
        runtimeStrategy: context.project.runtimeStrategy,
      },
      owner: {
        email: context.project.owner.email,
        displayName: context.project.owner.displayName,
      },
      prompt: context.promptRun.prompt,
      constraints: [
        'Prefer app/page.tsx or src/index.ts style entry files.',
        'Include a README.md.',
        'Keep the starter implementation minimal but coherent.',
      ],
    },
    null,
    2,
  );
}

export function parseProviderJson(
  rawText: string,
  provider: string,
  model: string,
): AiGeneratedProject {
  const jsonBlock = extractJsonBlock(rawText);
  const parsed = JSON.parse(jsonBlock) as {
    summary?: string;
    files?: Array<{
      path?: string;
      content?: string;
      language?: string;
      kind?: 'SOURCE' | 'CONFIG' | 'ASSET' | 'GENERATED';
      isEntry?: boolean;
    }>;
  };

  if (
    !parsed.summary ||
    !Array.isArray(parsed.files) ||
    parsed.files.length === 0
  ) {
    throw new Error('AI provider returned invalid project payload.');
  }

  return {
    provider,
    model,
    summary: parsed.summary,
    files: parsed.files
      .filter((file) => file.path && typeof file.content === 'string')
      .map((file) => ({
        path: file.path!,
        content: file.content!,
        language: file.language,
        kind: file.kind,
        isEntry: file.isEntry,
      })),
    rawText,
  };
}

function extractJsonBlock(value: string) {
  const firstBrace = value.indexOf('{');
  const lastBrace = value.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('AI provider did not return JSON.');
  }

  return value.slice(firstBrace, lastBrace + 1);
}
