// Owner's request (3.87): customers (public members) may ask for recipes.
module.exports = async (db) => {
  const ref = db.doc('meta/public');
  const snap = await ref.get();
  const allow = Object.assign({}, (snap.exists && snap.data().allow) || {}, {requests: true});
  await ref.set({allow}, {merge: true});
  return 'Public members can request recipes';
};
