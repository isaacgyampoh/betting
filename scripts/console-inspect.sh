#!/bin/bash
# Read-only inspection of the Google Cloud Console through the already-signed-in Safari session.
#
# Does:   opens ONE new Safari tab; navigates it; reports URL and title; reads page innerText; on a
#         client detail page also reads <input> VALUES, which is where the package name and the
#         certificate fingerprint live (innerText does not include form values).
# Never:  reads document.cookie, localStorage or sessionStorage; clicks; types; submits; deletes;
#         closes or reuses an existing tab; assigns to any field.
#
#   ./scripts/console-inspect.sh <project-id> [oauth-client-id]
set -uo pipefail
PROJECT="${1:?usage: console-inspect.sh <project-id> [oauth-client-id]}"
CLIENT="${2:-}"

if [ -n "$CLIENT" ]; then
  URL="https://console.cloud.google.com/apis/credentials/oauthclient/${CLIENT}?project=${PROJECT}"
else
  URL="https://console.cloud.google.com/apis/credentials?project=${PROJECT}"
fi

osascript <<APPLESCRIPT
tell application "Safari"
    make new document with properties {URL:"${URL}"}
    delay 12
    set theURL to URL of front document
    set theTitle to name of front document
end tell
return "URL: " & theURL & linefeed & "TITLE: " & theTitle
APPLESCRIPT

read_js() {
  osascript 2>/dev/null <<APPLESCRIPT || true
tell application "Safari"
    do JavaScript "$1" in front document
end tell
APPLESCRIPT
}

# The Console renders late, so poll rather than guess a delay.
for _ in 1 2 3 4 5 6 7 8; do
  TEXT=$(read_js "document.body.innerText")
  case "$TEXT" in
    *"OAuth 2.0 Client"*|*"API Keys"*|*"Package name"*|*"Client ID"*) break ;;
  esac
  sleep 6
done
echo "--- page text ---"
printf '%s\n' "$TEXT" | head -200

if [ -n "$CLIENT" ]; then
  echo "--- field values ---"
  sleep 4
  read_js "var o=[];document.querySelectorAll('input,textarea').forEach(function(e){var v=e.value;if(v&&v.trim()){o.push((e.getAttribute('aria-label')||e.name||e.id||'field')+' = '+v.trim());}});o.join(String.fromCharCode(10))"
fi
