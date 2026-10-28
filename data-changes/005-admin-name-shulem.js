// Owner's request: show the admin as "Shulem" instead of "Shulem Schlesinger".
// Admin rights move from the name to the account (meta/admin). The old name stays reserved
// for the admin, so signing in with either "Shulem" or "Shulem Schlesinger" works.
module.exports = async (db) => {
  const legacy = await db.doc('names/shulem schlesinger').get();
  if (!legacy.exists) return 'nothing changed: no admin name found';
  const {uid, email} = legacy.data();
  const meta = await db.doc('meta/admin').get();
  if (meta.exists && meta.data().uid !== uid) return 'nothing changed: meta/admin already points to another account';
  const short = db.doc('names/shulem');
  const s = await short.get();
  if (s.exists && s.data().uid !== uid) return 'nothing changed: the name "Shulem" belongs to another member';
  const userRef = db.doc('users/' + uid);
  const user = (await userRef.get()).data() || {};
  await db.doc('meta/admin').set({uid, name: 'Shulem'});
  if (!s.exists) await short.set({uid, email});
  const was = [...new Set([...(user.was || []), user.name || 'Shulem Schlesinger'])].filter(n => n !== 'Shulem');
  await userRef.update({name: 'Shulem', was});
  return `admin is now "Shulem" (was "${user.name}"); admin rights follow the account`;
};
