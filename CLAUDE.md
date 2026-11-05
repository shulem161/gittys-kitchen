# Gitty's Kitchen — notes for Claude

Family cookbook web app for Shulem Schlesinger (admin). Live at https://shulem161.github.io/gittys-kitchen/
(GitHub Pages from `main`). The Android app (Gittys-Kitchen.apk) is a WebView that loads that URL.

## Files
- `preview/index.html` — the whole app (HTML/CSS/JS in one file) — EDIT THIS ONE. It is the next version, served at
  /preview/ to the owner only ("Owner's view"). The built-in recipes are the `BUNDLED` array; Firebase settings follow `/*FIREBASE*/`.
- `index.html`, `version.json`, `sw.js` at the root are the LIVE site. Don't edit index.html or version.json by hand: when the owner taps
  "OK – put it live" in the preview (meta/release), `.github/workflows/promote.yml` (every 5 min, `tools/promote.js`) copies
  preview/index.html + preview/version.json to the root, sets `CACHE` in sw.js, pushes, then runs data changes.
- `sw.js` (offline cache), `manifest.webmanifest`, `icon-*.png` — installable web app.
- `version.json` — drives the in-app "Update now" / "Download update" bar (preview/version.json for the next version).
- `firestore.rules` — Firestore security rules. Pushing a change deploys it automatically
  (`.github/workflows/firebase-rules.yml`, secret `FIREBASE_SERVICE_ACCOUNT`).
- `data-changes/NNN-*.js` — one-time changes to the live Firestore data (e.g. moving recipes between
  categories). They wait with the new version and run once when the owner's OK puts it live (promote.yml; or
  run `.github/workflows/data-changes.yml` by hand); results show as notices on the run. Applied changes are recorded in `meta/dataChanges`.
  Note the preview uses the same live data, and firestore.rules deploy as soon as they're pushed — keep rules working for both versions.
- `tests/run-all.js` — end-to-end checks against a Firebase stand-in. Run before every push.

## Data (Firebase project `gittys-kitchen`, Firestore)
`names/{lowercased name}` → uid · `users/{uid}` {name,status: pending|approved|denied,favs} ·
`recipes/{id}` (admin writes; `deleted:true` = removed; `cover` thumb) · `submissions/{id}` (member recipes
and suggested changes, `editOf` = recipe id) · `photos/{id}` (base64 JPEG `img` + `thumb`, status).
Admin = whoever owns `names/shulem schlesinger`. Notifications: ntfy.sh topic in `NTFY_TOPIC`.

## Releasing a change
1. Edit `preview/index.html`. 2. Bump `WEB_VERSION` in preview/index.html and `"web"` in preview/version.json together
(sw.js is set when it goes live). 3. `node tests/run-all.js` must pass (it tests preview/index.html). 4. Commit and push to `main`.
5. Tell the owner the new version is in Owner's view (menu → Owner's view) waiting for his OK. Nothing reaches
admins, employees or customers until he OKs it.
The APK only needs rebuilding for native changes; its signing key is NOT in this repo (the owner has it
in Gittys-Kitchen-backup.zip). Never commit keys or the Firebase service account.

## Rules for automated check-ups
Report bugs and suggestions; do not push changes to the live site without the owner's go-ahead.
