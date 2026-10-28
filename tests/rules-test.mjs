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

await env.cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
console.log(`::notice::Rule checks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
