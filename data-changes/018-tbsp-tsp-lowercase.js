// Owner's request (3.95): tablespoon and teaspoon are written "tbsp" and "tsp", in lowercase, in every recipe.
// Tablespoon and teaspoon are always written "tbsp" and "tsp", in lowercase ("2 Tablespoons" → "2 tbsp")
function spellUnits(text){
  const f = abbr => (tok, w, dot, off, all) => dot && !/^\s*[a-z0-9(,;)]/.test(all.slice(off+tok.length)) ? abbr+"." : abbr;
  return String(text)
    .replace(/\b(tablespoons?|tbsps?|tbls?|tblsp|tbs)\b(\.)?/gi, f("tbsp"))
    .replace(/\b(teaspoons?|tsps?|tspn)\b(\.)?/gi, f("tsp"));
}
module.exports = async (db) => {
  const snap = await db.collection('recipes').get();
  const todo = []; let lines = 0;
  for (const d of snap.docs) {
    const r = d.data(); if (!Array.isArray(r.s)) continue;
    let changed = false;
    const s = r.s.map(sec => Object.assign({}, sec, {items: (sec.items || []).map(it => { const o = spellUnits(it); if (o !== it) { changed = true; lines++; } return o; })}));
    const upd = {s};
    if (r.n) { const n = spellUnits(r.n); if (n !== r.n) { upd.n = n; changed = true; } }
    if (changed) todo.push([d.ref, upd]);
  }
  for (let i = 0; i < todo.length; i += 400) {
    const batch = db.batch();
    todo.slice(i, i + 400).forEach(([ref, upd]) => batch.update(ref, upd));
    await batch.commit();
  }
  return `${lines} lines in ${todo.length} recipes now say tbsp / tsp`;
};
