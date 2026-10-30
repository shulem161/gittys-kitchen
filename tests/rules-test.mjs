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
const check = async (name, p) => { try { await p; pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '→', e.message.split('\n')[0]); console.log('::warning::FAIL ' + name + ' → ' + e.message.split('\n')[0].slice(0, 200)); } };

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
await check('a member can save their own settings', assertSucceeds(updateDoc(doc(G, 'users', 'gitty'), { prefs: { todoDays: 7 } })));
await check("…but can't sneak a role in with them", assertFails(updateDoc(doc(G, 'users', 'gitty'), { prefs: { todoDays: 3 }, role: 'admin' })));

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

// ---------- Roles: owner, admin, employee, public ----------
await env.clearFirestore();
await env.withSecurityRulesDisabled(async c => {
  const d = c.firestore();
  const u = (uid, name, status, role) => Promise.all([setDoc(doc(d, 'users', uid), Object.assign({ name, status, created: 1, favs: [] }, role ? { role } : {})), setDoc(doc(d, 'names', name.toLowerCase()), { uid, email: uid + '@x' })]);
  await setDoc(doc(d, 'meta', 'admin'), { uid: 'own', name: 'Shulem' });
  await u('own', 'Shulem', 'approved'); await u('adm', 'Adm', 'approved', 'admin'); await u('adm2', 'Adm Two', 'approved', 'admin');
  await u('emp', 'Emp', 'approved', 'employee'); await u('pub', 'Pub', 'approved', 'public');
  await u('ed', 'Ed', 'approved', 'employee'); await setDoc(doc(d, 'users', 'ed'), { perms: { edit: true, photos: false } }, { merge: true });
  await u('rev', 'Rev', 'approved', 'employee'); await setDoc(doc(d, 'users', 'rev'), { perms: { review: true, answer: true } }, { merge: true }); await u('norole', 'No Role', 'approved'); await u('wait', 'Wait', 'pending');
  await setDoc(doc(d, 'meta', 'public'), { allow: { requests: false, photos: false }, cats: {} });
  await setDoc(doc(d, 'recipes', 'r-pub'), { t: 'Shown', c: 'Cakes', pub: true });
  await setDoc(doc(d, 'recipes', 'r-hid'), { t: 'Hidden', c: 'Cakes', pub: false });
  await setDoc(doc(d, 'recipes', 'r-old'), { t: 'No setting', c: 'Cakes' });
  await setDoc(doc(d, 'feedback', 'f1'), { uid: 'pub', status: 'new', reply: '', text: 'Hi' });
});
const OWN = as('own'), ADM = as('adm'), EMP = as('emp'), PUB = as('pub'), NOR = as('norole');
const fs = await import('firebase/firestore');
await check('employee reads every recipe', assertSucceeds(getDoc(doc(EMP, 'recipes', 'r-hid'))));
await check('public member reads a shown recipe', assertSucceeds(getDoc(doc(PUB, 'recipes', 'r-pub'))));
await check("public member can't read a hidden recipe", assertFails(getDoc(doc(PUB, 'recipes', 'r-hid'))));
await check("public member can't read a recipe with no setting", assertFails(getDoc(doc(PUB, 'recipes', 'r-old'))));
await check('a profile with no role counts as public', assertFails(getDoc(doc(NOR, 'recipes', 'r-hid'))));
await check('public member can list shown recipes', assertSucceeds(fs.getDocs(fs.query(fs.collection(PUB, 'recipes'), fs.where('pub', '==', true)))));
await check("public member can't list all recipes", assertFails(fs.getDocs(fs.collection(PUB, 'recipes'))));
await check("employee can't edit recipes", assertFails(updateDoc(doc(EMP, 'recipes', 'r-pub'), { t: 'X' })));
await check('admin can edit recipes', assertSucceeds(updateDoc(doc(ADM, 'recipes', 'r-pub'), { t: 'Shown!' })));
await check('admin can hide a recipe from the public', assertSucceeds(updateDoc(doc(ADM, 'recipes', 'r-pub'), { pub: false })));
const sub = uid => ({ uid, status: 'pending', t: 'Idea', c: 'Cakes' });
await check('employee can suggest a recipe', assertSucceeds(setDoc(doc(EMP, 'submissions', 's1'), sub('emp'))));
// Per-person employee permissions
await check('employee can request', assertSucceeds(setDoc(doc(EMP, 'requests', 'q8'), rq('emp'))));
const ED = as('ed'), REV = as('rev');
await check('employee allowed to edit can edit a recipe', assertSucceeds(updateDoc(doc(ED, 'recipes', 'r-hid'), { t: 'Hidden, edited' })));
await check("…but can't show it to the public", assertFails(updateDoc(doc(ED, 'recipes', 'r-hid'), { pub: true })));
await check('…and can add a recipe that follows its category', assertSucceeds(setDoc(doc(ED, 'recipes', 'r-new'), { t: 'New', c: 'Cakes', pub: true })));
await check("…but not one that breaks its category's setting", assertFails(setDoc(doc(ED, 'recipes', 'r-new2'), { t: 'New', c: 'Cakes', pub: false })));
await check('an everyday permission can be switched off for one person', assertFails(setDoc(doc(ED, 'photos', 'p8'), { uid: 'ed', status: 'pending', img: 'x', thumb: 'x', recipeId: 'r-pub' })));
await check('…while other employees keep it', assertSucceeds(setDoc(doc(EMP, 'photos', 'p7'), { uid: 'emp', status: 'pending', img: 'x', thumb: 'x', recipeId: 'r-pub' })));
await check('employee allowed to approve sees all suggestions', assertSucceeds(getDoc(doc(REV, 'submissions', 's1'))));
await check('…and can approve one', assertSucceeds(updateDoc(doc(REV, 'submissions', 's1'), { status: 'approved' })));
await check('…and can approve a photo', assertSucceeds(updateDoc(doc(REV, 'photos', 'p7'), { status: 'approved' })));
await check('…and answer requests', assertSucceeds(updateDoc(doc(REV, 'requests', 'q8'), { status: 'done', reply: 'Added' })));
await check("…but can't read comments (not allowed)", assertFails(getDoc(doc(REV, 'feedback', 'f1'))));
await check("employee allowed to edit can't approve suggestions", assertFails(updateDoc(doc(ED, 'submissions', 's1'), { status: 'denied' })));
await check("employees can't grant themselves permissions", assertFails(updateDoc(doc(EMP, 'users', 'emp'), { perms: { edit: true } })));
await check('admin can grant one employee a permission', assertSucceeds(updateDoc(doc(ADM, 'users', 'emp'), { perms: { inbox: true } })));
await check('…and then that employee can read comments', assertSucceeds(getDoc(doc(EMP, 'feedback', 'f1'))));
// Duplicate recipes: only admins
await check('admin can mark recipes as not duplicates', assertSucceeds(setDoc(doc(ADM, 'meta', 'dupes'), { ignore: ['r-a|r-b'] })));
await check("employees can't see or change the duplicates list", assertFails(getDoc(doc(EMP, 'meta', 'dupes'))));
// Moving recipes between categories, and requests to go live
await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'users', 'ed'), { perms: { edit: false, move: true } }, { merge: true }); });
await check("employees can't move recipes themselves, even with the old move permission", assertFails(updateDoc(doc(ED, 'recipes', 'r-pub'), { c: 'Bread', sec: '', code: 'A099', history: [], updated: 1 })));
await check('…they ask an admin instead', assertSucceeds(setDoc(doc(ED, 'golive', 'mv1'), { uid: 'ed', byName: 'Ed', rid: 'r-pub', title: 'X', status: 'open', created: 1, kind: 'move', to: 'Cakes', sec: '', from: 'Bread' })));
await check("…but can't change anything else that way", assertFails(updateDoc(doc(ED, 'recipes', 'r-pub'), { c: 'Cakes', t: 'Renamed' })));
await check("an employee without that permission can't move recipes", assertFails(updateDoc(doc(EMP, 'recipes', 'r-pub'), { c: 'Cakes', code: 'B099' })));
const gl = uid => ({ uid, byName: 'X', rid: 'r-hid', title: 'Hidden', status: 'open', created: 1 });
await check('an employee can ask for a recipe to go live', assertSucceeds(setDoc(doc(EMP, 'golive', 'g1'), gl('emp'))));
await check("…not in someone else's name", assertFails(setDoc(doc(EMP, 'golive', 'g2'), gl('ed'))));
await check("public members can't ask", assertFails(setDoc(doc(PUB, 'golive', 'g3'), gl('pub'))));
await check("the employee can't approve it", assertFails(updateDoc(doc(EMP, 'golive', 'g1'), { status: 'approved' })));
await check('an admin can approve it', assertSucceeds(updateDoc(doc(ADM, 'golive', 'g1'), { status: 'approved' })));
// Calendars and menus: each person's own; menus can be shared
await check('a member can save their own calendar', assertSucceeds(setDoc(doc(EMP, 'plans', 'emp'), { days: { '2026-10-30': [{ k: 'a', meal: 'Supper', rid: 'r-pub', x: 1, done: false }] } })));
await check("nobody else can read someone's calendar", assertFails(getDoc(doc(PUB, 'plans', 'emp'))));
await check("…except an admin using Log in as", assertSucceeds(getDoc(doc(ADM, 'plans', 'emp'))));
const mn = (uid, shared) => ({ uid, ownerName: 'X', name: 'Friday night', items: [{ rid: 'r-pub', x: 1, course: 'Fish' }], shared, sharedNames: [] });
await check('a member can make a menu', assertSucceeds(setDoc(doc(EMP, 'menus', 'm1'), mn('emp', ['pub']))));
await check("can't make a menu in someone else's name", assertFails(setDoc(doc(EMP, 'menus', 'm2'), mn('pub', []))));
await check('the person it is shared with can read it', assertSucceeds(getDoc(doc(PUB, 'menus', 'm1'))));
await check('…and find it in a list of menus shared with them', assertSucceeds(fs.getDocs(fs.query(fs.collection(PUB, 'menus'), fs.where('shared', 'array-contains', 'pub')))));
await check("…but can't change it", assertFails(updateDoc(doc(PUB, 'menus', 'm1'), { name: 'Mine now' })));
await check("…or delete it", assertFails(deleteDoc(doc(PUB, 'menus', 'm1'))));
await check("someone it isn't shared with can't read it", assertFails(getDoc(doc(as('rev'), 'menus', 'm1'))));
await check("…or list all menus", assertFails(fs.getDocs(fs.collection(as('rev'), 'menus'))));
await check('the owner can change it', assertSucceeds(updateDoc(doc(EMP, 'menus', 'm1'), { name: 'Shabbos night' })));
await check("the owner can't hand it to someone else", assertFails(updateDoc(doc(EMP, 'menus', 'm1'), { uid: 'pub' })));
await check('the owner can delete it', assertSucceeds(deleteDoc(doc(EMP, 'menus', 'm1'))));
// Signing up with an email that must be confirmed
const S1 = env.authenticatedContext('s1', { email: 's1@x.com', email_verified: false }).firestore();
const S1ok = env.authenticatedContext('s1', { email: 's1@x.com', email_verified: true }).firestore();
const S2 = env.authenticatedContext('s2', { email: 's2@x.com', email_verified: false }).firestore();
await check('a new sign-up claims a name without storing the email there', assertSucceeds(setDoc(doc(S1, 'names', 'sara one'), { uid: 's1', email: '' })));
await check('…and saves a profile waiting for email confirmation', assertSucceeds(setDoc(doc(S1, 'users', 's1'), { name: 'Sara One', status: 'unverified', created: 1, favs: [], email: 's1@x.com' })));
await check("…with someone else's email: refused", assertFails(setDoc(doc(S1, 'users', 's1'), { name: 'Sara One', status: 'unverified', created: 1, favs: [], email: 'boss@x.com' })));
await setDoc(doc(S2, 'names', 'sara two'), { uid: 's2', email: '' }).catch(() => {});
await check("an unconfirmed email can't go straight to waiting for approval", assertFails(setDoc(doc(S2, 'users', 's2'), { name: 'Sara Two', status: 'pending', created: 1, favs: [], email: 's2@x.com' })));
await check("…or move there before the link is tapped", assertFails(updateDoc(doc(S1, 'users', 's1'), { status: 'pending' })));
await check('after the link is tapped it asks to join', assertSucceeds(updateDoc(doc(S1ok, 'users', 's1'), { status: 'pending' })));
await check("…but can't approve itself", assertFails(updateDoc(doc(S1ok, 'users', 's1'), { status: 'approved' })));
await env.withSecurityRulesDisabled(async c => { const d = c.firestore();
  await setDoc(doc(d, 'names', 'em one'), { uid: 'em1', email: 'mabc@gittys-kitchen.app' });
  await setDoc(doc(d, 'users', 'em1'), { name: 'Em One', status: 'approved', created: 1, favs: [] }); });
