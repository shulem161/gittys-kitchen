// Owner's view: puts the version waiting in preview/ live once the owner has OK'd it in the app (meta/release).
// Run by .github/workflows/promote.yml every few minutes. Copies preview/index.html and preview/version.json to the
// live site, sets the offline cache name in sw.js, and tells the workflow (GITHUB_OUTPUT) to commit and push.
const admin = require('firebase-admin');
const fs = require('fs');
admin.initializeApp({credential: admin.credential.applicationDefault(), projectId: 'gittys-kitchen'});
(async () => {
  const pv = JSON.parse(fs.readFileSync('preview/version.json', 'utf8'));
  const live = JSON.parse(fs.readFileSync('version.json', 'utf8'));
  const ref = admin.firestore().doc('meta/release');
  const rel = (await ref.get()).data() || {};
  if (pv.web === live.web) { console.log(`Live is already ${live.web}; nothing waiting.`); return; }
  if (rel.approve !== pv.web) { console.log(`Version ${pv.web} is waiting for the owner's OK (OK'd: ${rel.approve || 'nothing'}).`); return; }
  const html = fs.readFileSync('preview/index.html', 'utf8');
  if (!html.includes(`const WEB_VERSION = "${pv.web}"`)) throw new Error(`preview/index.html isn't version ${pv.web}`);
  fs.writeFileSync('index.html', html);
  fs.writeFileSync('version.json', JSON.stringify(pv, null, 2));
  const sw = fs.readFileSync('sw.js', 'utf8').replace(/const CACHE = "gk-v[^"]*";/, `const CACHE = "gk-v${pv.web}";`);
  fs.writeFileSync('sw.js', sw);
  await ref.set({live: pv.web, liveAt: Date.now()}, {merge: true});
  fs.appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null', `promote=${pv.web}\n`);
  console.log(`::notice::The owner OK'd version ${pv.web}; it is going live.`);
})().catch(e => { console.log(`::error::${e.message}`); process.exit(1); });
