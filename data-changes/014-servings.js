// Owner's request: every recipe shows how many it serves (or how much it makes).
// Taken from the recipe where it says ("Serves 4–6", "Makes 15 knishes"); otherwise estimated from the amounts.
// Only fills recipes that don't have one yet, so nothing typed in by hand is overwritten.
const fs = require('fs'), path = require('path');
module.exports = async (db) => {
  const map = JSON.parse(fs.readFileSync(path.join(__dirname, '014-servings.data.json'), 'utf8'));
  const snap = await db.collection('recipes').get();
  const todo = snap.docs.filter(d => map[d.id] && !d.data().serves);
  for (let i = 0; i < todo.length; i += 400) {
    const batch = db.batch();
    todo.slice(i, i + 400).forEach(d => batch.update(d.ref, {serves: map[d.id]}));
    await batch.commit();
  }
  const without = snap.docs.filter(d => !d.data().deleted && !map[d.id] && !d.data().serves).length;
  return `servings added to ${todo.length} recipes; ${without} other recipes show a guess by category until someone sets theirs`;
};
