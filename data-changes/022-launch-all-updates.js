// Owner's request (4.23, 5 Nov 2026): "have everything launched once you finish, and it should go to the other people."
// Approves every update in App & web updates for admins, employees and customers — except any the owner declined.
const KEYS = ['planconfirm', 'codepick', 'relstate', 'grconfirm', 'kbnav', 'upddecline', 'updpage', 'tabsearch', 'cbbrowse', 'nkhide', 'nk'];
module.exports = async (db) => {
  const ref = db.collection('meta').doc('features');
  const s = await ref.get(); const on = (s.exists && s.data().on) || {};
  const done = [], kept = [];
  for (const k of KEYS) { if (on[k] === 'declined') kept.push(k); else { if (on[k] !== true) done.push(k); on[k] = true; } }
  await ref.set({on, by: 'Shulem (asked Claude to launch everything)', at: Date.now()});
  return `Approved for everyone: ${done.join(', ') || 'nothing new'}` + (kept.length ? `. Left declined: ${kept.join(', ')}` : '');
};
