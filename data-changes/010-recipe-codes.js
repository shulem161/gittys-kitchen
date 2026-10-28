// Owner's request: recipe codes per category. Each category gets a letter (A, B, C… in A–Z order, no I or O)
// and its recipes are numbered from 101 (A101, A102…). In a category with sections (Pesach) each section gets
// a second letter and numbers from 001: LA001 Family recipes, LB001 Cakes & Frostings, and so on.
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const SEC = ['Family recipes', 'Cakes & Frostings', 'Fish', 'Soups & Accompaniments', 'Meat', 'Side Dishes, Vegetables & Salads', 'Kugel', 'Milchig', 'Drinks & Desserts', 'Miscellaneous'];
module.exports = async (db) => {
  const snap = await db.collection('recipes').get();
  const live = snap.docs.map(d => ({id: d.id, ...d.data()})).filter(r => !r.deleted);
  const cmp = (a, b) => a.localeCompare(b, undefined, {sensitivity: 'base', numeric: true});
  const name = r => String(r.t || '').replace(/^Untitled:\s*/, '').replace(/^[^A-Za-z0-9]+/, '');
  const cats = [...new Set(live.map(r => r.c))].sort(cmp);
  const map = {cats: {}, secs: {}};
  cats.forEach((c, i) => { map.cats[c] = LETTERS[i] || 'Z'; });
  const updates = [];
  for (const c of cats) {
    const list = live.filter(r => r.c === c);
    const L = map.cats[c];
    if (list.some(r => r.sec)) {
      const secs = [...new Set(list.map(r => r.sec || 'Family recipes'))].sort((a, b) => ((SEC.indexOf(a) + 1 || 99) - (SEC.indexOf(b) + 1 || 99)) || cmp(a, b));
      map.secs[c] = {}; secs.forEach((s, i) => { map.secs[c][s] = LETTERS[i] || 'Z'; });
      for (const s of secs) {
        const S2 = map.secs[c][s];
        list.filter(r => (r.sec || 'Family recipes') === s).sort((x, y) => cmp(name(x), name(y)))
          .forEach((r, i) => updates.push([r.id, L + S2 + String(i + 1).padStart(3, '0')]));
      }
    } else {
      list.sort((x, y) => cmp(name(x), name(y))).forEach((r, i) => updates.push([r.id, L + (101 + i)]));
    }
  }
  for (let i = 0; i < updates.length; i += 400) {
    const batch = db.batch();
    updates.slice(i, i + 400).forEach(([id, code]) => batch.update(db.collection('recipes').doc(id), {code}));
    await batch.commit();
  }
  await db.collection('meta').doc('codes').set(map);
  return `${updates.length} recipes got codes. Letters: ` + cats.map(c => `${map.cats[c]} ${c}`).join(', ');
};
