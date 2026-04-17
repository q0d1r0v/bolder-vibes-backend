FROM node:20-alpine

# Minimal native tooling — we only bundle for web, so no python3/make/g++
# (those would be needed for native iOS/Android modules but not for
# react-native-web). Keep bash for the runtime install guard script and
# libc6-compat for packages that link against glibc stubs.
RUN apk add --no-cache bash libc6-compat

WORKDIR /app

# Install @expo/ngrok globally so `expo start --tunnel` works out of the
# box inside the sandbox. Tunnel mode is used by the native preview flow
# (Expo Go QR) to expose the Metro bundler to a user's real phone over
# the public internet without any LAN configuration.
RUN npm install -g @expo/ngrok@^4.1.0 --silent

# Pin Metro's on-disk transform cache to a predictable location so we can
# warm it at build time and the baked layer survives container restarts.
# IMPORTANT: we do NOT declare `VOLUME /root/.metro-cache` or
# `VOLUME /app/node_modules` — a declared volume would mask the baked
# image layer at runtime and defeat the entire point of this image.
ENV METRO_CACHE_DIR=/root/.metro-cache \
    EXPO_NO_TELEMETRY=1
# IMPORTANT: do NOT set CI=1 here. Expo detects CI at runtime and
# disables Metro's file watcher when it's truthy (log: "Metro is
# running in CI mode, reloads are disabled"). Without the watcher
# our file-sync writes never trigger HMR and users have to Stop →
# Start the preview after every AI edit. If a caller needs to
# suppress interactive prompts, pass `--non-interactive` on the
# command line — that flag does NOT flip the watcher off.

# 1. Install the canonical Bolder Vibes Expo starter dependencies.
#    This package.json MUST stay byte-for-byte in sync with
#    src/projects/templates/template-registry.ts EXPO_PACKAGE_JSON.
COPY package.json ./
RUN npm install --prefer-offline --no-audit --no-fund --loglevel=error

# 2. Copy the warmup project. These files exist only to force Metro to
#    traverse and transform every heavy module the AI commonly imports
#    (react-native, @react-navigation/*, @expo/vector-icons, etc.) so that
#    Metro's content-addressed transform cache is fully hot when a user's
#    real project is later bundled on top.
COPY warmup/ /app/warmup/
RUN cp /app/warmup/App.tsx        /app/App.tsx        && \
    cp /app/warmup/app.json       /app/app.json       && \
    cp /app/warmup/babel.config.js /app/babel.config.js && \
    cp /app/warmup/metro.config.js /app/metro.config.js && \
    cp /app/warmup/tsconfig.json  /app/tsconfig.json  && \
    cp /app/warmup/index.js       /app/index.js       && \
    mkdir -p /root/.metro-cache

# 3. Pre-bundle once in DEV mode so the baked cache entries actually hit
#    at runtime. Metro's transform cache keys include transformer options
#    (dev vs production), and at runtime users always run `expo start`
#    which is dev=true. `expo export` would bake dev=false entries and
#    miss every key at runtime.
#
#    We start `expo start --web` in the background, wait for the dev
#    server to come up, curl the bundle URL (which forces Metro to walk
#    the full module graph and populate /root/.metro-cache), then kill
#    the server. Net result: ~500 dev-mode transform entries baked in.
RUN apk add --no-cache curl && \
    (npx expo start --web --port 3000 > /tmp/expo.log 2>&1 &) && \
    for i in $(seq 1 60); do \
        sleep 2; \
        if curl -sf -o /dev/null "http://localhost:3000/"; then \
            echo "Expo dev server up after ${i} attempts"; \
            break; \
        fi; \
    done && \
    curl -sf --max-time 600 -o /tmp/warmup.bundle \
        "http://localhost:3000/node_modules/expo/AppEntry.bundle?platform=web&dev=true&hot=false&transform.routerRoot=app" && \
    echo "Warmup bundle: $(wc -c < /tmp/warmup.bundle) bytes" && \
    pkill -f "expo start" || true && \
    sleep 1 && \
    rm -rf /tmp/warmup.bundle /tmp/expo.log /app/warmup \
           /app/App.tsx /app/app.json /app/index.js \
           /app/metro.config.js /app/tsconfig.json

# 4. Move baked node_modules OUT OF /app. At runtime the user's workDir is
#    bind-mounted onto /app — any baked /app/* is hidden. By stashing the
#    pre-installed modules under /bv-meta/node_modules (outside the mount
#    path) we can cheaply `cp -al` them into the workdir at container
#    startup, saving the ~1-minute full npm install on every cold start.
#    Metro cache at /root/.metro-cache is already outside /app so it
#    survives untouched.
#
#    We ALSO stash the canonical package.json (as parsed JSON) so the
#    runtime install guard can compare dependency sets format-agnostically
#    instead of byte-comparing raw files that differ in whitespace.
RUN mkdir -p /bv-meta && \
    mv /app/node_modules /bv-meta/node_modules && \
    cp /app/package.json /bv-meta/baked-pkg.json && \
    node -e "const d=require('/bv-meta/baked-pkg.json').dependencies||{};const h=require('crypto').createHash('sha256');h.update(JSON.stringify(d,Object.keys(d).sort()));process.stdout.write(h.digest('hex'))" \
      > /bv-meta/baked-pkg-sha
