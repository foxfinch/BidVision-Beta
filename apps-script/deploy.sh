#!/usr/bin/env bash
#
# Guarded deploy for the BidVision signup/welcome-email Apps Script backend.
#
# One command, refuses to do the wrong thing. It will NOT push or deploy unless
# every safety check passes. See DEPLOY.md for the why behind each guard.
#
#   ./deploy.sh                 full deploy (push + redeploy to the pinned URL)
#   ./deploy.sh --dry-run       run every guard, then stop before push/deploy
#   ./deploy.sh -y              skip the drift confirmation prompt (non-interactive)
#   ./deploy.sh -m "message"    deploy description (default: last commit touching Code.gs)
#
set -euo pipefail

# --- pinned config -----------------------------------------------------------
# DEPLOY_ID is the production deployment. Redeploying to THIS id keeps the same
# /exec URL that beta/app.js hardcodes. Omitting it (a bare `clasp deploy`) mints
# a NEW url and silently detaches the live site from this backend. Never do that.
DEPLOY_ID="AKfycbyjy2oY1J3wHCe1TUKbeEmWIgA7GXzkwb4R3J0TPVNG5Hmt3W8ElmlQcmN2kaW_xImoOg"
EXPECTED_ACCOUNT="jameson@foxfinch.co"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_JS="$REPO_ROOT/beta/app.js"
SRC="$SCRIPT_DIR/Code.gs"

# --- args --------------------------------------------------------------------
DRY_RUN=0; ASSUME_YES=0; DESC=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    -y|--yes)  ASSUME_YES=1; shift ;;
    -m)        DESC="${2:-}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$DESC" ]] || DESC="$(cd "$REPO_ROOT" && git log -1 --pretty=%s -- apps-script/Code.gs 2>/dev/null || echo "manual deploy")"

cd "$SCRIPT_DIR"
fail() { echo "ERROR: $*" >&2; exit 1; }

# --- guard 1: auth works (and, implicitly, it's the right account) -----------
echo "==> [1/5] clasp auth"
DEPLOYMENTS="$(clasp deployments 2>&1)" || {
  if grep -qi invalid_rapt <<<"$DEPLOYMENTS"; then
    fail "clasp auth expired (invalid_rapt). Fix: run 'clasp login', sign in as $EXPECTED_ACCOUNT, and COMPLETE the password/2FA reauth prompt (don't just close the tab)."
  fi
  fail "clasp not working:\n$DEPLOYMENTS"
}

# --- guard 2: the pinned deployment exists on this account -------------------
# If you were logged into the wrong Google account, this id would not appear.
echo "==> [2/5] pinned deployment present"
grep -q "$DEPLOY_ID" <<<"$DEPLOYMENTS" \
  || fail "pinned deployment $DEPLOY_ID not found on the logged-in account. Are you signed in as $EXPECTED_ACCOUNT?\nSeen:\n$DEPLOYMENTS"

# --- guard 3: the GAS-URL invariant (live site -> this backend) --------------
# beta/app.js must post to the deployment we're about to update, or the site and
# the backend are talking past each other.
echo "==> [3/5] app.js GAS_URL matches the pinned deployment"
grep -q "$DEPLOY_ID" "$APP_JS" \
  || fail "$APP_JS GAS_URL does not contain $DEPLOY_ID. Deploying would leave the live site pointed at a different backend. Aborting."

# --- guard 4: web-editor drift (pull remote to a temp dir, never the worktree)
echo "==> [4/5] drift check (remote vs repo source)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cp "$SCRIPT_DIR/.clasp.json" "$TMP/.clasp.json"
( cd "$TMP" && clasp pull >/dev/null 2>&1 ) || fail "could not pull remote for drift check"
REMOTE="$TMP/Code.js"   # clasp pulls scripts as .js
[[ -f "$REMOTE" ]] || fail "drift check: remote Code not pulled"
if diff -q "$REMOTE" "$SRC" >/dev/null 2>&1; then
  echo "    remote already matches local source (no source changes to push)"
else
  echo "    --- diff: remote (<) vs your local source (>) ---"
  diff "$REMOTE" "$SRC" || true
  echo "    -------------------------------------------------"
  echo "    Lines marked '>' are YOUR pending change (expected)."
  echo "    Any line marked '<' you don't recognize = someone edited in the web editor."
  if [[ "$ASSUME_YES" -eq 0 && "$DRY_RUN" -eq 0 ]]; then
    read -r -p "    Push will OVERWRITE the remote with your local source. Continue? [y/N] " ans
    [[ "$ans" == "y" || "$ans" == "Y" ]] || fail "aborted by user (possible drift)"
  fi
fi

# --- guard 5: ready ----------------------------------------------------------
echo "==> [5/5] all guards passed"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "DRY RUN: stopping before push/deploy. Would deploy to @$DEPLOY_ID with: \"$DESC\""
  exit 0
fi

echo "==> pushing source"
clasp push -f
echo "==> redeploying production (id pinned, /exec URL preserved)"
clasp deploy -i "$DEPLOY_ID" -d "$DESC"
echo "==> verify"
clasp deployments | grep "$DEPLOY_ID" || true
echo "Done. Live /exec URL unchanged; next signup uses the updated code."
