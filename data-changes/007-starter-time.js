// The sourdough starter takes about 2 weeks to become strong enough (its note says so);
// the automatic time estimate can't know that, so set it by hand.
module.exports = async (db) => {
  const ref = db.collection('recipes').doc('r-basic-sourdough-starter');
  const s = await ref.get();
  if (!s.exists) return 'nothing changed: starter not found';
  if (s.data().time) return 'already has a time: ' + s.data().time;
  await ref.update({time: 'About 2 weeks (a few minutes a day)', updated: Date.now()});
  return 'Basic Sourdough Starter: time set to about 2 weeks';
};
