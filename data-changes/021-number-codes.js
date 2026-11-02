// Owner's request (4.15): recipe codes become numbers only. Pesach recipes start with 2, every other recipe with 1;
// each letter becomes two digits in the old letter order (A → 01, B → 02 … no I or O, so J → 09, K → 10 …).
// A001 → 101001, B014 → 102014, Pesach LA001 → 201001, LC012 → 203012. Deleted recipes too, so codes are never reused.
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const n2 = L => /^\d+$/.test(String(L)) ? String(+L).padStart(2, '0') : String((LETTERS.indexOf(L) + 1) || 99).padStart(2, '0');
module.exports = async (db) => {
  const metaRef = db.collection('meta').doc('codes');
  const ms = await metaRef.get(); const map = ms.exists ? ms.data() : {};
  const cats = map.cats || {}, secs = map.secs || {};
  const pesach = Object.keys(cats).find(c => /^pesach$/i.test(c));
  const pesachL = pesach ? cats[pesach] : null;
  const conv = code => {
    let m;
    if ((m = /^([A-Z])(\d{3})$/.exec(code))) return '1' + n2(m[1]) + m[2];
    if ((m = /^([A-Z])([A-Z])(\d{3})$/.exec(code))) return m[1] === pesachL ? '2' + n2(m[2]) + m[3] : '1' + n2(m[1]) + n2(m[2]) + m[3];
    return null;
  };
  const snap = await db.collection('recipes').get();
  const todo = [], odd = [];
  for (const d of snap.docs) {
    const c = d.data().code; if (!c) continue;
    const nc = conv(c); if (nc) todo.push([d.ref, nc, c]); else if (!/^[12]\d+$/.test(c)) odd.push(c);
  }
  const seen = new Map();
  for (const [, nc, c] of todo) { if (seen.has(nc)) throw new Error(`two codes would both become ${nc}: ${seen.get(nc)} and ${c}`); seen.set(nc, c); }
  for (let i = 0; i < todo.length; i += 400) {
    const batch = db.batch();
    todo.slice(i, i + 400).forEach(([ref, code]) => batch.update(ref, {code}));
    await batch.commit();
  }
  const ncats = {}, nsecs = {};
  Object.entries(cats).forEach(([c, L]) => { ncats[c] = n2(L); });
  Object.entries(secs).forEach(([c, m]) => { nsecs[c] = {}; Object.entries(m || {}).forEach(([s, L]) => { nsecs[c][s] = n2(L); }); });
  await metaRef.set({cats: ncats, secs: nsecs});
  return `${todo.length} recipe codes are now numbers. Categories: ` + Object.entries(ncats).map(([c, v]) => /^pesach$/i.test(c) ? `2 ${c}` : `1${v} ${c}`).join(', ')
    + (pesach && nsecs[pesach] ? '. Pesach: ' + Object.entries(nsecs[pesach]).map(([s, v]) => `2${v} ${s}`).join(', ') : '') + (odd.length ? `. Left alone: ${odd.join(', ')}` : '');
};
