import { Injectable } from '@nestjs/common';

import type { AiGeneratedProject } from '@/ai/interfaces/ai-generated-project.interface';
import type {
  AiProvider,
  AiProviderContext,
} from '@/ai/interfaces/ai-provider.interface';

@Injectable()
export class MockAiProvider implements AiProvider {
  readonly name = 'mock';

  generate(context: AiProviderContext): Promise<AiGeneratedProject> {
    const title = context.project.name;
    const prompt = context.promptRun.prompt;

    return Promise.resolve({
      provider: this.name,
      model: 'mock-template-v1',
      summary: `Generated a starter app skeleton for "${title}" from the prompt.`,
      files: [
        {
          path: 'package.json',
          kind: 'CONFIG',
          content: JSON.stringify(
            {
              name: slugify(title),
              private: true,
              version: '0.1.0',
              scripts: {
                dev: 'next dev',
                build: 'next build',
                start: 'next start -p 3000',
              },
              dependencies: {
                next: '^15.0.0',
                react: '^19.0.0',
                'react-dom': '^19.0.0',
              },
            },
            null,
            2,
          ),
        },
        {
          path: 'app/layout.tsx',
          language: 'typescript',
          isEntry: true,
          content: `import './globals.css';\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang="en">\n      <body>{children}</body>\n    </html>\n  );\n}\n`,
        },
        {
          path: 'app/page.tsx',
          language: 'typescript',
          isEntry: true,
          content: `export default function Page() {\n  return (\n    <main className="shell">\n      <section className="hero">\n        <p className="eyebrow">AI Generated Prototype</p>\n        <h1>${escapeTemplateLiteral(title)}</h1>\n        <p>${escapeTemplateLiteral(prompt.slice(0, 220))}</p>\n      </section>\n    </main>\n  );\n}\n`,
        },
        {
          path: 'app/globals.css',
          language: 'css',
          content:
            'html,body{margin:0;padding:0;font-family:system-ui,sans-serif;background:#f7f1e8;color:#1d1d1d}.shell{min-height:100vh;display:grid;place-items:center;padding:32px}.hero{max-width:720px;padding:40px;border-radius:24px;background:white;box-shadow:0 20px 60px rgba(0,0,0,.08)}.eyebrow{letter-spacing:.18em;text-transform:uppercase;font-size:12px;color:#b35c2e}h1{font-size:56px;line-height:1;margin:12px 0}p{font-size:18px;line-height:1.6}',
        },
        {
          path: 'README.md',
          kind: 'GENERATED',
          content: `# ${title}\n\nPrompt:\n\n${prompt}\n`,
        },
        {
          path: 'Dockerfile',
          kind: 'CONFIG',
          content:
            'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nRUN if [ -f package.json ]; then npm install; fi\nEXPOSE 3000\nCMD ["npm","run","start"]\n',
        },
      ],
      rawText: prompt,
    });
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeTemplateLiteral(value: string) {
  return value.replace(/[`$\\]/g, '\\$&');
}
