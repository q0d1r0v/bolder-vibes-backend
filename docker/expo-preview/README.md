# bv-expo-preview — pre-warmed Expo base image

Runtime preview containers start from this image instead of raw `node:20-alpine`. It bakes:

1. **`/app/node_modules`** — every dependency from the canonical starter template (`src/projects/templates/template-registry.ts`), installed and ready.
2. **`/root/.metro-cache`** — Metro's on-disk transform cache, pre-populated by a dummy `expo export` that imports every heavy module (`react-native`, `@react-navigation/*`, `@expo/vector-icons`, `react-native-safe-area-context`, `react-native-screens`, `@react-native-async-storage/async-storage`, `zustand`, etc.).
3. **`/app/.bv-baked-pkg-sha`** — SHA of the baked `package.json`. The runtime install command compares this to the user's `package.json` and skips `npm install` entirely when they match.

## Why this exists

Cold preview start used to take ~3 minutes:

```
Web Bundled 178128ms node_modules/expo/AppEntry.js (601 modules)
```

~99% of that was Metro compiling the dependency graph from scratch. With this image, transform cache entries for `react-native`/`@react-navigation`/`expo` already exist and hit on content-hash lookup, so Metro only bundles the user's own `src/` files. Target cold-start: **10-20 s**.

## Build

```bash
./build.sh                 # tags as :latest
./build.sh 2025-04-14      # tags as :2025-04-14 AND :latest
```

Takes ~3-5 minutes on first build (dominated by `npm install` + the warmup `expo export`). Subsequent builds reuse Docker's layer cache.

## Verify

```bash
docker run --rm bv-expo-preview:latest sh -c 'ls /app/node_modules | wc -l'
#   → expect ~150+

docker run --rm bv-expo-preview:latest sh -c 'find /root/.metro-cache -type f | wc -l'
#   → expect hundreds

docker run --rm bv-expo-preview:latest sh -c 'cat /app/.bv-baked-pkg-sha'
#   → 64-char sha256 hex

docker image inspect bv-expo-preview:latest --format 'Size: {{.Size}}'
#   → expect ~800MB-1.2GB
```

## Rebuild triggers

Rebuild whenever **`src/projects/templates/template-registry.ts`** dependency versions change. Keep `docker/expo-preview/package.json` byte-for-byte in sync with `EXPO_PACKAGE_JSON` in that file — if they diverge, Metro cache hits drop and baked `npm install` won't skip.

## Runtime contract

`src/sandbox/runners/docker-runner.service.ts` runs the container with:

- `-v bv-metro-cache-v1:/root/.metro-cache` (named volume seeded from the baked layer; persists user-project bundles across container restarts)
- `-v bv-npm-cache:/root/.npm` (npm tarball cache for packages users add on top of the baked set)
- **No `/app/node_modules` mount** — the baked layer provides it. A volume mount there would mask the pre-installed packages and defeat the image.

## Gotchas

- **Never declare `VOLUME` on `/app/node_modules` or `/root/.metro-cache`** in the Dockerfile. A declared volume shadows its underlying layer at runtime. The previous version of this Dockerfile had `VOLUME /app/node_modules` for exactly this reason — it is intentionally removed.
- **Keep `babel.config.js` in `warmup/` identical to the template's `EXPO_BABEL_CONFIG`.** Metro cache keys depend on the Babel config; a mismatch invalidates every entry and the warmup is wasted.
- **Metro cache is content-addressed.** Hits are determined by source SHA + transformer options, not by file path. Users' own `src/` files will always be transformed fresh (~5-10 s for 50 files), but the 500+ transforms from `react-native` + deps hit the baked cache.
