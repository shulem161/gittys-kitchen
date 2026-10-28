// Owner's request (3.51): three portals. Everyone approved so far becomes an employee (what members could
// always do). Every recipe gets pub:true so public members see it until the owner hides it.
// Public members may do everything they're allowed by default; the owner changes it in Public portal settings.
module.exports = async (db) => {
  const owner = ((await db.doc('meta/admin').get()).data() || {}).uid;
  const users = await db.collection('users').where('status', '==', 'approved').get();
  const people = users.docs.filter(d => d.id !== owner && !d.data().role);
  const recipes = await db.collection('recipes').get();
  const recs = recipes.docs.filter(d => d.data().pub === undefined);
  const writes = [
    ...people.map(d => b => b.update(d.ref, {role: 'employee'})),
    ...recs.map(d => b => b.update(d.ref, {pub: true})),
  ];
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    writes.slice(i, i + 400).forEach(w => w(batch));
    await batch.commit();
  }
  const pub = db.doc('meta/public');
  if (!(await pub.get()).exists) {
    await pub.set({allow: {suggest: true, photos: true, requests: true, ai: true, feedback: true}, cats: {}});
  }
  return `${people.length} members are now employees; ${recs.length} recipes visible to public members`;
};
