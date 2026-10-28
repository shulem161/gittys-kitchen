// Applies each data-changes/NNN-*.js file once to the Firebase database (Firestore).
// Run by .github/workflows/data-changes.yml with the FIREBASE_SERVICE_ACCOUNT key.
// Finished changes are recorded in meta/dataChanges so they never run twice.
const admin = require('firebase-admin');
const fs = require('fs'), path = require('path');
admin.initializeApp({credential: admin.credential.applicationDefault(), projectId: 'gittys-kitchen'});
const db = admin.firestore();
const say = (lvl, msg) => console.log(`::${lvl}::${msg}`);

(async () => {
  const metaRef = db.doc('meta/dataChanges');
  const done = ((await metaRef.get()).data() || {}).done || {};
  const files = fs.readdirSync(__dirname).filter(f => /^\d{3}-.+\.js$/.test(f)).sort();
  const latest = files[files.length - 1];
  if (done[latest]) say('notice', `Newest change ${latest}: ${done[latest].result}`);
  for (const f of files) {
    if (done[f]) { console.log(`${f}: already applied on ${new Date(done[f].at).toISOString().slice(0,10)}`); continue; }
    const change = require(path.join(__dirname, f));
    const result = await change(db, admin);
    say('notice', `${f}: ${result}`);
    await metaRef.set({done: {[f]: {at: Date.now(), result: String(result)}}}, {merge: true});
  }
})().catch(e => { say('error', e.message); process.exit(1); });
