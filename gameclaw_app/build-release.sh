#!/usr/bin/env bash
# Builds the signed Android release with the defines the app needs to reach production.
#
# This script exists because the defines are not optional and their absence is silent. Without
# GC_API_BASE the app falls back to `http://10.0.2.2:3000/api/v1` - the Android emulator's route to
# a developer's laptop - and the build installs, signs and launches perfectly while every screen
# reports "Something went wrong". Without GC_AUTH_BASE sign-in falls back to Supabase, whose
# project no longer exists.
#
# None of these three values is a secret: the API base and the web client id are both readable
# from any installed APK, and the signing key is what makes a build ours. The keystore itself is
# in android/key.properties and is not in version control.
#
#   ./build-release.sh            # APK, for installing on a device
#   ./build-release.sh appbundle  # AAB, for uploading to Play
set -euo pipefail

TARGET="${1:-apk}"
API_BASE="https://gameclaw-api.onrender.com/api/v1"

# The **web** OAuth client, not the Android one: it is the audience the ID token is addressed to,
# and the server checks it against GOOGLE_WEB_CLIENT_ID in render.yaml. Supplying the Android id
# here produces a token the API rejects. See docs/release-signing.md.
GOOGLE_SERVER_CLIENT_ID="400646694915-b4oh5athe842emcnga4913s1oq1igjh1.apps.googleusercontent.com"

cd "$(dirname "$0")"
exec flutter build "$TARGET" --release \
  --dart-define=GC_API_BASE="$API_BASE" \
  --dart-define=GC_AUTH_BASE="$API_BASE" \
  --dart-define=GC_GOOGLE_SERVER_CLIENT_ID="$GOOGLE_SERVER_CLIENT_ID"
