// Owner's request (3.88): every member gets a permanent member number, in the order they joined (from 1001).
module.exports = async (db) => {
  const users = await db.collection('users').get();
  const docs = users.docs.filter(d => d.data().status === 'approved').sort((a, b) => (a.data().created || 0) - (b.data().created || 0));
  let next = Math.max(1001, ...users.docs.map(d => (+d.data().no || 0) + 1));
  let n = 0;
  for (const d of docs) {
    if (d.data().no) continue;
    await d.ref.update({no: next++}); n++;
  }
  await db.doc('meta/counter').set({next});
  return `${n} members got a number; the next one is ${next}`;
};
