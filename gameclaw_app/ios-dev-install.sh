#!/usr/bin/env bash
#
# Build GameClaw and put it on the iPhone plugged into this Mac.
#
# This exists because the free Apple Personal Team hands out provisioning profiles that last seven
# days. When one expires the app stops launching - iOS refuses it, the Home screen icon does
# nothing - and the fix is simply to build again. That is not an error worth diagnosing each time,
# so the whole recovery lives here: run this script, and the profile is renewed, the app rebuilt
# and reinstalled.
#
#   ./ios-dev-install.sh            build, install and launch on the connected iPhone
#   ./ios-dev-install.sh --debug    the same, in debug (see the warning below)
#
# A debug build cannot be launched from the Home screen on iOS 14+ - only from Flutter tooling or
# Xcode - so release is the default. Nothing about a release build here goes near the App Store.
#
# What this never touches, and must not: the OAuth client ids, the Firebase project or its package
# versions, anything under android/, and the production backend. The iOS signing identity is the
# only credential involved, it belongs to the free Personal Team, and it costs nothing.
set -euo pipefail

cd "$(dirname "$0")"

MODE="release"
[ "${1:-}" = "--debug" ] && MODE="debug"

# ---------------------------------------------------------------------------------------------
# Tools. Resolved rather than assumed: a non-interactive shell does not read the profile that puts
# flutter, Homebrew's pod, or Xcode on PATH, and the failure is otherwise a bare "not found".
# ---------------------------------------------------------------------------------------------
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

FLUTTER="$(command -v flutter || true)"
for candidate in "$HOME/dev/flutter/bin/flutter" "$HOME/flutter/bin/flutter" /opt/flutter/bin/flutter; do
  [ -n "$FLUTTER" ] && break
  [ -x "$candidate" ] && FLUTTER="$candidate"
done
[ -n "$FLUTTER" ] || { echo "flutter SDK not found. Put it on PATH or install it at ~/dev/flutter." >&2; exit 1; }

# Full Xcode, not the Command Line Tools: the CLT carry the macOS SDKs and no iOS SDK at all, and
# `xcode-select -p` can quietly point back at them after a system update.
if [ -d /Applications/Xcode.app ]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
else
  echo "Xcode is not installed at /Applications/Xcode.app. iOS builds need it; the Command Line Tools are not enough." >&2
  exit 1
fi

command -v pod >/dev/null || { echo "CocoaPods not found. Install it with: brew install cocoapods" >&2; exit 1; }

TEAM="$(sed -n 's/^DEVELOPMENT_TEAM *= *//p' ios/Flutter/Release.xcconfig | tr -d ' ')"
[ -n "$TEAM" ] || { echo "DEVELOPMENT_TEAM is not set in ios/Flutter/Release.xcconfig." >&2; exit 1; }

# ---------------------------------------------------------------------------------------------
# The device. Found by asking rather than by hardcoding a UDID, so a replacement phone just works.
# ---------------------------------------------------------------------------------------------
UDID="$(xcrun devicectl list devices 2>/dev/null \
  | awk '/physical/ && !/unavailable/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) print $i }' \
  | head -1)"

if [ -z "$UDID" ]; then
  cat >&2 <<'MSG'
No connected iPhone that is ready to build to.

  * plug the phone in with a cable that carries data, not only power
  * unlock it, and tap Trust if it asks
  * check it is not listed as "unavailable": xcrun devicectl list devices

MSG
  exit 1
fi
echo "==> device $UDID"

# ---------------------------------------------------------------------------------------------
# Provisioning. This is the step that makes expiry a non-event.
#
# `flutter build ios` asks Xcode for a profile but never offers to create one, so the first build
# after expiry fails with "No profiles for 'win.gameclaw.app' were found" - which reads like a
# configuration mistake and is not. Only -allowProvisioningUpdates lets Xcode mint or renew one,
# so it runs first, every time. When the profile is still valid this is a no-op costing seconds.
# ---------------------------------------------------------------------------------------------
echo "==> renewing the provisioning profile if needed (team $TEAM)"
xcodebuild -workspace ios/Runner.xcworkspace \
  -scheme Runner \
  -configuration Release \
  -destination "id=$UDID" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM" \
  -quiet \
  build >/dev/null