await check("others can't clear someone's sign-in on their name", assertFails(setDoc(doc(S2, 'names', 'em one'), { uid: 's2', email: '' })));
const GM = env.authenticatedContext('em1', { email: 'em1@x.com', email_verified: true }).firestore();
await check('a member who confirmed a new email saves it', assertSucceeds(updateDoc(doc(GM, 'users', 'em1'), { email: 'em1@x.com' })));
await check("…but not an email they didn't confirm", assertFails(updateDoc(doc(GM, 'users', 'em1'), { email: 'other@x.com' })));
await check('…and switches their name to email sign-in', assertSucceeds(setDoc(doc(GM, 'names', 'em one'), { uid: 'em1', email: '' })));
// Phone notices and who hears about recipe requests
await check('a member can turn on their own phone notices', assertSucceeds(setDoc(doc(EMP, 'notify', 'emp'), { topic: 'gk-0123456789abcdef0123' })));
await check("…not for someone else", assertFails(setDoc(doc(EMP, 'notify', 'adm'), { topic: 'gk-0123456789abcdef0123' })));
await check('a customer can read it to send a notice', assertSucceeds(getDoc(doc(PUB, 'notify', 'emp'))));
await check('the member can turn it off', assertSucceeds(deleteDoc(doc(EMP, 'notify', 'emp'))));
await check('admins set who hears about requests', assertSucceeds(setDoc(doc(ADM, 'meta', 'reqwatch'), { uids: ['adm', 'emp'] })));
await check("employees can't", assertFails(setDoc(doc(EMP, 'meta', 'reqwatch'), { uids: ['emp'] })));
await check('customers can read it', assertSucceeds(getDoc(doc(PUB, 'meta', 'reqwatch'))));
// Log in as: employees allowed to may look in as customers only
await setDoc(doc(PUB, 'plans', 'pub'), { days: {} });
await check("an employee can't look at a customer's profile unless allowed", assertFails(getDoc(doc(as('ed'), 'users', 'pub'))));
await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'users', 'ed'), { perms: { viewas: true } }, { merge: true }); });
await check("…once allowed, they can", assertSucceeds(getDoc(doc(as('ed'), 'users', 'pub'))));
await check("…and the customer's calendar", assertSucceeds(getDoc(doc(as('ed'), 'plans', 'pub'))));
await check("…but not another employee's profile", assertFails(getDoc(doc(as('ed'), 'users', 'emp'))));
await check("…or calendar", assertFails(getDoc(doc(as('ed'), 'plans', 'emp'))));
await check('admins keep the customer list for them', assertSucceeds(setDoc(doc(ADM, 'meta', 'customers'), { list: [{ uid: 'pub', name: 'Pub' }] })));
await check('…which they can read', assertSucceeds(getDoc(doc(as('ed'), 'meta', 'customers'))));
await check("…and other employees can't", assertFails(getDoc(doc(EMP, 'meta', 'customers'))));
// Member numbers never change
await check('an admin gives a member their number', assertSucceeds(updateDoc(doc(ADM, 'users', 'pub'), { no: 1005 })));
await check("…which nobody can change, not even the owner", assertFails(updateDoc(doc(OWN, 'users', 'pub'), { no: 1006 })));
await check("…or take away", assertFails(setDoc(doc(OWN, 'users', 'pub'), { name: 'Pub', status: 'approved', created: 1, favs: [] })));
await check("the member can't give themselves one", assertFails(updateDoc(doc(EMP, 'users', 'emp'), { no: 1001 })));
// Team messages: employees and admins only, and only the people in the conversation
const th = (by, members) => ({ by, lastBy: by, members, names: {}, to: 'admins', rid: 'r-pub', rtitle: 'X', subject: '', msgs: [{ by, name: 'X', text: 'Can you look at this?', at: 1 }], updated: 1, readAt: {}, done: false, created: 1 });
await check('an employee can write to the admins about a recipe', assertSucceeds(setDoc(doc(EMP, 'threads', 't1'), th('emp', ['emp', 'adm']))));
await check("…not in someone else's name", assertFails(setDoc(doc(EMP, 'threads', 't2'), th('adm', ['emp', 'adm']))));
await check("public members can't write team messages", assertFails(setDoc(doc(PUB, 'threads', 't3'), th('pub', ['pub', 'adm']))));
await check('the admin in it can read it', assertSucceeds(getDoc(doc(ADM, 'threads', 't1'))));
await check('…and find it in their list', assertSucceeds(fs.getDocs(fs.query(fs.collection(ADM, 'threads'), fs.where('members', 'array-contains', 'adm')))));
await check("an employee who isn't in it can't read it", assertFails(getDoc(doc(as('rev'), 'threads', 't1'))));
await check("public members can't read it", assertFails(getDoc(doc(PUB, 'threads', 't1'))));
await check('the admin can reply', assertSucceeds(updateDoc(doc(ADM, 'threads', 't1'), { msgs: [{ by: 'emp', text: 'a' }, { by: 'adm', text: 'b' }], lastBy: 'adm', updated: 2 })));
await check("…but can't reply in someone else's name", assertFails(updateDoc(doc(ADM, 'threads', 't1'), { lastBy: 'emp', updated: 3 })));
await check("nobody can add people or change the recipe", assertFails(updateDoc(doc(EMP, 'threads', 't1'), { members: ['emp', 'adm', 'pub'] })));
await check('the employee can mark it done', assertSucceeds(updateDoc(doc(EMP, 'threads', 't1'), { done: true })));
await check('employees can read the team list', assertSucceeds(getDoc(doc(EMP, 'meta', 'team'))));
await check("public members can't", assertFails(getDoc(doc(PUB, 'meta', 'team'))));
await check("employees can't change it", assertFails(setDoc(doc(EMP, 'meta', 'team'), { list: [] })));
await check('admins keep it up to date', assertSucceeds(setDoc(doc(ADM, 'meta', 'team'), { list: [{ uid: 'adm', name: 'A', role: 'admin' }] })));
// Employee settings for all employees
await check("employees can't change Employee settings", assertFails(setDoc(doc(EMP, 'meta', 'employees'), { allow: { edit: true } })));
await check('admin can change Employee settings', assertSucceeds(setDoc(doc(ADM, 'meta', 'employees'), { allow: { answer: true, photos: false } })));
await check('a setting for all employees gives everyone that permission', assertSucceeds(updateDoc(doc(EMP, 'requests', 'q8'), { reply: 'Done by an employee' })));
await check('switching an everyday permission off for all employees blocks it', assertFails(setDoc(doc(EMP, 'photos', 'p6'), { uid: 'emp', status: 'pending', img: 'x', thumb: 'x', recipeId: 'r-pub' })));
await check("one person's own permission beats Employee settings", (async () => {
  await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'users', 'rev'), { perms: { review: true, photos: true } }, { merge: true }); });
  await assertSucceeds(setDoc(doc(REV, 'photos', 'p5'), { uid: 'rev', status: 'pending', img: 'x', thumb: 'x', recipeId: 'r-pub' }));
})());
await check('public member can suggest (allowed)', assertSucceeds(setDoc(doc(PUB, 'submissions', 's2'), sub('pub'))));
await check("public member can't request (switched off)", assertFails(setDoc(doc(PUB, 'requests', 'q9'), rq('pub'))));
await check("public member can't send photos (switched off)", assertFails(setDoc(doc(PUB, 'photos', 'p9'), { uid: 'pub', status: 'pending', img: 'x', thumb: 'x', recipeId: 'r-pub' })));
await check("employee can't see others' suggestions", assertFails(getDoc(doc(EMP, 'submissions', 's2'))));
await check('admin sees all suggestions', assertSucceeds(getDoc(doc(ADM, 'submissions', 's2'))));
await check("members can't give themselves a role", assertFails(updateDoc(doc(EMP, 'users', 'emp'), { role: 'admin' })));
await check("public member can't become employee alone", assertFails(updateDoc(doc(PUB, 'users', 'pub'), { role: 'employee' })));
await check('admin can make a public member an employee', assertSucceeds(updateDoc(doc(ADM, 'users', 'pub'), { role: 'employee' })));
await check('admin can approve someone as public', assertSucceeds(updateDoc(doc(ADM, 'users', 'wait'), { status: 'approved', role: 'public' })));
await check("admin can't make anyone an admin", assertFails(updateDoc(doc(ADM, 'users', 'emp'), { role: 'admin' })));
await check("admin can't change another admin", assertFails(updateDoc(doc(ADM, 'users', 'adm2'), { role: 'employee' })));
await check("admin can't change the owner", assertFails(updateDoc(doc(ADM, 'users', 'own'), { status: 'denied' })));
await check("admin can't remove another admin", assertFails(deleteDoc(doc(ADM, 'users', 'adm2'))));
await check("admin can't remove the owner", assertFails(deleteDoc(doc(ADM, 'users', 'own'))));
await check("admin can't free the owner's name", assertFails(deleteDoc(doc(ADM, 'names', 'shulem'))));
await check("admin can't make a reset code for the owner", assertFails(setDoc(doc(ADM, 'resets', 'OWNERCODE1'), code('shulem', 'own', 'admin', now + DAY))));
await check("admin can't make a reset code for another admin", assertFails(setDoc(doc(ADM, 'resets', 'ADMTWOCODE'), code('adm two', 'adm2', 'admin', now + DAY))));
await check('admin can make a reset code for an employee', assertSucceeds(setDoc(doc(ADM, 'resets', 'EMPCODE12'), code('emp', 'emp', 'admin', now + DAY))));
await check("admin can't take over as owner", assertFails(setDoc(doc(ADM, 'meta', 'admin'), { uid: 'adm', name: 'Adm' })));
await check('admin can change public settings', assertSucceeds(setDoc(doc(ADM, 'meta', 'public'), { allow: { requests: true }, cats: { Cakes: false } })));
await check("employee can't change public settings", assertFails(setDoc(doc(EMP, 'meta', 'public'), { allow: {}, cats: {} })));
await check('admin can set the design for everyone', assertSucceeds(setDoc(doc(ADM, 'meta', 'look'), { look: 'garden', by: 'Adm', at: 1 })));
await check('owner can make an employee an admin', assertSucceeds(updateDoc(doc(OWN, 'users', 'emp'), { role: 'admin' })));
await check('owner can take admin away', assertSucceeds(updateDoc(doc(OWN, 'users', 'adm2'), { role: 'employee' })));
await check('owner can remove an admin', assertSucceeds(deleteDoc(doc(OWN, 'users', 'emp'))));
await check('a new admin has admin rights', assertSucceeds(getDoc(doc(as('adm'), 'users', 'pub'))));

await env.cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
console.log(`::notice::Rule checks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
