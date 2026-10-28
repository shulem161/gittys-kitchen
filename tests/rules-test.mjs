// Checks firestore.rules in the Firestore emulator (no live data is touched).
// Run: npx firebase emulators:exec --only firestore --project demo-gk "node tests/rules-test.mjs"
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';

const env = await initializeTestEnvironment({
  projectId: 'demo-gk',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});
let pass = 0, fail = 0;
const check = async (name, p) => { try { await p; pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '→', e.message.split('\n')[0]); } };

await env.withSecurityRulesDisabled(async c => {
  const d = c.firestore();
  const user = (uid, name, status) => setDoc(doc(d, 'users', uid), { name, status, created: 1, favs: [] });
  await setDoc(doc(d, 'names', 'shulem schlesinger'), { uid: 'admin', email: 'a@x' }); await user('admin', 'Shulem Schlesinger', 'approved');
  await setDoc(doc(d, 'names', 'gitty'), { uid: 'gitty', email: 'g@x' }); await user('gitty', 'Gitty', 'approved');
  await setDoc(doc(d, 'names', 'malky klein'), { uid: 'malky', email: 'm@x' }); await user('malky', 'Malky Klein', 'approved');
  await setDoc(doc(d, 'names', 'new one'), { uid: 'newbie', email: 'n@x' }); await user('newbie', 'New One', 'pending');
});
const G = env.authenticatedContext('gitty').firestore();
const N = env.authenticatedContext('newbie').firestore();
const A = env.authenticatedContext('admin').firestore();

// Renaming the right way
await check('member can claim a free new name', assertSucceeds(setDoc(doc(G, 'names', 'gitty schlesinger'), { uid: 'gitty', email: 'g@x' })));
await check('member can change own name once the new name points to them', assertSucceeds(updateDoc(doc(G, 'users', 'gitty'), { name: 'Gitty Schlesinger', was: ['Gitty'] })));
await check('member can let go of the old name', assertSucceeds(deleteDoc(doc(G, 'names', 'gitty'))));
await check('member can change capital letters only', assertSucceeds(updateDoc(doc(G, 'users', 'gitty'), { name: 'gitty schlesinger' })));
await check('favorites still save', assertSucceeds(updateDoc(doc(G, 'users', 'gitty'), { favs: ['r-x'] })));

// Things that must be refused
await check("can't take another member's name", assertFails(setDoc(doc(G, 'names', 'malky klein'), { uid: 'gitty', email: 'g@x' })));
await check("can't switch to a name that points to someone else", assertFails(updateDoc(doc(G, 'users', 'gitty'), { name: 'Malky Klein' })));
await check("can't become the admin by name", assertFails(updateDoc(doc(G, 'users', 'gitty'), { name: 'Shulem Schlesinger' })));
await check("can't approve yourself while renaming", assertFails(updateDoc(doc(N, 'users', 'newbie'), { name: 'New One', status: 'approved' })));
await check("can't sneak a status change into a rename", assertFails(updateDoc(doc(G, 'users', 'gitty'), { name: 'gitty schlesinger', status: 'denied' })));
await check("a member waiting for approval can't rename", (async () => {
  await assertSucceeds(setDoc(doc(N, 'names', 'brand new'), { uid: 'newbie', email: 'n@x' }));
  await assertFails(updateDoc(doc(N, 'users', 'newbie'), { name: 'Brand New' }));
})());
await check("can't rename someone else", assertFails(updateDoc(doc(G, 'users', 'malky'), { name: 'Gitty Schlesinger' })));
await check('admin keeps admin rights', assertSucceeds(updateDoc(doc(A, 'users', 'malky'), { status: 'approved' })));
await check('admin still recognised by name', assertSucceeds(getDoc(doc(A, 'users', 'gitty'))));

