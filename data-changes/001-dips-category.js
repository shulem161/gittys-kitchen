// Move the dips out of Miscellaneous into a new "Dips" category (requested by the owner, Oct 27 2026).
const IDS = ['r-eggplant-dip', 'r-olive-dip', 'r-tomato-dip-1', 'r-tomato-dip-2', 'r-tomato-dip-3', 'r-eggplant-spread'];
module.exports = async (db) => {
  const snap = await db.collection('recipes').get();
  if (snap.empty) return 'recipes are not online yet; nothing to move (the app already lists these under Dips)';
  let moved = 0; const names = [];
  for (const d of snap.docs) {
    const r = d.data();
    if (r.deleted || r.c !== 'Miscellaneous') continue;
    if (IDS.includes(d.id) || /\bdips?\b/i.test(r.t || '')) {
      await d.ref.update({c: 'Dips', updated: Date.now()});
      moved++; names.push(r.t);
    }
  }
  return `moved ${moved} recipes to Dips: ${names.join(', ') || 'none'}`;
};
