// Owner's request (4.02): member numbers start from 1, not 1001 (1001 → 1, 1002 → 2, …).
module.exports = async (db) => {
  const users = await db.collection('users').get();
  const todo = users.docs.filter(d => (+d.data().no || 0) > 1000);
  for (const d of todo) await d.ref.update({no: d.data().no - 1000});
  const max = Math.max(0, ...users.docs.map(d => { const n = +d.data().no || 0; return n > 1000 ? n - 1000 : n; }));
  await db.doc('meta/counter').set({next: max + 1});
  return `${todo.length} member numbers now start from 1; the next one is ${max + 1}`;
};
