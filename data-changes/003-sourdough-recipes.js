// Add two bread recipes from photos the owner sent (Oct 27 2026). Ingredients as printed;
// steps written in our own words. Added as the admin, so they're live right away.
const ing = (h, items) => ({k: 'ing', h, items});
const step = (h, items) => ({k: 'step', h, items});
const now = Date.now();
const RECIPES = {
  'r-basic-sourdough-starter': {
    c: 'Bread', t: 'Basic Sourdough Starter', by: '',
    n: 'Makes about 1 lb 10 oz (815 g). It takes about 2 weeks before the starter is strong enough for bread. From the book Professional Baking, page 155.',
    s: [
      ing('Stage 1', ['8 oz (250 g) warm water', '8 oz (250 g) whole rye flour']),
      ing('Stage 2', ['8 oz (250 g) bread flour', '1 lb (500 g) starter from stage 1']),
      ing('Stage 3', ['12 oz (375 g) bread flour', '6 oz (190 g) water', '8 oz (250 g) starter from stage 2']),
      ing('To refresh the starter', ['12 oz (375 g) bread flour', '6 oz (190 g) water', '8 oz (250 g) starter']),
      step('', [
        'Stage 1: Mix the warm water and rye flour in a stainless steel or plastic container. Cover and leave at room temperature for 2–3 days, until bubbly with a sour, fermented smell.',
        'Stage 2: Mix in the bread flour to make a stiff dough. Cover and leave for 1–2 days, until well fermented.',
        'Stage 3: Mix the bread flour and water with 8 oz of the stage 2 starter, and throw away the rest. Cover and leave for about a day, or longer, until it has grown by about half.',
        'Keep refreshing it the same way as stage 3 until it doubles within 8–12 hours. This takes about 2 weeks; then it is ready for bread.',
        'Refresh the starter at least once a day. If you can\'t, refresh it, let it ferment a few hours, then keep it covered in the refrigerator for up to 1 week. Bring it back to room temperature and refresh it at least once before baking.'
      ])
    ]
  },
  'r-rustic-sourdough-bread': {
    c: 'Bread', t: 'Rustic Sourdough Bread', by: '',
    n: 'Makes about 3 round loaves (5 lb 9 oz / 2805 g of dough). You need the Basic Sourdough Starter, refreshed 8–12 hours before. Variation: leave out the rye and whole wheat flour and use all bread flour (a European-style high-extraction flour if you can get it); you may need a little less water. From the book Professional Baking, page 158.',
    s: [
      ing('', ['2 lb 10 oz (1320 g) bread flour', '3 oz (90 g) whole wheat flour', '3 oz (90 g) dark rye flour', '1 lb 15 oz (975 g) water', '9½ oz (300 g) Basic Sourdough Starter, refreshed 8–12 hours earlier', '1 oz (30 g) salt']),
      step('Mixing', ['Mix all the flours with the water just until combined.', 'Let it rest for 30 minutes.', 'Add the starter and salt, and mix on low speed for 5–8 minutes.']),
      step('Rising', ['Let the dough rise at 75°F (24°C) until almost doubled, about 8 hours.']),
      step('Shaping', ['Divide into 1 lb 12 oz (900 g) pieces and shape into round loaves.', 'Let them rise until almost doubled, about 3–4 hours.']),
      step('Baking', ['Bake at 425°F (218°C) with steam for 40–45 minutes.'])
    ]
  }
};
module.exports = async (db) => {
  const done = [];
  for (const [id, r] of Object.entries(RECIPES)) {
    const ref = db.collection('recipes').doc(id);
    if ((await ref.get()).exists) { done.push(r.t + ' (already there)'); continue; }
    await ref.set(Object.assign({}, r, {ord: now, deleted: false, updated: now,
      history: [{a: 'added', by: 'Shulem Schlesinger', at: now}]}));
    done.push(r.t);
  }
  return 'added to Bread: ' + done.join(', ');
};