// Admin by account (meta/admin), after the admin's rename to "Shulem"
const M = env.authenticatedContext('malky').firestore();
await check("members can't make themselves admin", assertFails(setDoc(doc(M, 'meta', 'admin'), { uid: 'malky', name: 'Malky' })));
await check('admin can save who the admin is', assertSucceeds(setDoc(doc(A, 'meta', 'admin'), { uid: 'admin', name: 'Shulem' })));
await check('anyone can see the admin name', assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'meta', 'admin'))));
await check("admin can't hand admin to someone else by mistake", assertFails(setDoc(doc(A, 'meta', 'admin'), { uid: 'malky', name: 'Malky' })));
await check('admin can claim the short name', assertSucceeds(setDoc(doc(A, 'names', 'shulem'), { uid: 'admin', email: 'a@x' })));
await check('admin can rename self', assertSucceeds(updateDoc(doc(A, 'users', 'admin'), { name: 'Shulem', was: ['Shulem Schlesinger'] })));
await check('admin keeps rights after rename', assertSucceeds(updateDoc(doc(A, 'users', 'malky'), { status: 'approved' })));
await check('admin still sees all members', assertSucceeds(getDoc(doc(A, 'users', 'malky'))));
await check('admin can still edit recipes', assertSucceeds(setDoc(doc(A, 'recipes', 'r-test'), { t: 'Test', c: 'Cakes' })));
await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'names', 'shulem schlesinger'), { uid: 'malky', email: 'm@x' }); });
await check('owning the old admin name no longer makes you admin', assertFails(setDoc(doc(M, 'recipes', 'r-test2'), { t: 'X', c: 'Cakes' })));
await check("members still can't edit recipes", assertFails(setDoc(doc(G, 'recipes', 'r-test3'), { t: 'X', c: 'Cakes' })));

// ---------- Password reset and recovery codes ----------
await env.clearFirestore();
const DAY = 86400000, now = Date.now();
await env.withSecurityRulesDisabled(async c => {
  const d = c.firestore();
  const u = (uid, name, status, extra) => Promise.all([setDoc(doc(d, 'users', uid), Object.assign({ name, status, created: 1, favs: ['r-a'] }, extra || {})), setDoc(doc(d, 'names', name.toLowerCase()), { uid, email: uid + '@x' })]);
  await setDoc(doc(d, 'meta', 'admin'), { uid: 'admin', name: 'Shulem' });
  await u('admin', 'Shulem', 'approved'); await u('rivky', 'Rivky', 'approved'); await u('other', 'Other', 'approved'); await u('pend', 'Pend', 'pending');
  await setDoc(doc(d, 'resets', 'OLDCODE2'), { key: 'other', uid: 'other', by: 'admin', created: 1, expires: 1 });
  await setDoc(doc(d, 'resets', 'ADMINSELFCODE'), { key: 'shulem', uid: 'admin', by: 'self', created: 1, expires: null });
  await setDoc(doc(d, 'resets', 'PENDCODE'), { key: 'pend', uid: 'pend', by: 'admin', created: 1, expires: now + DAY });
});
const as = uid => env.authenticatedContext(uid).firestore();
const AD = as('admin'), RV = as('rivky'), OT = as('other');
const code = (key, uid, by, expires) => ({ key, uid, by, created: now, expires });
await check('admin can make a reset code', assertSucceeds(setDoc(doc(AD, 'resets', 'ABCDEFGH'), code('rivky', 'rivky', 'admin', now + 2 * DAY))));
await check("admin code can't last more than 3 days", assertFails(setDoc(doc(AD, 'resets', 'LONGLONG'), code('rivky', 'rivky', 'admin', now + 10 * DAY))));
await check("admin code must match the member's name", assertFails(setDoc(doc(AD, 'resets', 'MISMATCH'), code('rivky', 'other', 'admin', now + DAY))));
await check("members can't make reset codes for others", assertFails(setDoc(doc(OT, 'resets', 'OTHERCODE'), code('rivky', 'rivky', 'admin', now + DAY))));
await check("members can't make recovery codes for others", assertFails(setDoc(doc(OT, 'resets', 'SELFFOROTHER'), code('rivky', 'rivky', 'self', null))));
await check('member can make own recovery code', assertSucceeds(setDoc(doc(RV, 'resets', 'RIVKYSELFCODE'), code('rivky', 'rivky', 'self', null))));
await check('recovery codes must be long', assertFails(setDoc(doc(RV, 'resets', 'SHORT123'), code('rivky', 'rivky', 'self', null))));
await check('member can note their recovery code', assertSucceeds(updateDoc(doc(RV, 'users', 'rivky'), { rc: 'RIVKYSELFCODE', rcAt: now })));
await check('a code can be checked by someone who knows it', assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'resets', 'ABCDEFGH'))));
await check("codes can't be listed", assertFails((await import('firebase/firestore')).getDocs((await import('firebase/firestore')).collection(env.unauthenticatedContext().firestore(), 'resets'))));
const R2 = as('rivky2');
await check('wrong code is refused', assertFails(setDoc(doc(R2, 'names', 'rivky'), { uid: 'rivky2', email: 'r2@x', code: 'WRONGCODE' })));
await check("another member's code is refused", assertFails(setDoc(doc(R2, 'names', 'rivky'), { uid: 'rivky2', email: 'r2@x', code: 'OLDCODE2' })));
await check('valid code moves the name to the new sign-in', assertSucceeds(setDoc(doc(R2, 'names', 'rivky'), { uid: 'rivky2', email: 'r2@x', code: 'ABCDEFGH' })));
await check('new sign-in can read the old profile', assertSucceeds(getDoc(doc(R2, 'users', 'rivky'))));
await check("someone else can't copy the profile", assertFails(setDoc(doc(as('x'), 'users', 'x'), { name: 'Rivky', status: 'approved', created: 1, favs: [], was: [], from: 'rivky' })));
await check('new sign-in copies the profile, still approved', assertSucceeds(setDoc(doc(R2, 'users', 'rivky2'), { name: 'Rivky', status: 'approved', created: 1, favs: ['r-a'], was: [], from: 'rivky' })));
await check('new sign-in removes the old profile', assertSucceeds(deleteDoc(doc(R2, 'users', 'rivky'))));
await check('new sign-in clears the used code', assertSucceeds(deleteDoc(doc(R2, 'resets', 'ABCDEFGH'))));
await check('old recovery code no longer works after a reset', assertFails(setDoc(doc(as('rivky3'), 'names', 'rivky'), { uid: 'rivky3', email: 'r3@x', code: 'RIVKYSELFCODE' })));
await check('expired code is refused', assertFails(setDoc(doc(as('other2'), 'names', 'other'), { uid: 'other2', email: 'o2@x', code: 'OLDCODE2' })));
const P2 = as('pend2');
await check('waiting member can use a code', assertSucceeds(setDoc(doc(P2, 'names', 'pend'), { uid: 'pend2', email: 'p2@x', code: 'PENDCODE' })));
await check("a reset can't approve someone", assertFails(setDoc(doc(P2, 'users', 'pend2'), { name: 'Pend', status: 'approved', created: 1, favs: [], was: [], from: 'pend' })));
await check('a reset keeps them waiting', assertSucceeds(setDoc(doc(P2, 'users', 'pend2'), { name: 'Pend', status: 'pending', created: 1, favs: [], was: [], from: 'pend' })));
const A2 = as('admin2');
await check('admin can use own recovery code', assertSucceeds(setDoc(doc(A2, 'names', 'shulem'), { uid: 'admin2', email: 'a2@x', code: 'ADMINSELFCODE' })));
await check('admin copies own profile', assertSucceeds(setDoc(doc(A2, 'users', 'admin2'), { name: 'Shulem', status: 'approved', created: 1, favs: [], was: [], from: 'admin' })));
await check("a random member can't take over admin", assertFails(setDoc(doc(OT, 'meta', 'admin'), { uid: 'other', name: 'Other' })));
await check('admin moves admin to the new sign-in', assertSucceeds(setDoc(doc(A2, 'meta', 'admin'), { uid: 'admin2', name: 'Shulem' })));
await check('admin has full rights on the new sign-in', assertSucceeds(updateDoc(doc(A2, 'users', 'other'), { status: 'approved' })));
await check('the old admin sign-in is no longer admin', assertFails(setDoc(doc(AD, 'recipes', 'r-z'), { t: 'X', c: 'Cakes' })));

