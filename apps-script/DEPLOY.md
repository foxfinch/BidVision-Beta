# Deploying the BidVision backend

This Apps Script project is the **signup + welcome-email backend** behind
bidvision.app/beta. The landing page (`beta/app.js`) POSTs registrations to this
script's web-app `/exec` URL; the script writes the Beta Tracker sheet and sends
the welcome email.

## TL;DR

```sh
cd apps-script
./deploy.sh            # guarded push + redeploy. Refuses to ship if a check fails.
./deploy.sh --dry-run  # run every safety check, stop before pushing
```

You do **not** type a deployment id or a `clasp deploy` command by hand. The
script pins them. That is the whole point.

## The two pipelines (don't confuse them)

| Change | Lives in | How it ships |
|---|---|---|
| Welcome email, signup logic, codes | `apps-script/Code.gs` | `./deploy.sh` (clasp → Apps Script) |
| Landing page, downloads, copy | `beta/`, `start/`, `testing/`, … | `git push` → GitHub Pages auto-builds bidvision.app |

The site half is just `git commit -- <files> && git push`; Pages rebuilds in
~30–60s. Verify with `curl -s https://bidvision.app/beta/ | grep <something>`.
There is no script for it because there is nothing to get wrong.

## What `deploy.sh` guards against (each is a real bug we hit)

1. **Auth expired (`invalid_rapt`).** clasp tokens for a Workspace account need a
   recent interactive reauth. The script checks first and tells you exactly how to
   fix it instead of failing halfway through a deploy.
2. **Wrong account.** It asserts the pinned deployment is visible on the
   logged-in account — which only happens when you're signed in as
   `jameson@foxfinch.co`.
3. **The GAS-URL invariant.** `beta/app.js` hardcodes this deployment's `/exec`
   URL. A bare `clasp deploy` (no `-i`) mints a **new** URL and silently detaches
   the live site from the backend — the form would post into the void with no
   error. The script always deploys to the pinned id, and refuses if `app.js` no
   longer points at it.
4. **Web-editor drift.** If someone edits the script in the Apps Script web editor,
   `clasp push -f` would clobber it. The script pulls the remote into a temp dir,
   diffs it against `Code.gs`, and makes you confirm before overwriting.
5. **Stray `Code.js`.** A plain `clasp pull` drops a `.js` next to the repo's
   `.gs`, creating an ambiguous double-push. The drift check pulls into a temp dir,
   so the working tree stays clean.

## Prerequisites (one-time per machine)

- `clasp` installed, logged in as **jameson@foxfinch.co** (`clasp login`).
- **Google Apps Script API: ON** for that account at
  <https://script.google.com/home/usersettings>. This is account-level. With it
  off you get the classic split: `clasp pull` works, `clasp push` fails.

## When auth breaks (`invalid_rapt`)

```sh
clasp login          # pick jameson@foxfinch.co, COMPLETE the password/2FA reauth
```
Don't just close the browser tab — clasp has to capture the redirect, and
`~/.clasprc.json` should be timestamped *now* afterward. Then re-run `./deploy.sh`.

## Pinned facts

- **scriptId:** see `.clasp.json`
- **Production deployment id:** `AKfycby…kaW_xImoOg` (pinned in `deploy.sh`; matches `beta/app.js` `GAS_URL`)
- **Beta Tracker sheet:** owned by jameson@foxfinch.co (id in `Code.gs` `CONFIG.SHEET_ID`)

## Related, out of scope here

`apps-script-reporter/` is a **separate** Apps Script project (its own scriptId)
with its own deploy. This script does not touch it; clone the same pattern if it
ever needs hardening.
