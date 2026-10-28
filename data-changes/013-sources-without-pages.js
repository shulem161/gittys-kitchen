// Owner's request: every recipe credits where it comes from, without a page number
// ("The Haimishe Kitchen – Pesach Cookbook, page 22" → "The Haimishe Kitchen – Pesach Cookbook").
module.exports = async (db) => {
  const PAGE = /[,;·–-]?\s*\(?\b(?:pages?|pg\.?|pp?\.)\s*\d+(?:\s*[-–]\s*\d+)?\)?\s*$/i;
  const snap = await db.collection('recipes').get();
  const todo = snap.docs.filter(d => PAGE.test(d.data().by || ''));
  for (let i = 0; i < todo.length; i += 400) {
    const batch = db.batch();
    todo.slice(i, i + 400).forEach(d => batch.update(d.ref, {by: d.data().by.replace(PAGE, '').trim()}));
    await batch.commit();
  }
  return `removed the page number from ${todo.length} recipe sources`;
};