// ---------- Recipe requests ----------
const rq = (uid, extra) => Object.assign({ uid, byName: 'X', items: [{ ask: 'kugel', found: [] }], text: 'kugel', photo: '', status: 'open', reply: '', recipeId: '', created: 1 }, extra || {});
await check('member can ask for a recipe', assertSucceeds(setDoc(doc(OT, 'requests', 'q1'), rq('other'))));
await check("can't ask in someone else's name", assertFails(setDoc(doc(OT, 'requests', 'q2'), rq('rivky2'))));
await check("can't send a request already answered", assertFails(setDoc(doc(OT, 'requests', 'q3'), rq('other', { status: 'done' }))));
await check("can't send a huge photo", assertFails(setDoc(doc(OT, 'requests', 'q4'), rq('other', { photo: 'x'.repeat(130000) }))));
await check("other members can't read it", assertFails(getDoc(doc(as('rivky2'), 'requests', 'q1'))));
await check('admin can read and answer it', assertSucceeds(updateDoc(doc(A2, 'requests', 'q1'), { status: 'done', reply: 'Added!' })));
await check("member can't mark it answered", assertFails(updateDoc(doc(OT, 'requests', 'q1'), { status: 'done' })));
await check('member can delete own request', assertSucceeds(deleteDoc(doc(OT, 'requests', 'q1'))));

await env.cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
console.log(`::notice::Rule checks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
