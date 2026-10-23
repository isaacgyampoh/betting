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

# The iOS OAuth client, which does not exist yet and is deliberately not invented here. It must
# be created in **game-claw (400646694915)** - the project that owns the web client above - and
# NOT in the Firebase project, gameclaw-push-notifications (569032239509). Those are two separate
# projects: the API checks a token's audience against the web client, so a client issued by the
# other project produces a token it rejects.
#
# Left empty, the app passes no clientId and google_sign_in_ios falls back to CLIENT_ID in
# GoogleService-Info.plist - which comes from the Firebase project, i.e. the wrong one. Android is
# unaffected either way: its client is matched by package and signing fingerprint, never named.
#
#   GC_GOOGLE_IOS_CLIENT_ID=400646694915-xxxx.apps.googleusercontent.com ./build-release.sh ios
GOOGLE_IOS_CLIENT_ID="${GC_GOOGLE_IOS_CLIENT_ID:-}"

cd "$(dirname "$0")"

# Resolve the SDK rather than assuming PATH. A non-interactive shell (CI, a hook, an agent) does
# not read the profile that puts flutter on PATH, and the failure is otherwise a bare
# "flutter: not found" after which an install command happily reinstalls the previous APK -
# a stale build that looks like a successful one.
FLUTTER="$(command -v flutter || true)"
for candidate in "$HOME/dev/flutter/bin/flutter" "$HOME/flutter/bin/flutter" /opt/flutter/bin/flutter; do
  [ -n "$FLUTTER" ] && break
  [ -x "$candidate" ] && FLUTTER="$candidate"
done
if [ -z "$FLUTTER" ]; then
  echo "flutter SDK not found. Put it on PATH or install it at ~/dev/flutter." >&2
  exit 1
fi

exec "$FLUTTER" build "$TARGET" --release \
  --dart-define=GC_API_BASE="$API_BASE" \
  --dart-define=GC_AUTH_BASE="$API_BASE" \
  --dart-define=GC_GOOGLE_SERVER_CLIENT_ID="$GOOGLE_SERVER_CLIENT_ID" \
  --dart-define=GC_GOOGLE_IOS_CLIENT_ID="$GOOGLE_IOS_CLIENT_ID"
