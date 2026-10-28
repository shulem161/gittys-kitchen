// Automated end-to-end check of Gitty's Kitchen.
// Runs the real index.html against a stand-in for Firebase (tests/fake-firebase.js),
// so it never touches the real member list or recipes.
// Usage: node tests/run-all.js            (needs Playwright with Chromium)
const {chromium} = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firebase.js'), 'utf8');
const IMG = path.join(__dirname, 'sample-dish.jpg');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace(/\/\*FIREBASE\*\/\{[^}]*\}/, '/*FIREBASE*/{apiKey:"test"}');
const PAGE = path.join(os.tmpdir(), 'gk-test.html'); fs.writeFileSync(PAGE, html);
const F = 'file://' + PAGE;
let pass = 0, fail = 0; const errors = [];
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); } };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport: {width: 1100, height: 900}, acceptDownloads: true});
  await ctx.route(/gstatic\.com|fonts\.g/, r => r.fulfill({contentType: 'text/javascript', body: ''}));
  await ctx.route(/gstatic\.com\/firebasejs\/.*app-compat/, r => r.fulfill({contentType: 'text/javascript', body: FAKE}));
  // Stand-in for the AI recipe reader (Firebase AI Logic)
  await ctx.route(/firebasejs\/12\.\d+\.\d+\/firebase-app\.js/, r => r.fulfill({contentType: 'text/javascript', headers: {'access-control-allow-origin': '*'}, body: 'export function getApps(){return []} export function initializeApp(c,n){return {name:n}}'}));
  await ctx.route(/firebasejs\/12\.\d+\.\d+\/firebase-ai\.js/, r => r.fulfill({contentType: 'text/javascript', headers: {'access-control-allow-origin': '*'}, body: 'export class GoogleAIBackend{} export function getAI(){return {}} export function getGenerativeModel(){return {generateContent: async()=>({response:{text:()=>JSON.stringify({title:"Scanned Test Cake",category:"Cakes",from:"",note:"",parts:[{type:"ingredients",heading:"",items:["2 cups flour"]},{type:"method",heading:"",items:["Bake at 350°F"]}]})}})}}'}));
  await ctx.route(/version\.json/, r => r.fulfill({contentType: 'application/json', body: '{"web":"0","apk":0}'}));
  const notes = []; await ctx.route(/ntfy\.sh/, r => { notes.push(new URL(r.request().url()).searchParams.get('title')); r.fulfill({status: 200, body: '{}', headers: {'access-control-allow-origin': '*'}}); });
  const page = async () => { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message + ' @ ' + (e.stack||'').split('\n').slice(1,3).join(' | '))); await p.goto(F); await p.waitForTimeout(400); return p; };
  const join = async (p, name, pw) => { await p.click('[data-mode=create]'); await p.fill('#nm', name); await p.fill('#pw', pw); await p.fill('#pw2', pw); await p.click('.primary'); await p.waitForTimeout(600); };

  try {
    // Members and approval
    const A = await page(); await join(A, 'Shulem Schlesinger', 'admin123');
    ok('admin is let in right away', (await A.locator('.eyebrow').innerText()).includes('SHULEM'));
    ok('admin sees "put recipes online"', await A.locator('#importbtn').count() === 1);
    await A.click('#importbtn'); await A.waitForTimeout(900);
    const total = +(await A.locator('.stat b').first().innerText());
    ok('recipes go online', total > 100, total);
    const B = await page(); await join(B, 'Test Member', 'member1');
    ok('new member waits for approval', (await B.locator('h2').innerText()) === 'Waiting for approval');
    ok('admin is notified of join request', notes.some(n => /asked to join/.test(n)), notes);
    await A.goto(F + '#admin'); await A.waitForTimeout(400); await A.click('[data-act=approve]'); await A.waitForTimeout(700);
    ok('approved member gets in by themselves', (await B.locator('.eyebrow').innerText().catch(() => '')).includes('TEST MEMBER'));
    const C = await page();
    await C.fill('#nm', 'Test Member'); await C.fill('#pw', 'wrong1'); await C.click('.primary'); await C.waitForTimeout(400);
    ok('wrong password refused', /isn't right/.test(await C.locator('.err').innerText()));
    await C.click('[data-mode=create]'); await C.fill('#nm', 'test  member'); await C.fill('#pw', 'abcdef'); await C.fill('#pw2', 'abcdef'); await C.click('.primary'); await C.waitForTimeout(400);
    ok('duplicate name refused', /already taken/.test(await C.locator('.err').innerText()));

    // Admin recipe editing
    await A.goto(F + '#r-croissants'); await A.waitForTimeout(400); await A.click('text=Edit recipe'); await A.waitForTimeout(300);
    await A.fill('#ed-t', 'Croissants Test'); await A.click('text=Save changes'); await A.waitForTimeout(700);
    ok('admin edit saves', (await A.locator('h1').innerText()) === 'Croissants Test');
    await B.goto(F + '#r-croissants'); await B.waitForTimeout(500);
    ok('member sees admin edit', (await B.locator('h1').innerText()) === 'Croissants Test');

    // Member adds a recipe → admin approves
    await B.goto(F + '#new'); await B.waitForTimeout(300); await B.fill('#ed-t', 'Test Kugel');
    await B.locator('.sec-items').nth(0).fill('1 cup test'); await B.click('text=Send for approval'); await B.waitForTimeout(600);
    ok('member recipe waits', /Waiting for approval/.test(await B.locator('.mrow').first().innerText()));
    await A.goto(F + '#review'); await A.waitForTimeout(500); await A.locator('.sub-card', {hasText: 'Test Kugel'}).locator('[data-sact=approve]').click(); await A.waitForTimeout(800);
    await B.goto(F + '#mine'); await B.waitForTimeout(400);
    ok('member recipe approved', /Approved/.test(await B.locator('.mrow').first().innerText()));
    await B.goto(F + '#r-test-kugel'); await B.waitForTimeout(400);
    ok('recipe shows who added it', /Added by Test Member/.test(await B.locator('.byline').innerText().catch(() => '')));

    // Member suggests changes → admin approves
    await B.goto(F + '#edit-r-challah'); await B.waitForTimeout(300); await B.fill('#ed-n', 'Test note'); await B.click('text=Send for approval'); await B.waitForTimeout(600);
    await B.goto(F + '#r-challah'); await B.waitForTimeout(300);
    ok('suggested change not live before approval', await B.locator('text=Test note').count() === 0);
    await A.goto(F + '#review'); await A.waitForTimeout(500); await A.locator('.sub-card', {hasText: 'Challah'}).locator('[data-sact=approve]').click(); await A.waitForTimeout(800);
    await B.goto(F + '#r-challah'); await B.waitForTimeout(400);
    ok('suggested change live after approval', await B.locator('text=Test note').count() === 1);
    ok('recipe shows who changed it', /Changed by Test Member/.test(await B.locator('.byline').innerText().catch(() => '')));

    // Photos
    await B.goto(F + '#r-bobbys-challah'); await B.waitForTimeout(400); await B.setInputFiles('#ph-file', IMG); await B.waitForTimeout(1500);
    await B.click('#ph-send'); await B.waitForTimeout(700);
    ok('member photo waits', /Waiting for approval/.test(await B.locator('#ph-grid').innerText()));
    await A.goto(F + '#review'); await A.waitForTimeout(500); await A.click('[data-pact=ok]'); await A.waitForTimeout(800);
    await B.goto(F + '#c-bread'); await B.waitForTimeout(500);
    ok('approved photo shows on card', await B.locator('.rc.has-img').count() >= 1);
    await B.goto(F + '#r-challah'); await B.waitForTimeout(400);
    await B.setInputFiles('#ph-cam', IMG); await B.waitForTimeout(1200); await B.setInputFiles('#ph-file', [IMG, IMG]); await B.waitForTimeout(2000);
    ok('several dish photos can be added at once', await B.locator('#ph-pick .ph-thumb').count() === 3);
    await B.click('#ph-send'); await B.waitForTimeout(1500);
    ok('several dish photos wait for approval', await B.locator('.ph.wait').count() === 3);
    await B.goto(F + '#scan'); await B.waitForTimeout(300); await B.setInputFiles('#scan-file', [IMG, IMG]); await B.waitForTimeout(1500);
    ok('recipe can be scanned from several pages', await B.locator('.scan-pages .ph-thumb').count() === 2);

    // Download a recipe as PDF
    await B.goto(F + '#r-boston-cream-pie'); await B.waitForTimeout(400);
    const [dl] = await Promise.all([B.waitForEvent('download'), B.click('#dl')]);
    const pdfPath = path.join(os.tmpdir(), 'gk-test.pdf'); await dl.saveAs(pdfPath);
    ok('recipe downloads as a PDF', fs.readFileSync(pdfPath).slice(0, 5).toString() === '%PDF-' && /\.pdf$/.test(dl.suggestedFilename()), dl.suggestedFilename());

    // Scan a recipe from a photo (AI stand-in)
    await B.goto(F + '#scan'); await B.waitForTimeout(300); await B.setInputFiles('#scan-file', IMG); await B.waitForTimeout(1200); await B.click('#scan-read'); await B.waitForTimeout(2000);
    ok('scanned recipe fills the form', (await B.inputValue('#ed-t').catch(() => '')) === 'Scanned Test Cake');
    const txt = path.join(os.tmpdir(), 'gk-recipe.txt'); fs.writeFileSync(txt, 'Test Cake\n2 cups flour\nBake at 350 for an hour');
    await B.goto(F + '#c-cakes'); await B.waitForTimeout(300); await B.goto(F + '#scan'); await B.waitForTimeout(300); await B.setInputFiles('#scan-doc', txt); await B.waitForTimeout(2000);
    ok('recipe from a text file fills the form', (await B.inputValue('#ed-t').catch(() => '')) === 'Scanned Test Cake');

    // Whole cookbook download
    await B.goto(F); await B.waitForTimeout(400);
    const [bk] = await Promise.all([B.waitForEvent('download', {timeout: 120000}), B.click('#dl-book')]);
    const bookPath = path.join(os.tmpdir(), 'gk-book.pdf'); await bk.saveAs(bookPath);
    const bookBytes = fs.readFileSync(bookPath);
    ok('whole cookbook downloads as one PDF', bookBytes.slice(0, 5).toString() === '%PDF-' && (bookBytes.toString('latin1').match(/\/Type \/Page\b/g) || []).length > 100);

    // Suggestions & comments
    await B.goto(F + '#feedback'); await B.waitForTimeout(300); await B.fill('#fb-text', 'Test suggestion'); await B.click('text=Send'); await B.waitForTimeout(600);
    ok('member can send a suggestion', /Test suggestion/.test(await B.locator('.fb-item').first().innerText()));
    await A.goto(F + '#inbox'); await A.waitForTimeout(500);
    const fi = A.locator('.fb-item', {hasText: 'Test suggestion'}); await fi.locator('.fb-reply-in').fill('Thanks!'); await fi.locator('.fb-status').selectOption('done'); await fi.locator('[data-fbsave]').click(); await A.waitForTimeout(600);
    await B.goto(F + '#feedback'); await B.waitForTimeout(500);
    ok('member sees the reply', /Thanks!/.test(await B.locator('.fb-item').first().innerText()));

    // Favorites
    await B.goto(F + '#r-croissants'); await B.waitForTimeout(300); await B.click('#fav'); await B.waitForTimeout(300);
    await B.goto(F + '#favorites'); await B.waitForTimeout(300);
    ok('favorites work', await B.locator('.rc').count() === 1);

    // My profile
    await B.goto(F); await B.waitForTimeout(300); await B.click('#avbtn'); await B.click('.menu a.who'); await B.waitForTimeout(700);
    ok('menu opens my profile', /Test Member/.test(await B.locator('.prof-head').innerText()));
    const pst = (await B.locator('.pstat').allInnerTexts()).join(' | ');
    ok('profile shows my activity', /1\s+favorite\b/.test(pst) && /photos? shared/.test(pst) && !/…/.test(pst), pst);
    await B.fill('#pw-old', 'nope99'); await B.fill('#pw-new', 'member2'); await B.fill('#pw-new2', 'member2'); await B.click('#pwform .primary'); await B.waitForTimeout(400);
    ok('profile refuses wrong current password', /isn't right/.test(await B.locator('#pw-err').innerText()));
    await B.fill('#pw-old', 'member1'); await B.click('#pwform .primary'); await B.waitForTimeout(500);
    ok('member can change password', /Password changed/.test(await B.locator('#toast').innerText()));
    const P = await page(); await P.fill('#nm', 'Test Member'); await P.fill('#pw', 'member2'); await P.click('.primary'); await P.waitForTimeout(500);
    ok('new password works', (await P.locator('.eyebrow').innerText().catch(() => '')).includes('TEST MEMBER'));

    // Change name
    await B.goto(F + '#profile'); await B.waitForTimeout(500);
    await B.fill('#nm-new', 'shulem  schlesinger'); await B.click('#nameform .primary'); await B.waitForTimeout(500);
    ok("member can't take the admin's name", /already taken/.test(await B.locator('#nm-err').innerText()));
    await B.fill('#nm-new', 'Test Member Two'); await B.click('#nameform .primary'); await B.waitForTimeout(700);
    ok('member can change name', (await B.locator('.prof-head h2').innerText()) === 'Test Member Two');
    ok('admin is told about the new name', notes.some(n => /Test Member is now Test Member Two/.test(n)), notes.slice(-2));
    const R = await page(); await R.fill('#nm', 'Test Member'); await R.fill('#pw', 'member2'); await R.click('.primary'); await R.waitForTimeout(400);
    ok('old name no longer signs in', /no member/i.test(await R.locator('.err').innerText()));
    await R.fill('#nm', 'test member two'); await R.fill('#pw', 'member2'); await R.click('.primary'); await R.waitForTimeout(500);
    ok('new name signs in', (await R.locator('.eyebrow').innerText().catch(() => '')).includes('TEST MEMBER TWO'));
    // Admin renames themselves and stays admin
    await A.goto(F + '#profile'); await A.waitForTimeout(500);
    await A.fill('#nm-new', 'Shulem'); await A.click('#nameform .primary'); await A.waitForTimeout(800);
    ok('admin can change name', (await A.locator('.prof-head h2').innerText()) === 'Shulem');
    ok('admin stays admin after rename', await A.evaluate(() => isAdmin()) && /Admin/.test(await A.locator('.prof-head .hint').innerText()));
    await R.goto(F + '#feedback'); await R.waitForTimeout(500);
    ok('members see the new admin name', /^Shulem reads/.test(await R.locator('.section-head p').first().innerText()));
    await R.goto(F + '#profile'); await R.waitForTimeout(400); await R.fill('#nm-new', 'Shulem'); await R.click('#nameform .primary'); await R.waitForTimeout(500);
    ok("member can't take the admin's new name", /already taken/.test(await R.locator('#nm-err').innerText()));
    const Q = await page(); await Q.evaluate(() => localStorage.removeItem('gk-admin')); await Q.reload(); await Q.waitForTimeout(400);
    await Q.fill('#nm', 'shulem'); await Q.fill('#pw', 'admin123'); await Q.click('.primary'); await Q.waitForTimeout(800);
    ok('admin signs in with the new name on a new device and is still admin', await Q.evaluate(() => isAdmin()));

    // Reset codes and recovery codes
    const R0 = await R.evaluate(() => me);
    await A.goto(F + '#admin'); await A.waitForTimeout(500);
    await A.locator('.mrow', {hasText: 'Test Member Two'}).locator('[data-act=reset]').click(); await A.waitForTimeout(600);
    const rcode = await A.locator('.codebox b').first().innerText();
    ok('admin can make a reset code', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(rcode), rcode);
    const W = await page(); await W.click('[data-mode=forgot]'); await W.waitForTimeout(200);
    await W.fill('#nm', 'Test Member Two'); await W.fill('#code', 'AAAA-BBBB'); await W.fill('#pw', 'member3'); await W.fill('#pw2', 'member3'); await W.click('.primary'); await W.waitForTimeout(500);
    ok('wrong reset code refused', /doesn't match/.test(await W.locator('.err').innerText()));
    await W.fill('#code', rcode); await W.fill('#pw', 'member3'); await W.fill('#pw2', 'member3'); await W.click('.primary'); await W.waitForTimeout(1200);
    ok('reset code lets the member back in', (await W.locator('.eyebrow').innerText().catch(() => '')).includes('TEST MEMBER TWO'));
    ok('favorites survive a reset', await W.evaluate(() => favs().includes('r-croissants')));
    ok('admin is told about the reset', notes.some(n => /set a new password/.test(n)), notes.slice(-2));
    await A.waitForTimeout(800);
    await A.waitForTimeout(5000);
    ok('member list has no duplicate after reset', (await A.locator('.mwho b').allInnerTexts()).filter(x => /Test Member Two/.test(x)).length === 1, await A.locator('.mwho b').allInnerTexts());
    ok("member's messages follow them", await A.evaluate(o => Object.values(JSON.parse(localStorage.__fakedb).feedback).every(x => x.uid !== o), R0));
    await W.goto(F + '#profile'); await W.waitForTimeout(500); await W.click('#rc-make'); await W.waitForTimeout(600);
    const own = await W.locator('.codebox.big b').innerText();
    ok('member can make a recovery code', /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(own), own);
    const V = await page(); await V.click('[data-mode=forgot]'); await V.waitForTimeout(200);
    await V.fill('#nm', 'test member two'); await V.fill('#code', own); await V.fill('#pw', 'member4'); await V.fill('#pw2', 'member4'); await V.click('.primary'); await V.waitForTimeout(1200);
    ok('recovery code works', (await V.locator('.eyebrow').innerText().catch(() => '')).includes('TEST MEMBER TWO'));
    const V2 = await page(); await V2.click('[data-mode=forgot]'); await V2.fill('#nm', 'Test Member Two'); await V2.fill('#code', own); await V2.fill('#pw', 'member5'); await V2.fill('#pw2', 'member5'); await V2.click('.primary'); await V2.waitForTimeout(600);
    ok('a used code stops working', /doesn't match/.test(await V2.locator('.err').innerText()));

    // Linked recipes
    await A.goto(F + '#edit-r-croissants'); await A.waitForTimeout(500);
    await A.fill('#ed-pre-q', "bobby's challah"); await A.waitForTimeout(200); await A.locator('.pre-opt').first().click(); await A.waitForTimeout(200);
    await A.click('#edform .primary'); await A.waitForTimeout(800);
    ok('recipe shows Make first link', /Make first:\s*Bobby's Challah/.test(await A.locator('.links-box').innerText().catch(() => '')));
    await A.goto(F + '#r-bobbys-challah'); await A.waitForTimeout(500);
    ok('linked recipe shows Use it in', /Use it in:\s*Croissants/i.test(await A.locator('.links-box').innerText().catch(() => '')));

    // Meat / dairy colors
    await A.goto(F); await A.waitForTimeout(400);
    const tileBgs = await A.$$eval('.cat', els => [...new Set(els.map(e => getComputedStyle(e).backgroundColor))]);
    ok('main menu tiles are all the same gray', tileBgs.length === 1, tileBgs);
    await A.goto(F + '#c-meat'); await A.waitForTimeout(400);
    ok('meat recipes are red', await A.$$eval('.rc', els => els.length > 0 && els.every(e => e.classList.contains('k-meat'))));
    await A.goto(F + '#c-dairy'); await A.waitForTimeout(400);
    ok('dairy recipes are blue', await A.$$eval('.rc', els => els.length > 0 && els.every(e => e.classList.contains('k-dairy'))));
    await A.goto(F + '#c-cookies'); await A.waitForTimeout(400);
    const ck = await A.$$eval('.rc', els => els.map(e => e.className));
    ok('other recipes are gray', ck.filter(c => /k-other/.test(c)).length > ck.length * 0.8, ck.slice(0, 3));
    const bg = c => A.$eval('.rc.' + c, e => getComputedStyle(e).backgroundColor).catch(() => '');
    await A.goto(F + '#c-side-dish'); await A.waitForTimeout(400);
    const [bm, bo] = [await bg('k-meat'), await bg('k-other')];
    ok('red and gray really differ', bm && bo && bm !== bo, [bm, bo]);
    await A.goto(F + '#edit-r-bobbys-challah'); await A.waitForTimeout(500);
    await A.selectOption('#ed-k', 'dairy'); await A.click('#edform .primary'); await A.waitForTimeout(800);
    ok('admin can mark a recipe dairy', await A.$eval('.rhead', e => e.classList.contains('k-dairy')));

    // Search
    await V.goto(F); await V.waitForTimeout(300); await V.fill('#q', 'challah'); await V.waitForTimeout(300);
    ok('search finds recipes', await V.locator('.rc').count() >= 3);

    // Phone layout
    const M = await ctx.newPage(); await M.setViewportSize({width: 390, height: 844}); await M.goto(F); await M.waitForTimeout(500);
    ok('no sideways scrolling on phones', await M.evaluate(() => document.documentElement.scrollWidth) <= 390);

    // Offline first visit
    const off = await b.newContext(); await off.route(/gstatic|fonts\.g/, r => r.abort());
    const O = await off.newPage(); await O.goto(F); await O.waitForTimeout(500);
    ok('offline first visit explains itself', (await O.locator('h2').innerText()) === "You're offline");
  } catch (e) { fail++; console.log('FAIL test crashed:', e.message.split('\n')[0]); }

  ok('no JavaScript errors', errors.length === 0, errors);
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
