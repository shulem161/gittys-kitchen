// Phone alert to the owner when a new update is waiting for his approval (App & web updates).
// Run by .github/workflows/notify-updates.yml after index.html is pushed. Reads the UPDATES list in index.html,
// compares it with meta/features (approved / declined) and meta/updnotified (already alerted), and sends one alert
// to the owner's notice topics: the site's topic (NTFY_TOPIC) and his own, if he turned one on in Account settings.
const admin = require('firebase-admin');
const fs = require('fs');
admin.initializeApp({credential: admin.credential.applicationDefault(), projectId: 'gittys-kitchen'});
const db = admin.firestore();
(async () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const block = html.slice(html.indexOf('const UPDATES = ['), html.indexOf('];', html.indexOf('const UPDATES = [')));
  const ups = [...block.matchAll(/^\s*\["([a-z0-9]+)","([^"]*)","([^"]*)","([^"]*)","[^\n]*?,\s*(true|false)(?:,\s*"[a-z]+")?\],?\s*$/gm)].map(m => ({k: m[1], v: m[2], title: m[4], pre: m[5] === 'true'}));
  const on = ((await db.doc('meta/features').get()).data() || {}).on || {};
  const ref = db.doc('meta/updnotified'), seen = new Set(((await ref.get()).data() || {}).keys || []);
  const waiting = ups.filter(u => on[u.k] === undefined ? !u.pre : on[u.k] === false);
  const fresh = waiting.filter(u => !seen.has(u.k));
  if (!fresh.length) { console.log(`Nothing new to alert about (${waiting.length} waiting).`); return; }
  const topic = (html.match(/const NTFY_TOPIC = "([^"]+)"/) || [])[1];
  const title = fresh.length === 1 ? 'An update is waiting for your approval' : `${fresh.length} updates are waiting for your approval`;
  const body = fresh.map(u => '• ' + u.title).join('\n') + `\n\n${waiting.length} waiting in Inboxes → App & web updates.`;
  const send = t => fetch(`https://ntfy.sh/${t}?` + new URLSearchParams({title, click: 'https://shulem161.github.io/gittys-kitchen/#updates', tags: 'sparkles', priority: '4'}), {method: 'POST', body});
  const topics = [topic];
  const owner = ((await db.doc('meta/admin').get()).data() || {}).uid;
  if (owner) { const n = (await db.doc('notify/' + owner).get()).data(); if (n && n.topic) topics.push(n.topic); }
  for (const t of topics.filter(Boolean)) { const r = await send(t); if (!r.ok) throw new Error('ntfy answered ' + r.status); }
  await ref.set({keys: [...new Set([...seen, ...ups.map(u => u.k).filter(k => fresh.some(f => f.k === k) || seen.has(k))])], at: Date.now()});
  console.log(`::notice::Alerted the owner about ${fresh.length} new ${fresh.length === 1 ? 'update' : 'updates'}: ${fresh.map(u => u.k).join(', ')}`);
})().catch(e => { console.log(`::error::${e.message}`); process.exit(1); });
