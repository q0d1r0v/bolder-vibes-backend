#!/usr/bin/env bash
#
# Build the Bolder Vibes Expo preview base image.
#
# This bakes:
#   - node_modules for the canonical starter template
#   - Metro's transform cache, pre-warmed by a dummy bundle
#
# Re-run whenever src/projects/templates/template-registry.ts deps change.
# Runtime (docker-runner.service.ts) selects the image by this tag.
#
set -euo pipefail

cd "$(dirname "$0")"

TAG="${1:-latest}"
IMAGE="bv-expo-preview"

echo "==> Building ${IMAGE}:${TAG} (and :latest)"
docker build \
  -t "${IMAGE}:${TAG}" \
  -t "${IMAGE}:latest" \
  .

echo ""
echo "==> Image info"
docker image inspect "${IMAGE}:latest" \
  --format 'Size: {{.Size}} bytes  Created: {{.Created}}'

echo ""
echo "==> Metro cache entries"
docker run --rm "${IMAGE}:latest" \
  sh -c 'find /root/.metro-cache -type f 2>/dev/null | wc -l'

echo ""
echo "==> Done. Tag: ${IMAGE}:${TAG}"
