# Gitty's Kitchen — notes for Claude

Family cookbook web app for Shulem Schlesinger (admin). Live at https://shulem161.github.io/gittys-kitchen/
(GitHub Pages from `main`). The Android app (Gittys-Kitchen.apk) is a WebView that loads that URL.

## Files
- `index.html` — the whole app (HTML/CSS/JS in one file). The built-in recipes are the `BUNDLED` array;
  Firebase settings follow `/*FIREBASE*/`. Edit this file directly.
- `sw.js` (offline cache), `manifest.webmanifest`, `icon-*.png` — installable web app.
- `version.json` — drives the in-app "Update now" / "Download update" bar.
- `firestore.rules` — Firestore security rules. Pushing a change deploys it automatically
  (`.github/workflows/firebase-rules.yml`, secret `FIREBASE_SERVICE_ACCOUNT`).
- `tests/run-all.js` — end-to-end checks against a Firebase stand-in. Run before every push.

## Data (Firebase project `gittys-kitchen`, Firestore)
`names/{lowercased name}` → uid · `users/{uid}` {name,status: pending|approved|denied,favs} ·
`recipes/{id}` (admin writes; `deleted:true` = removed; `cover` thumb) · `submissions/{id}` (member recipes
and suggested changes, `editOf` = recipe id) · `photos/{id}` (base64 JPEG `img` + `thumb`, status).
Admin = whoever owns `names/shulem schlesinger`. Notifications: ntfy.sh topic in `NTFY_TOPIC`.

## Releasing a change
1. Edit `index.html`. 2. Bump `WEB_VERSION` in index.html, `"web"` in version.json and `CACHE` in sw.js
together. 3. `node tests/run-all.js` must pass. 4. Commit and push to `main`.
The APK only needs rebuilding for native changes; its signing key is NOT in this repo (the owner has it
in Gittys-Kitchen-backup.zip). Never commit keys or the Firebase service account.

## Rules for automated check-ups
Report bugs and suggestions; do not push changes to the live site without the owner's go-ahead.
