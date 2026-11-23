// From the weekly check-up (2026-11-22), owner's request: every dish photo carries its recipe's public setting (pub),
// so customers can be given only the photos of public recipes (update "photopub", 4.89).
// A photo is public when its recipe is in the cookbook, not Private, and public (its own setting, or its category's).
module.exports = async (db) => {
  const pubDoc = await db.doc('meta/public').get();
  const cats = (pubDoc.exists && pubDoc.data().cats) || {};
  const recs = new Map((await db.collection('recipes').get()).docs.map(d => [d.id, d.data()]));
  const isPub = r => !!r && !r.deleted && !r.priv && (r.pub === undefined ? cats[r.c] !== false : !!r.pub);
  const photos = await db.collection('photos').select('recipeId', 'status', 'pub').get();
  const todo = photos.docs.filter(d => d.data().pub !== isPub(recs.get(d.data().recipeId)));
  for (let i = 0; i < todo.length; i += 400) {
    const batch = db.batch();
    todo.slice(i, i + 400).forEach(d => batch.update(d.ref, {pub: isPub(recs.get(d.data().recipeId))}));
    await batch.commit();
  }
  const pub = photos.docs.filter(d => isPub(recs.get(d.data().recipeId))).length;
  return `${photos.size} photos checked: ${pub} of public recipes, ${photos.size - pub} team only; ${todo.length} updated`;
};
