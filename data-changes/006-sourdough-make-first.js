// Use the new recipe links for the sourdough pair: the starter is "Make first" for the bread.
module.exports = async (db) => {
  const bread = db.collection('recipes').doc('r-rustic-sourdough-bread');
  const starter = await db.collection('recipes').doc('r-basic-sourdough-starter').get();
  const b = await bread.get();
  if (!b.exists || !starter.exists) return 'nothing changed: sourdough recipes not found';
  const pre = b.data().pre || [];
  if (pre.includes('r-basic-sourdough-starter')) return 'already linked';
  await bread.update({pre: [...pre, 'r-basic-sourdough-starter'], updated: Date.now()});
  return 'Rustic Sourdough Bread: Make first = Basic Sourdough Starter';
};
