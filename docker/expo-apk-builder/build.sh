#!/usr/bin/env bash
#
# Build the Bolder Vibes Expo APK builder image.
#
# This image contains the Android SDK + OpenJDK + Gradle, and is used by
# ApkBuildService to run `expo prebuild && ./gradlew assembleDebug` against
# an arbitrary user project.
#
# The first build pulls a ~2 GB base image from Docker Hub, so it takes
# several minutes. Subsequent rebuilds are fast.
set -euo pipefail

cd "$(dirname "$0")"

TAG="${1:-latest}"
IMAGE="bv-expo-apk-builder"

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
echo "==> Done. Tag: ${IMAGE}:${TAG}"
