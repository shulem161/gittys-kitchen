// Owner's request: give every recipe a number. Recipes that already have one keep it; the rest are numbered
// by category (A to Z), then section, then name. New recipes get the next number from the app.
const SEC = ['', 'Family recipes', 'Cakes & Frostings', 'Fish', 'Soups & Accompaniments', 'Meat', 'Side Dishes, Vegetables & Salads', 'Kugel', 'Milchig', 'Drinks & Desserts', 'Miscellaneous'];
module.exports = async (db) => {
  const snap = await db.collection('recipes').get();
  let max = 0; const todo = [];
  snap.docs.forEach(d => { const v = d.data(); if (v.no) max = Math.max(max, v.no); else if (!v.deleted) todo.push({id: d.id, ...v}); });
  const cmp = (a, b) => a.localeCompare(b, undefined, {sensitivity: 'base', numeric: true});
  const name = r => String(r.t || '').replace(/^Untitled:\s*/, '').replace(/^[^A-Za-z0-9]+/, '');
  todo.sort((a, b) => cmp(a.c || '', b.c || '') || (SEC.indexOf(a.sec || '') - SEC.indexOf(b.sec || '')) || cmp(name(a), name(b)));
  for (let i = 0; i < todo.length; i += 400) {
    const batch = db.batch();
    todo.slice(i, i + 400).forEach((r, j) => batch.update(db.collection('recipes').doc(r.id), {no: max + i + j + 1}));
    await batch.commit();
  }
  return `numbered ${todo.length} recipes (${max + 1} to ${max + todo.length})`;
};
