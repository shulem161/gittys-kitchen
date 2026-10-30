// Owner's request (3.99): recipe inboxes (Need to proofread → For approval → Ready to release).
// Every recipe now in the cookbook goes into Need to proofread, staying visible to whoever sees it now.
// What was already waiting for approval goes into For approval.
module.exports = async (db) => {
  const recipes = await db.collection('recipes').get();
  const recs = recipes.docs.filter(d => !d.data().deleted && !d.data().rv);
  const subs = await db.collection('submissions').where('status', '==', 'pending').get();
  const waiting = subs.docs.filter(d => !d.data().stage);
  const writes = [...recs.map(d => b => b.update(d.ref, {rv: 'proof', rvAt: Date.now()})), ...waiting.map(d => b => b.update(d.ref, {stage: 'approve'}))];
  for (let i = 0; i < writes.length; i += 400) { const batch = db.batch(); writes.slice(i, i + 400).forEach(w => w(batch)); await batch.commit(); }
  return `${recs.length} recipes are in Need to proofread; ${waiting.length} waiting recipes are in For approval`;
};