# ---------------------------------------------------------------------------------------------
# Build. Through build-release.sh so iOS uses exactly the dart-defines Android does - one place
# that knows the API base and the Google client ids, rather than a second copy drifting out of date.
# ---------------------------------------------------------------------------------------------
echo "==> building ($MODE)"
if [ "$MODE" = "release" ]; then
  ./build-release.sh ios >/dev/null
else
  "$FLUTTER" build ios --debug \
    --dart-define=GC_API_BASE="https://gameclaw-api.onrender.com/api/v1" \
    --dart-define=GC_AUTH_BASE="https://gameclaw-api.onrender.com/api/v1" \
    --dart-define=GC_GOOGLE_SERVER_CLIENT_ID="400646694915-b4oh5athe842emcnga4913s1oq1igjh1.apps.googleusercontent.com" \
    --dart-define=GC_GOOGLE_IOS_CLIENT_ID="400646694915-hm7av2f3dgs60k955igeasok409g6hh5.apps.googleusercontent.com" >/dev/null
fi

APP="build/ios/iphoneos/Runner.app"
[ -d "$APP" ] || { echo "the build produced no $APP" >&2; exit 1; }

# Checks the two things that fail silently. An unsigned app installs and then refuses to launch,
# and an unresolved $(GOOGLE_REVERSED_CLIENT_ID) ships the literal string, which looks correct in
# the source and breaks Google sign-in on the device with nothing in the logs to say why.
codesign -dv "$APP" >/dev/null 2>&1 || { echo "$APP is not signed" >&2; exit 1; }
if plutil -p "$APP/Info.plist" | grep -q 'GOOGLE_REVERSED_CLIENT_ID'; then
  echo "the Google URL scheme did not resolve - Info.plist still holds the build-setting placeholder" >&2
  exit 1
fi

# ---------------------------------------------------------------------------------------------
# Install. Retried once: transfers drop with "device disconnected immediately after connecting"
# often enough to be worth absorbing, and the failure is easy to miss because the launch that
# follows will happily start the *previous* build and look like success.
# ---------------------------------------------------------------------------------------------
echo "==> installing"
if ! xcrun devicectl device install app --device "$UDID" "$APP" 2>&1 | tee /tmp/gc-install.log | grep -q 'App installed'; then
  echo "    first attempt failed, retrying"
  sleep 3
  xcrun devicectl device install app --device "$UDID" "$APP" 2>&1 | tee /tmp/gc-install.log | grep -q 'App installed' || {
    echo "install failed:" >&2
    sed 's/^/    /' /tmp/gc-install.log >&2
    exit 1
  }
fi

echo "==> launching"
xcrun devicectl device process launch --device "$UDID" --terminate-existing win.gameclaw.app >/dev/null

# The expiry date is the one number worth knowing before walking away from the machine.
PROFILE="$APP/embedded.mobileprovision"
if [ -f "$PROFILE" ]; then
  security cms -D -i "$PROFILE" > /tmp/gc-profile.plist 2>/dev/null && python3 - <<'PY' || true
import plistlib, datetime
d = plistlib.load(open("/tmp/gc-profile.plist", "rb"))
exp = d.get("ExpirationDate")
if exp:
    days = (exp - datetime.datetime.now()).days
    print(f"==> provisioning profile valid until {exp:%Y-%m-%d %H:%M} ({days} days)")
    if days <= 2:
        print("    run this script again before it lapses, or the app will stop launching")
PY
fi

echo "==> GameClaw is installed and running on the iPhone"
