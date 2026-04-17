import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * The SDK we target for preview & cloud builds. Keep this in sync with
 * the default `expo` range in `projects/templates/template-registry.ts`.
 *
 * IMPORTANT: individual `expo-*` versions are NOT hard-coded here.
 * The preview container's `EXPO_INSTALL` step (see preview.interface.ts)
 * aligns user-declared versions against `/bv-meta/package.json` inside
 * the baked Docker image. The baked image is the authoritative source
 * of SDK-consistent versions, which means bumping an SDK is a one-line
 * change here + a rebuild of `bv-expo-preview:latest` — we never have
 * to guess individual dep versions by hand.
 */
export const TARGET_EXPO_SDK = 54;
export const TARGET_EXPO_RANGE = `~${TARGET_EXPO_SDK}.0.0`;

/**
 * Ensure the project's `package.json` declares the target `expo` major
 * range. When AI-generated or legacy projects declare an older major
 * (or no `expo` at all), we rewrite it here — the baked-image
 * alignment step in the container then handles every dependent
 * `expo-*` version automatically.
 *
 * Returns `true` when the file was modified, `false` otherwise.
 * Never throws on missing / malformed package.json.
 */
export async function upgradeProjectToTargetSdk(
  workDir: string,
): Promise<boolean> {
  const pkgPath = path.join(workDir, 'package.json');
  let raw: string;
  try {
    raw = await fs.readFile(pkgPath, 'utf8');
  } catch {
    return false;
  }

  let parsed: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }

  const deps = parsed.dependencies ?? {};
  if (deps.expo === TARGET_EXPO_RANGE) return false; // already aligned

  deps.expo = TARGET_EXPO_RANGE;
  parsed.dependencies = deps;
  await fs.writeFile(pkgPath, JSON.stringify(parsed, null, 2));
  return true;
}
