import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';

type ResolveFilename = (
  request: string,
  parent: NodeModule | undefined,
  isMain: boolean,
  options?: unknown,
) => string;

const runtimeModule = Module as typeof Module & {
  _resolveFilename: ResolveFilename;
};

const originalResolveFilename = runtimeModule._resolveFilename;

runtimeModule._resolveFilename = function resolveFilename(
  request,
  parent,
  isMain,
  options,
) {
  if (request.startsWith('@/')) {
    const jsTarget = path.join(__dirname, request.slice(2));
    request =
      jsTarget.endsWith('.js') && !fs.existsSync(jsTarget)
        ? `${jsTarget.slice(0, -3)}.ts`
        : jsTarget;
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};
