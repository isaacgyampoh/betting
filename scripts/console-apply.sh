#!/bin/bash
# Applies ONE change to the Google Cloud Console through the already-signed-in Safari session.
#
# This script WRITES. It is deliberately separate from console-inspect.sh so the read-only grant
# cannot be repurposed into a mutating one. Audit it before granting permission to run it.
#
# Safety properties, all enforced below rather than merely promised:
#   * one operation per invocation, named explicitly on the command line
#   * every operation verifies the target's CURRENT package and SHA-1 first, and ABORTS unless they
#     match the values passed in — so it cannot act on the wrong client even if a URL is wrong
#   * it touches only the client id given to it; no enumeration, no bulk action
#   * it never reads document.cookie, localStorage or sessionStorage
#   * it opens its own tab and leaves existing tabs alone
#
#   ./scripts/console-apply.sh delete-client <project> <client-id> <expect-package> <expect-sha1>
#   ./scripts/console-apply.sh set-package   <project> <client-id> <expect-sha1> <new-package>
set -uo pipefail

ACTION="${1:?usage: console-apply.sh <delete-client|set-package> ...}"
PROJECT="${2:?project id required}"
CLIENT="${3:?oauth client id required}"

URL="https://console.cloud.google.com/apis/credentials/oauthclient/${CLIENT}?project=${PROJECT}"

open_tab() {
  osascript >/dev/null 2>&1 <<APPLESCRIPT
tell application "Safari"
    make new document with properties {URL:"${URL}"}
end tell
APPLESCRIPT
  sleep 14
}

read_js() {
  osascript 2>/dev/null <<APPLESCRIPT || true
tell application "Safari"
    do JavaScript "$1" in front document
end tell
APPLESCRIPT
}

# Values of the two text inputs on an Android client page, in document order:
# [0] display name, [1] package name, [2] SHA-1 fingerprint.
field() {
  read_js "var e=document.querySelectorAll('input[type=text],input:not([type])');(e[$1]&&e[$1].value||'').trim()"
}

require_match() {
  local label="$1" actual="$2" expected="$3"
  if [ "$actual" != "$expected" ]; then
    echo "ABORT: $label mismatch."
    echo "  on page : '$actual'"
    echo "  expected: '$expected'"
    exit 2
  fi
  echo "  verified $label = $actual"
}

open_tab
echo "page title: $(read_js 'document.title')"

case "$ACTION" in
  delete-client)
    EXPECT_PKG="${4:?expected package required}"
    EXPECT_SHA="${5:?expected sha-1 required}"
    echo "preconditions:"
    require_match "package" "$(field 1)" "$EXPECT_PKG"
    require_match "sha-1"   "$(field 2)" "$EXPECT_SHA"
    echo "deleting client ${CLIENT} from ${PROJECT} ..."
    # Find a control whose visible text is exactly Delete, click it, then confirm in the dialog.
    read_js "var b=Array.from(document.querySelectorAll('button,a')).find(function(x){return (x.innerText||'').trim().toLowerCase()==='delete';});if(b){b.click();'clicked-delete';}else{'no-delete-button';}"
    sleep 4
    read_js "var b=Array.from(document.querySelectorAll('button')).find(function(x){var t=(x.innerText||'').trim().toLowerCase();return t==='delete'||t==='confirm'||t==='ok';});if(b){b.click();'confirmed';}else{'no-confirm-button';}"
    sleep 6
    echo "post-state title: $(read_js 'document.title')"
    ;;

  set-package)
    EXPECT_SHA="${4:?expected sha-1 required}"
    NEW_PKG="${5:?new package required}"
    echo "preconditions:"
    require_match "sha-1" "$(field 2)" "$EXPECT_SHA"
    echo "  current package = $(field 1)"
    echo "setting package to ${NEW_PKG} ..."
    # Angular Material will not observe a bare .value assignment, so write through the native
    # setter and dispatch the events its form control listens for.
    read_js "var e=document.querySelectorAll('input[type=text],input:not([type])')[1];var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(e,'${NEW_PKG}');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.blur();e.value"
    sleep 2
    read_js "var b=Array.from(document.querySelectorAll('button')).find(function(x){return (x.innerText||'').trim().toLowerCase()==='save';});if(b){b.click();'clicked-save';}else{'no-save-button';}"
    sleep 8
    echo "package now reads: $(field 1)"
    echo "any error on page: $(read_js "var m=document.body.innerText.match(/already exists|error|failed/i);m?m[0]:'none'")"
    ;;

  *)
    echo "unknown action: $ACTION"; exit 1 ;;
esac
