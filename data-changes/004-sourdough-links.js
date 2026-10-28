// Sourdough recipes: remove the book reference and link the two recipes to each other (owner's request).
module.exports = async (db) => {
  const now = Date.now(), out = [];
  const starter = db.collection('recipes').doc('r-basic-sourdough-starter');
  const bread = db.collection('recipes').doc('r-rustic-sourdough-bread');
  const s = await starter.get(), b = await bread.get();
  if (s.exists) {
    const d = s.data();
    await starter.update({
      n: 'Makes about 1 lb 10 oz (815 g). It takes about 2 weeks before the starter is strong enough for bread. Used in [[Rustic Sourdough Bread]].',
      updated: now, history: [...(d.history || []), {a: 'changed', by: 'Shulem Schlesinger', at: now}].slice(-12)
    });
    out.push('Basic Sourdough Starter');
  }
  if (b.exists) {
    const d = b.data();
    const s2 = (d.s || []).map(sec => sec.k === 'ing'
      ? Object.assign({}, sec, {items: sec.items.map(i => i.replace(/Basic Sourdough Starter(?!\]\])/, '[[Basic Sourdough Starter]]'))})
      : sec);
    await bread.update({
      s: s2,
      n: 'Makes about 3 round loaves (5 lb 9 oz / 2805 g of dough). You need the [[Basic Sourdough Starter]], refreshed 8–12 hours before. Variation: leave out the rye and whole wheat flour and use all bread flour (a European-style high-extraction flour if you can get it); you may need a little less water.',
      updated: now, history: [...(d.history || []), {a: 'changed', by: 'Shulem Schlesinger', at: now}].slice(-12)
    });
    out.push('Rustic Sourdough Bread');
  }
  return 'updated: ' + (out.join(', ') || 'nothing found');
};
