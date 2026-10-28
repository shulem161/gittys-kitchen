// Owner's request: add every recipe from "The Haimishe Kitchen – Pesach Cookbook" (Ladies Auxiliary of Nitra,
// Mt. Kisco, 1992) to the Pesach category, in sections like the book's chapters, each credited with its page.
// Ingredients as printed; steps written in our own words. Family notes written in the book are in each note.
const fs = require('fs'), path = require('path');
const BOOK = 'The Haimishe Kitchen – Pesach Cookbook';
module.exports = async (db) => {
  const list = JSON.parse(fs.readFileSync(path.join(__dirname, '008-haimishe-pesach.data.json'), 'utf8'));
  const now = Date.now(); let added = 0, skipped = 0;
  for (let i = 0; i < list.length; i += 400) {
    const batch = db.batch();
    for (const r of list.slice(i, i + 400)) {
      const ref = db.collection('recipes').doc(r.id);
      if ((await ref.get()).exists) { skipped++; continue; }
      batch.set(ref, {c: r.c, sec: r.sec, t: r.t, by: `${BOOK}, page ${r.p}`, n: r.n, s: r.s, kind: r.kind, pre: [], time: '',
        ord: now + i, deleted: false, updated: now, history: [{a: 'added', by: 'Shulem', at: now}]});
      added++;
    }
    await batch.commit();
  }
  return `added ${added} recipes from ${BOOK}${skipped ? `, ${skipped} were already there` : ''}`;
};
