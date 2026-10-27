// Put Eggplant Spread back in Miscellaneous (requested by the owner, Oct 27 2026).
module.exports = async (db) => {
  const ref = db.collection('recipes').doc('r-eggplant-spread');
  const d = await ref.get();
  if (!d.exists) return 'Eggplant Spread is not online yet; nothing to move';
  if (d.data().c === 'Miscellaneous') return 'Eggplant Spread is already in Miscellaneous';
  await ref.update({c: 'Miscellaneous', updated: Date.now()});
  return 'moved Eggplant Spread back to Miscellaneous';
};
