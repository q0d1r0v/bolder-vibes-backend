FROM reactnativecommunity/react-native-android:latest

# This image contains a pre-installed Android SDK, OpenJDK 17, and Gradle.
# It is used to run `expo prebuild` + `./gradlew assembleDebug` against an
# arbitrary Bolder Vibes project mounted at /app.
#
# Build flow at runtime (driven by ApkBuildService):
#   1. cd /app
#   2. npm install --prefer-offline --no-audit --no-fund
#   3. npx expo prebuild --platform android --no-install --clean
#   4. cd android && ./gradlew assembleDebug --no-daemon
#   5. The resulting APK is at
#        /app/android/app/build/outputs/apk/debug/app-debug.apk

ENV ANDROID_SDK_ROOT=/opt/android \
    EXPO_NO_TELEMETRY=1 \
    CI=1 \
    GRADLE_OPTS="-Dorg.gradle.daemon=false -Dorg.gradle.jvmargs=-Xmx2g"

# Ensure node 20 is available (some base images ship with older node versions).
RUN if ! node -v | grep -q "^v20"; then \
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
      apt-get install -y nodejs && \
      rm -rf /var/lib/apt/lists/*; \
    fi

WORKDIR /app

# The actual build command is passed to the container at runtime by
# ApkBuildService via `sh -c`. This image only provides the toolchain.
CMD ["bash"]
