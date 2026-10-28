// Owner's request: category codes start at 001 too (A101 → A001, B101 → B001…). Pesach codes (LA001…) stay.
module.exports = async (db) => {
  const snap = await db.collection('recipes').get();
  const todo = snap.docs.map(d => [d.id, d.data().code]).filter(([, c]) => /^[A-Z]\d{3}$/.test(c || '') && +c.slice(1) >= 101);
  for (let i = 0; i < todo.length; i += 400) {
    const batch = db.batch();
    todo.slice(i, i + 400).forEach(([id, c]) => batch.update(db.collection('recipes').doc(id), {code: c[0] + String(+c.slice(1) - 100).padStart(3, '0')}));
    await batch.commit();
  }
  return `renumbered ${todo.length} recipe codes to start at 001`;
};
