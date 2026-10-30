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
  // Stand-in for Google's "I'm not a robot" box
  await ctx.route(/google\.com\/recaptcha/, r => r.fulfill({contentType: 'text/javascript', body: 'window.grecaptcha={render(el,o){const b=document.createElement("button");b.type="button";b.id="fake-robot";b.textContent="I am not a robot";b.onclick=()=>o.callback("tok");el.appendChild(b);return 1}};window.gkRobot&&gkRobot();'}));
  // Stand-in for the AI recipe reader (Firebase AI Logic)
  await ctx.route(/firebasejs\/12\.\d+\.\d+\/firebase-app\.js/, r => r.fulfill({contentType: 'text/javascript', headers: {'access-control-allow-origin': '*'}, body: 'export function getApps(){return []} export function initializeApp(c,n){return {name:n}}'}));
  await ctx.route(/firebasejs\/12\.\d+\.\d+\/firebase-ai\.js/, r => r.fulfill({contentType: 'text/javascript', headers: {'access-control-allow-origin': '*'}, body: 'export class GoogleAIBackend{} export function getAI(){return {}} export function getGenerativeModel(){return {generateContent: async()=>({response:{text:()=>JSON.stringify({title:"Scanned Test Cake",category:"Cakes",from:"",note:"",parts:[{type:"ingredients",heading:"",items:["2 cups flour"]},{type:"method",heading:"",items:["Bake at 350°F"]}]})}})}}'}));
  await ctx.route(/version\.json/, r => r.fulfill({contentType: 'application/json', body: '{"web":"0","apk":0}'}));
  const notes = [], ntfyPaths = []; await ctx.route(/ntfy\.sh/, r => { notes.push(new URL(r.request().url()).searchParams.get('title')); ntfyPaths.push(new URL(r.request().url()).pathname); r.fulfill({status: 200, body: '{}', headers: {'access-control-allow-origin': '*'}}); });
  const page = async () => { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message + ' @ ' + (e.stack||'').split('\n').slice(1,3).join(' | '))); await p.goto(F); await p.waitForTimeout(400); return p; };
  const mailOf = name => name.toLowerCase().replace(/\s+/g, '.') + '@example.com';
  // Sign up with name, email and password, then tap the link in the (stand-in) email
  const join = async (p, name, pw, noConfirm) => { await p.click('[data-mode=create]'); await p.fill('#nm', name); await p.fill('#em', mailOf(name)); await p.fill('#pw', pw); await p.fill('#pw2', pw); await p.click('#fake-robot').catch(() => {}); await p.click('.primary'); await p.waitForTimeout(600);
    if (!noConfirm && await p.locator('#ev-check').count()) { await p.evaluate(() => __fakeVerify()); await p.click('#ev-check'); await p.waitForTimeout(600); } };

  try {
    // Members and approval
    const A = await page(); await join(A, 'Shulem Schlesinger', 'admin123');
    ok('admin is let in right away', (await A.locator('.eyebrow').innerText()).includes('SHULEM'));
    ok('admin sees "put recipes online"', await A.locator('#importbtn').count() === 1);
    await A.click('#importbtn'); await A.waitForTimeout(900);
    await A.goto(F + '#categories'); await A.waitForTimeout(300);
    const total = parseInt(await A.locator('.section-head p').first().innerText());
    ok('recipes go online', total > 100, total);
    const B0 = await page(); await B0.click('[data-mode=create]'); await B0.fill('#nm', 'Test Member'); await B0.fill('#pw', 'member1'); await B0.fill('#pw2', 'member1'); await B0.click('.primary'); await B0.waitForTimeout(300);
    ok('signing up needs an email', /email address/.test(await B0.locator('.err').innerText()) && (await B0.locator('#nm').inputValue()) === 'Test Member');
    await B0.fill('#em', 'robot@example.com'); await B0.fill('#pw', 'member1'); await B0.fill('#pw2', 'member1'); await B0.click('.primary'); await B0.waitForTimeout(300);
    ok("…and the “I'm not a robot” tick", /not a robot/.test(await B0.locator('.err').innerText()) && (await B0.locator('#fake-robot').count()) === 1);
    await B0.close();
    const B = await page(); await join(B, 'Test Member', 'member1', true);
    ok('a new member is asked to confirm their email first', (await B.locator('h2').innerText()) === 'Confirm your email' && await B.evaluate(() => __fakeMails().some(m => m.to === 'test.member@example.com' && m.kind === 'verify')));
    await A.goto(F + '#admin'); await A.waitForTimeout(500);
    ok("…and the admin isn't asked yet", !notes.some(n => /asked to join/.test(n)) && (await A.locator('[data-act=approve]').count()) === 0 && /Haven't confirmed/.test(await A.locator('.admin').innerText()));
    await B.click('#ev-check'); await B.waitForTimeout(500);
    ok("tapping “I tapped the link” too early says so", (await B.locator('h2').innerText()) === 'Confirm your email');
    await B.evaluate(() => __fakeVerify()); await B.click('#ev-check'); await B.waitForTimeout(700);
    ok('once confirmed, the member waits for approval', (await B.locator('h2').innerText()) === 'Waiting for approval');
    ok('admin is notified of join request', notes.some(n => /asked to join/.test(n)), notes);
    ok('admins see the email on the member list', /test\.member@example\.com/.test(await A.locator('.admin').innerText()));
    await A.goto(F + '#admin'); await A.waitForTimeout(400); await A.click('[data-act=approve]'); await A.waitForTimeout(700);
    ok('a newly approved member starts as public', await B.evaluate(() => myRole()) === 'public');
    await A.locator('.mrow', {hasText: 'Test Member'}).locator('[data-role]').selectOption('employee'); await A.waitForTimeout(1500);
    ok('an admin moves them up to employee by hand', await B.evaluate(() => myRole()) === 'employee');
    ok('approved member gets in by themselves', (await B.locator('.eyebrow').innerText().catch(() => '')).includes('TEST MEMBER'));
    const C = await page();
    await C.fill('#nm', 'Test Member'); await C.fill('#pw', 'wrong1'); await C.click('.primary'); await C.waitForTimeout(400);
    ok('a new profile signing in by name is told to use the email', /Type your email/.test(await C.locator('.err').innerText()));
    await C.fill('#nm', 'test.member@example.com'); await C.fill('#pw', 'wrong1'); await C.click('.primary'); await C.waitForTimeout(400);
    ok('wrong password refused', /isn't right/.test(await C.locator('.err').innerText()));
    await C.click('[data-mode=create]'); await C.fill('#nm', 'Someone Else'); await C.fill('#em', 'test.member@example.com'); await C.fill('#pw', 'abcdef'); await C.fill('#pw2', 'abcdef'); await C.click('#fake-robot'); await C.click('.primary'); await C.waitForTimeout(400);
    ok('an email can only be on one profile', /already has a profile/.test(await C.locator('.err').innerText()));
    await C.goto(F); await C.waitForTimeout(300);
    await C.click('[data-mode=create]'); await C.fill('#nm', 'test  member'); await C.fill('#em', 'tm2@example.com'); await C.fill('#pw', 'abcdef'); await C.fill('#pw2', 'abcdef'); await C.click('#fake-robot'); await C.click('.primary'); await C.waitForTimeout(400);
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
    await A.goto(F + '#r-test-kugel'); await A.waitForTimeout(400);
    ok('admin sees who added it', /Added by Test Member/.test(await A.locator('.byline').innerText().catch(() => '')));

    // Member suggests changes → admin approves
    await B.goto(F + '#edit-r-challah'); await B.waitForTimeout(300); await B.fill('#ed-n', 'Test note'); await B.click('text=Send for approval'); await B.waitForTimeout(600);
    await B.goto(F + '#r-challah'); await B.waitForTimeout(300);
    ok('suggested change not live before approval', await B.locator('text=Test note').count() === 0);
    await A.goto(F + '#review'); await A.waitForTimeout(500); await A.locator('.sub-card', {hasText: 'Challah'}).locator('[data-sact=approve]').click(); await A.waitForTimeout(800);
    await B.goto(F + '#r-challah'); await B.waitForTimeout(400);
    ok('suggested change live after approval', await B.locator('text=Test note').count() === 1);
    await A.goto(F + '#r-challah'); await A.waitForTimeout(400);
    ok('admin sees who changed it', /Changed by Test Member/.test(await A.locator('.byline').innerText().catch(() => '')));

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
    ok('download goes straight to a PDF, no design choice', (await B.locator('#dlpick').count()) === 0);
    const pdfPath = path.join(os.tmpdir(), 'gk-test.pdf'); await dl.saveAs(pdfPath);
    ok('recipe downloads as a PDF', fs.readFileSync(pdfPath).slice(0, 5).toString() === '%PDF-' && /\.pdf$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    ok("downloads never say who added or changed a recipe", !/(Added|Changed) by/.test(fs.readFileSync(pdfPath).toString('latin1')));
    ok('every download uses the Recipe card design', await B.evaluate(() => { store('gk-pdfstyle', 'large'); return pdfStyleKey() === 'card'; }));

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
    ok('profile links to Account settings and Website settings', (await B.locator('.set-links a[href="#account"]').count()) === 1 && (await B.locator('.set-links a[href="#settings-look"]').count()) === 1);
    await B.click('#avbtn'); await B.waitForTimeout(200);
    ok('the menu has a Settings drop-down, closed at first', (await B.locator('.menu details[data-mg=settings]:not([open])').count()) === 1);
    await B.click('.menu details[data-mg=settings] summary'); await B.waitForTimeout(200);
    const mt2 = await B.locator('.menu details[data-mg=settings]').innerText();
    ok('…with Account settings and Website settings inside', /Account settings/.test(mt2) && /Website settings/.test(mt2));
    await B.click('.menu a[href="#account"]'); await B.waitForTimeout(500);
    ok('Account settings has name, email, password and recovery code', (await B.locator('#nameform').count()) === 1 && (await B.locator('#emform').count()) === 1 && (await B.locator('#pwform').count()) === 1 && (await B.locator('#rcpanel').count()) === 1 && (await B.locator('.pstat').count()) === 0);
    await B.fill('#pw-old', 'nope99'); await B.fill('#pw-new', 'member2'); await B.fill('#pw-new2', 'member2'); await B.click('#pwform .primary'); await B.waitForTimeout(400);
    ok('profile refuses wrong current password', /isn't right/.test(await B.locator('#pw-err').innerText()));
    await B.fill('#pw-old', 'member1'); await B.click('#pwform .primary'); await B.waitForTimeout(500);
    ok('member can change password', /Password changed/.test(await B.locator('#toast').innerText()));
    const P = await page(); await P.fill('#nm', 'test.member@example.com'); await P.fill('#pw', 'member2'); await P.click('.primary'); await P.waitForTimeout(500);
    ok('new password works', (await P.locator('.eyebrow').innerText().catch(() => '')).includes('TEST MEMBER'));

    // Change name
    await B.goto(F + '#account'); await B.waitForTimeout(500);
    await B.fill('#nm-new', 'shulem  schlesinger'); await B.click('#nameform .primary'); await B.waitForTimeout(500);
    ok("member can't take the admin's name", /already taken/.test(await B.locator('#nm-err').innerText()));
    await B.fill('#nm-new', 'Test Member Two'); await B.click('#nameform .primary'); await B.waitForTimeout(700);
    ok('member can change name', await B.evaluate(() => myName()) === 'Test Member Two' && /Test Member Two/.test(await B.locator('.section-head p').innerText()));
    ok('admin is told about the new name', notes.some(n => /Test Member is now Test Member Two/.test(n)), notes.slice(-2));
    const R = await page(); await R.fill('#nm', 'Test Member'); await R.fill('#pw', 'member2'); await R.click('.primary'); await R.waitForTimeout(400);
    ok('old name no longer signs in', /no member/i.test(await R.locator('.err').innerText()));
    await R.fill('#nm', 'test member two'); await R.fill('#pw', 'member2'); await R.click('.primary'); await R.waitForTimeout(500);
    ok('the new name points to the profile (which signs in with its email)', /Type your email/.test(await R.locator('.err').innerText()));
    await R.fill('#nm', 'test.member@example.com'); await R.fill('#pw', 'member2'); await R.click('.primary'); await R.waitForTimeout(500);
    ok('new name shows after signing in', (await R.locator('.eyebrow').innerText().catch(() => '')).includes('TEST MEMBER TWO'));
    // Admin renames themselves and stays admin
    await A.goto(F + '#account'); await A.waitForTimeout(500);
    await A.fill('#nm-new', 'Shulem'); await A.click('#nameform .primary'); await A.waitForTimeout(800);
    ok('admin can change name', await A.evaluate(() => myName()) === 'Shulem');
    ok('admin stays admin after rename', await A.evaluate(() => isAdmin()) && /Owner/.test(await A.locator('.section-head p').innerText()));
    await R.goto(F + '#feedback'); await R.waitForTimeout(500);
    ok('members see the new admin name', /^Shulem reads/.test(await R.locator('.section-head p').first().innerText()));
    await R.goto(F + '#account'); await R.waitForTimeout(400); await R.fill('#nm-new', 'Shulem'); await R.click('#nameform .primary'); await R.waitForTimeout(500);
    ok("member can't take the admin's new name", /already taken/.test(await R.locator('#nm-err').innerText()));
    const Q = await page(); await Q.evaluate(() => localStorage.removeItem('gk-admin')); await Q.reload(); await Q.waitForTimeout(400);
    await Q.fill('#nm', 'shulem.schlesinger@example.com'); await Q.fill('#pw', 'admin123'); await Q.click('.primary'); await Q.waitForTimeout(800);
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
    ok('member list has no duplicate after reset', (await A.locator('.mwho b').allInnerTexts()).filter(x => /Test Member Two/.test(x)).length === 1, [await A.locator('.mwho b').allInnerTexts(), await A.evaluate(() => members.map(m => [m.uid, m.name, m.from, m.moved, m.status].join(':')))]);
    ok("member's messages follow them", await A.evaluate(o => Object.values(__fakeDB().feedback).every(x => x.uid !== o), R0));
    await W.goto(F); await W.waitForTimeout(500);
    ok('members from before emails are invited (not made) to add one', (await W.locator('#enudge').count()) === 1 && (await B.evaluate(() => document.querySelectorAll('#enudge').length)) === 0);
    await W.click('#en-add'); await W.waitForTimeout(600);
    ok('“Add email” opens the email box in Account settings', /#account/.test(await W.evaluate(() => location.hash)) && await W.evaluate(() => document.activeElement && document.activeElement.id === 'em-new'));
    await W.goto(F); await W.waitForTimeout(400); await W.click('#en-no'); await W.waitForTimeout(200); await W.reload(); await W.waitForTimeout(600);
    ok('“Not now” hides the invitation', (await W.locator('#enudge').count()) === 0);
    await W.goto(F + '#settings-look'); await W.waitForTimeout(500);
    await W.click('#app [data-theme=dark]'); await W.waitForTimeout(200);
    const darkBg = await W.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]);
    await W.click('#app [data-theme=light]'); await W.waitForTimeout(200);
    ok('Settings can switch to a dark or light screen', darkBg[0] === 'dark' && darkBg[1] !== await W.evaluate(() => getComputedStyle(document.body).backgroundColor) && await W.evaluate(() => document.documentElement.dataset.theme === 'light'), darkBg);
    await W.click('#app [data-theme=auto]'); await W.waitForTimeout(200);
    await W.click('#app [data-tsize="1.25"]'); await W.waitForTimeout(200);
    ok('Settings can make the text bigger', await W.evaluate(() => getComputedStyle(app).zoom === '1.25'));
    await W.setViewportSize({width: 390, height: 844}); await W.goto(F + '#r-croissants'); await W.waitForTimeout(400);
    ok('…without sideways scrolling on a phone', await W.evaluate(() => document.documentElement.scrollWidth) <= 392);
    await W.goto(F + '#settings-look'); await W.waitForTimeout(300); await W.click('#app [data-tsize="1"]'); await W.waitForTimeout(200); await W.setViewportSize({width: 1100, height: 900});
    ok('Settings shows the website link and a full Android app download', await W.evaluate(() => /github\.io\/gittys-kitchen/.test(document.querySelector('.set-url a').href) && /Gittys-Kitchen\.apk$/.test(document.getElementById('set-apk').href)));
    ok('Website settings is titled for the website', /Website settings/.test(await W.evaluate(() => LOOK_SET())));
    await W.goto(F + '#account'); await W.waitForTimeout(500);
    ok('a profile without an email can add one', /Add your email/.test(await W.locator('.admin').innerText()));
    await W.fill('#em-new', 'tm.two@example.com'); await W.fill('#em-pw', 'member3'); await W.click('#emform .primary'); await W.waitForTimeout(500);
    ok('…by tapping a link sent to it', /We sent a link/.test(await W.locator('#em-ok').innerText()) && await W.evaluate(() => __fakeMails().some(m => m.to === 'tm.two@example.com' && m.kind === 'change')));
    const FE = await page(); await FE.click('[data-mode=forgot]'); await FE.waitForTimeout(200); await FE.fill('#fe', 'test.member@example.com'); await FE.click('#fe-send'); await FE.waitForTimeout(400);
    ok('Forgot password emails a link', /on its way/.test(await FE.locator('#fe-msg').innerText()));
    await FE.close();
    await W.click('#rc-make'); await W.waitForTimeout(600);
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
    await A.click('#edform .primary'); await A.waitForTimeout(1500);
    ok('recipe shows Make first link', /Make first:\s*Bobby's Challah/.test(await A.locator('.links-box').innerText().catch(() => '')), [await A.evaluate(() => location.hash), await A.locator('#ed-err').innerText().catch(() => ''), await A.locator('main h1, main h2').first().innerText().catch(() => '')]);
    await A.goto(F + '#r-bobbys-challah'); await A.waitForTimeout(500);
    ok('linked recipe shows Use it in', /Use it in:\s*Croissants/i.test(await A.locator('.links-box').innerText().catch(() => '')));

    // Meat / Dairy labels (cookbook stays blue)
    await A.goto(F + '#c-meat'); await A.waitForTimeout(400);
    ok('meat recipes say Meat', await A.$$eval('.rc', els => els.length > 0 && els.every(e => /\bMeat\b/i.test(e.querySelector('.kchip')?.textContent || ''))));
    await A.goto(F + '#c-dairy'); await A.waitForTimeout(400);
    ok('dairy recipes say Dairy', await A.$$eval('.rc', els => els.length > 0 && els.every(e => /\bDairy\b/i.test(e.querySelector('.kchip')?.textContent || ''))));
    await A.goto(F + '#r-chicken-soup'); await A.waitForTimeout(400);
    ok('Chicken Soup page says Meat', /meat/i.test(await A.locator('.rhead .kchip').innerText().catch(() => '')));
    await A.goto(F + '#c-cookies'); await A.waitForTimeout(400);
    ok('plain recipes have no label', await A.locator('.rc .kchip').count() === 0);
    const cardBgs = await A.$$eval('.rc', els => [...new Set(els.map(e => getComputedStyle(e).backgroundColor))]);
    ok('recipe cards keep one background color', cardBgs.length === 1, cardBgs);
    await A.goto(F + '#edit-r-bobbys-challah'); await A.waitForTimeout(500);
    await A.selectOption('#ed-k', 'dairy'); await A.click('#edform .primary'); await A.waitForTimeout(800);
    ok('admin can mark a recipe Dairy', /dairy/i.test(await A.locator('.rhead .kchip').innerText().catch(() => '')));

    await A.goto(F); await A.waitForTimeout(400);
    await A.click('.cats.tools a[href="#scan"]'); await A.waitForTimeout(400);
    ok('home page Scan a recipe opens the scanner', /Add from a photo or file/.test(await A.locator('main h2').first().innerText()));
    // Kitchen tools: scaling, time, grocery list, calculator, menu ideas
    await A.goto(F + '#r-bobbys-challah'); await A.waitForTimeout(500);
    ok('recipe shows how long it takes', /About \d+ (hr|min)/.test(await A.locator('.facts').innerText()));
    await A.click('[data-sx="2"]'); await A.waitForTimeout(300);
    ok('doubling the recipe doubles amounts', /^12 lb\b/.test(await A.locator('.col.ing li').first().innerText()), await A.locator('.col.ing li').first().innerText());
    await A.click('[data-sx="0.5"]'); await A.waitForTimeout(300);
    ok('halving the recipe halves amounts', /^3 lb\b/.test(await A.locator('.col.ing li').first().innerText()));
    await A.click('#groc'); await A.waitForTimeout(300);
    await A.goto(F + '#r-chicken-soup'); await A.waitForTimeout(400); await A.click('#groc'); await A.waitForTimeout(300);
    await A.goto(F + '#grocery'); await A.waitForTimeout(500);
    ok('grocery list has both recipes', (await A.locator('.g-rec').count()) === 2);
    ok('grocery list adds up the half challah', /^3 lb/.test((await A.locator('.glist li', {hasText: 'flour'}).first().innerText()).trim()), await A.locator('.glist li', {hasText: 'flour'}).first().innerText());
    await A.locator('.glist input').first().check(); await A.waitForTimeout(200);
    ok('grocery items can be ticked off', (await A.locator('.glist li.have').count()) === 1);
    const fl = A.locator('.glist li', {hasText: 'flour'}).first();
    await fl.locator('.g-hv').click(); await A.waitForTimeout(150);
    await A.fill('#ghv-n', '1'); await A.selectOption('#ghv-u', 'lb'); await A.click('.g-hvbox .solid'); await A.waitForTimeout(300);
    const fl2 = (await A.locator('.glist li', {hasText: 'flour'}).first().innerText()).replace(/\s+/g, ' ').trim();
    ok('"I have some" leaves only what to buy', /^2 lb/.test(fl2) && /have 1 lb/.test(fl2), fl2);
    await A.locator('.glist li', {hasText: 'flour'}).first().locator('.g-hv').click(); await A.waitForTimeout(150);
    await A.fill('#ghv-n', '5'); await A.click('.g-hvbox .solid'); await A.waitForTimeout(300);
    ok('having enough counts as ticked', (await A.locator('.glist li.have', {hasText: 'flour'}).count()) === 1);
    await A.setViewportSize({width: 390, height: 844}); await A.goto(F + '#grocery'); await A.waitForTimeout(500);
    await A.click('#g-clear'); await A.waitForTimeout(300);
    const yesVisible = await A.locator('#g-yes').evaluate(el => { const b = el.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight - 90; });
    ok('Clear list asks right where you tapped, on a phone', yesVisible);
    await A.click('#g-yes'); await A.waitForTimeout(300);
    ok('Clear list empties the grocery list', (await A.locator('.glist li').count()) === 0 && await A.evaluate(() => gStore().items.length) === 0);
    await A.setViewportSize({width: 1100, height: 900});
    await A.goto(F + '#r-croissants'); await A.waitForTimeout(300); await A.click('#groc'); await A.waitForTimeout(300);
    // Today's to-do list: on the home page only when there's something to do soon (each person's choice)
    await A.goto(F); await A.waitForTimeout(300);
    ok('no to-do box on the home page when nothing is coming up', (await A.locator('#today').count()) === 0);
    await A.goto(F + '#settings-look'); await A.waitForTimeout(300); await A.selectOption('#pref-todo', '-1'); await A.waitForTimeout(300);
    ok('the choice is saved to the profile', await A.evaluate(() => profile.prefs && profile.prefs.todoDays === -1));
    await A.goto(F); await A.waitForTimeout(300);
    await A.fill('#td-new', 'Take out the chicken'); await A.click('#td-form .solid'); await A.waitForTimeout(200);
    await A.goto(F + '#r-challah'); await A.waitForTimeout(300);
    ok('the recipe page has no "Add to today" button (Add to calendar does it)', (await A.locator('#td-rec').count()) === 0 && (await A.locator('#toplan-btn').count()) === 1);
    await A.evaluate(() => todayAdd('Make Challah', 'r-challah'));
    await A.goto(F); await A.waitForTimeout(300);
    const td = await A.locator('#today').innerText();
    ok('today list has a task and a recipe', /Take out the chicken/.test(td) && /Make Challah/.test(td), td);
    await A.locator('#today [data-td]').first().check(); await A.waitForTimeout(200);
    ok('today tasks can be ticked off', (await A.locator('#today li.done').count()) === 1);
    await A.evaluate(() => { const v = store(uk('today')); v.day = '2000-01-01'; store(uk('today'), v); }); await A.goto(F + '#categories'); await A.goto(F); await A.waitForTimeout(300);
    const td2 = await A.locator('#today').innerText();
    ok('next day: finished tasks go, unfinished stay', !/Take out the chicken/.test(td2) && /Make Challah/.test(td2) && /from before/.test(td2), td2);
    await A.goto(F + '#settings-look'); await A.waitForTimeout(300); await A.selectOption('#pref-todo', '3'); await A.waitForTimeout(300);
    await A.goto(F); await A.waitForTimeout(300);
    ok('with "next 3 days" it shows while there is a to-do today', (await A.locator('#today').count()) === 1);
    await A.evaluate(() => { const v = tdStore(); v.items = []; tdSave(v); }); await A.goto(F + '#categories'); await A.goto(F); await A.waitForTimeout(300);
    ok('…and goes away when there is nothing to do', (await A.locator('#today').count()) === 0);
    await A.goto(F + '#plan'); await A.waitForTimeout(400);
    ok("today's to-do list is always on the Calendar", (await A.locator('#pl-day ~ #today, .pl-todo').count()) === 1);
    await A.goto(F + '#convert'); await A.waitForTimeout(400);
    ok('calculator converts a cup', /16\s*tbsp/.test(await A.locator('#cv-out').innerText()) && /237\s*ml/.test(await A.locator('#cv-out').innerText()));
    await A.fill('#cv-n', '350'); await A.selectOption('#cv-u', '°F'); await A.waitForTimeout(100);
    await A.fill('#wr-q', 'apple kugel'); await A.waitForTimeout(200); await A.locator('[data-wr]').first().click(); await A.waitForTimeout(300);
    ok('calculator doubles a whole recipe', /^6 cups flour/.test(await A.locator('.wr-list li').first().innerText()), await A.locator('.wr-list li').first().innerText());
    await A.click('[data-wx="0.5"]'); await A.waitForTimeout(200);
    ok('calculator halves a whole recipe', /^1½ cups flour/.test(await A.locator('.wr-list li').first().innerText()) && /6 tbsp sugar/.test(await A.locator('.wr-list').first().innerText()));
    await A.click('#wr-open'); await A.waitForTimeout(400);
    ok('open recipe at the chosen size', /^1½ cups flour/.test(await A.locator('.col.ing li').first().innerText()));
    await A.goto(F + '#convert'); await A.waitForTimeout(300); await A.fill('#cv-n', '350'); await A.selectOption('#cv-u', '°F'); await A.waitForTimeout(100);
    ok('calculator converts oven temperature', /177\s*°C/.test(await A.locator('#cv-out').innerText()));
    await A.goto(F + '#menu'); await A.waitForTimeout(400); await A.click('[data-mq="Beef"]'); await A.click('#mnform .primary'); await A.waitForTimeout(2500);
    const mn = await A.locator('.mn-list li').count();
    ok('menu ideas gives a full menu', mn === 6, mn);
    ok('menu never mixes meat and dairy', !/mixes meat and dairy/.test(await A.locator('.mn-result').innerText()));

    // Fish label, recipe numbers, sections
    await A.goto(F + '#c-fish'); await A.waitForTimeout(400);
    ok('fish recipes say Fish', await A.$$eval('.rc', els => els.length > 0 && els.every(e => /\bFish\b/i.test(e.querySelector('.kchip')?.textContent || ''))));
    await A.goto(F + '#new-pesach'); await A.waitForTimeout(400);
    await A.fill('#ed-t', 'Test Pesach Kugel'); await A.fill('#ed-sec', 'Kugel'); await A.locator('.sec-items').nth(0).fill('5 potatoes'); await A.click('#edform .primary'); await A.waitForTimeout(1500);
    const newNo = await A.locator('.rhead .nochip').innerText().catch(() => '');
    ok('new Pesach recipe gets a section code like LA001', /^[A-Z]{2}\d{3}$/.test(newNo), newNo);
    await A.goto(F + '#c-pesach'); await A.waitForTimeout(500);
    ok('Pesach shows section tiles', (await A.locator('.cats .cat h3').allInnerTexts()).some(x => /Kugel/.test(x)));
    await A.locator('.cats .cat', {hasText: 'Kugel'}).click(); await A.waitForTimeout(400);
    ok('a section opens its own page', (await A.locator('.rc h3').allInnerTexts()).includes('Test Pesach Kugel') && /--s-kugel$/.test(await A.evaluate(() => location.hash)));
    await A.goto(F); await A.waitForTimeout(300); await A.fill('#q', newNo.toLowerCase()); await A.waitForTimeout(300);
    ok('search by recipe code', (await A.locator('.rc h3').allInnerTexts()).join() === 'Test Pesach Kugel');
    await A.fill('#q', ''); await A.waitForTimeout(200);

    await A.goto(F + '#c-pesach'); await A.waitForTimeout(300); await A.locator('.cats .cat', {hasText: 'Kugel'}).click(); await A.waitForTimeout(300);
    ok('Pesach recipes say Pesach', await A.$$eval('.rc', els => els.length > 0 && els.every(e => /Pesach/i.test([...e.querySelectorAll('.kchip')].map(k => k.textContent).join(' ')))));
    await A.goto(F + '#new-bread'); await A.waitForTimeout(300); await A.fill('#ed-t', 'Test Bread Code'); await A.locator('.sec-items').nth(0).fill('2 cups flour'); await A.click('#edform .primary'); await A.waitForTimeout(1500);
    ok('category codes start at 001', /^[A-Z]\d{3}$/.test(await A.locator('.rhead .nochip').innerText().catch(() => '')) && !/1\d\d$/.test(await A.locator('.rhead .nochip').innerText().catch(() => '')), await A.locator('.rhead .nochip').innerText().catch(() => ''));
    await A.goto(F + '#c-bread'); await A.waitForTimeout(400);
    const bc = await A.locator('.rc .nochip').allInnerTexts();
    ok('category lists recipes by code', bc.length >= 2 && bc.every((c, i) => !i || bc[i - 1].localeCompare(c, undefined, {numeric: true}) < 0) && (await A.locator('.rc').first().locator('.nochip').count()) === 1, bc);
    ok('New recipes is first in the category bar', /^New recipes/.test(await A.locator('.tabs .tab').first().innerText()));
    await A.goto(F + '#settings-look'); await A.waitForTimeout(400);
    ok('Settings has five designs to choose from', (await A.locator('#lookpanel .look').count()) === 5);
    await A.click('#lookpanel [data-look="garden"]'); await A.waitForTimeout(200);
    ok('choosing a design changes the look', await A.evaluate(() => document.documentElement.dataset.look) === 'garden');
    await A.click('#lookpanel [data-look="classic"]'); await A.waitForTimeout(200);
    // New recipes
    await A.goto(F); await A.waitForTimeout(300);
    ok('New recipes is the first button on the home page', /New recipes/.test(await A.locator('.home .tabs .tab').first().innerText()));
    await A.goto(F + '#categories'); await A.waitForTimeout(300);
    ok('New recipes is the first tile in Categories', /New recipes/.test(await A.locator('.cats .cat').first().innerText()));
    // Bottom tab bar and timers
    ok('bottom bar marks Categories', (await A.locator('#tabbar [aria-current=page]').innerText()).includes('Categories'));
    await A.goto(F + '#r-challah'); await A.waitForTimeout(300);
    ok('recipe page hides the bottom bar and shows Start cooking', !(await A.locator('#tabbar').isVisible()) && await A.locator('#cook').isVisible());
    await A.click('#cook'); await A.waitForTimeout(300);
    const cookOn = (await A.locator('#cook').innerText()).trim();
    ok('Start cooking opens a step-by-step guide at step 1', await A.locator('#guide').isVisible() && /STEP 1 OF \d+/.test(await A.locator('.gd-count').innerText()));
    await A.click('#gd-next'); await A.waitForTimeout(200);
    ok('Next step goes to step 2 and ticks off step 1', /STEP 2 OF/.test(await A.locator('.gd-count').innerText()) && (await A.locator('.step[data-k="0"].done').count()) === 1);
    await A.click('#gd-back'); await A.waitForTimeout(200);
    ok('Back goes to step 1 again', /STEP 1 OF/.test(await A.locator('.gd-count').innerText()) && (await A.locator('.step[data-k="0"].done').count()) === 0);
    ok('the guide is light on a light screen', await A.evaluate(() => { const c = getComputedStyle(document.getElementById('guide')).backgroundColor.match(/\d+/g).map(Number); return c[0] + c[1] + c[2] > 600; }));
    await A.click('#gd-close'); await A.waitForTimeout(300);
    ok('Close ends cooking: Start cooking turns into Stop cooking, and back', cookOn === 'Stop cooking' && !(await A.locator('#guide').isVisible()) && (await A.locator('#cook').innerText()).trim() === 'Start cooking', cookOn);
    ok('steps with a time get a timer button', (await A.locator('.tbtn').count()) >= 1);
    await A.locator('.tbtn').first().click({force: true}); await A.waitForTimeout(300);
    ok('timer button starts a timer and does not tick the step', (await A.evaluate(() => TIMERS.length)) === 1 && (await A.locator('.step.done').count()) === 0);
    ok('running timer shows in the pill', await A.locator('#tpill').isVisible());
    await A.goto(F + '#timers'); await A.waitForTimeout(300); await A.fill('#tm-name', 'Test kugel'); await A.click('[data-tq="600"]'); await A.waitForTimeout(300);
    ok('timers page lists both timers', (await A.locator('.tm').count()) === 2 && /Test kugel/.test(await A.locator('#tm-list').innerText()));
    await A.evaluate(() => { TIMERS.find(x => x.label === 'Test kugel').end = Date.now() - 500; }); await A.waitForTimeout(1500);
    ok('finished timer rings', await A.locator('#talarm').isVisible() && /Test kugel/.test(await A.locator('#talarm').innerText()));
    await A.click('#talarm-stop'); await A.waitForTimeout(300);
    ok('Stop silences the alarm', !(await A.locator('#talarm').isVisible()));
    await A.evaluate(() => { TIMERS = []; saveTimers(); afterTimerChange(); });
    // In the Android app the phone schedules the alarm itself
    await A.evaluate(() => { window.__al = []; window.GKApp = {setAlarm: (id, at, l) => { __al.push('set ' + l); return true; }, cancelAlarm: id => { __al.push('cancel'); return true; }, stopRinging: () => __al.push('stop')}; });
    await A.goto(F + '#timers'); await A.waitForTimeout(200); await A.fill('#tm-name', 'Phone kugel'); await A.click('[data-tq="300"]'); await A.waitForTimeout(200);
    await A.locator('.tm [data-ta=pause]').click(); await A.waitForTimeout(200);
    const al = await A.evaluate(() => __al);
    ok('app timers go to the phone alarm, and pausing cancels it', al.includes('set Phone kugel') && al.includes('cancel'), al);
    await A.evaluate(() => { window.__stopped = '0'; GKApp.lastStopped = () => __stopped; });
    await A.locator('.tm [data-ta=resume]').click(); await A.waitForTimeout(200);
    await A.evaluate(() => { TIMERS.find(x => x.label === 'Phone kugel').end = Date.now() - 500; }); await A.waitForTimeout(1500);
    const ringingNow = await A.locator('#talarm').isVisible();
    await A.evaluate(() => { __stopped = String(Date.now()); }); await A.waitForTimeout(1500);
    ok('Stop on the phone clears the alarm in the app too', ringingNow && !(await A.locator('#talarm').isVisible()) && await A.evaluate(() => TIMERS.every(x => !x.rang || x.ack)));
    await A.evaluate(() => { delete window.GKApp; TIMERS = []; store('gk-native-alarms', []); saveTimers(); afterTimerChange(); });
    await A.goto(F); await A.waitForTimeout(300);
    await A.goto(F + '#c-cakes'); await A.waitForTimeout(300); await A.selectOption('[data-sortpage]', 'za'); await A.waitForTimeout(300);
    const za = await A.locator('.rc h3').allInnerTexts();
    ok('sort Z to A works', za.length > 2 && za.every((x, i) => !i || za[i - 1].replace(/^Untitled:\s*/, '').localeCompare(x.replace(/^Untitled:\s*/, ''), undefined, {sensitivity: 'base', numeric: true}) >= 0), za.slice(0, 4));
    await A.selectOption('[data-sortpage]', 'code'); await A.waitForTimeout(300);
    await A.goto(F + '#recent-week'); await A.waitForTimeout(300);
    ok('new recipes can sort by category', (await A.locator('[data-sortpage] option[value=cat]').count()) === 1);
    await A.goto(F + '#recent-day'); await A.waitForTimeout(400);
    ok('new recipes page lists recipes added today', (await A.locator('.rc h3').allInnerTexts()).includes('Test Pesach Kugel'));
    ok('new recipes has 6h / 24h / 7 days / 30 days', (await A.locator('.sec-pill').count()) === 4);
    await A.goto(F + '#recent-6h'); await A.waitForTimeout(300);
    ok('last 6 hours shows new recipes', (await A.locator('.rc h3').allInnerTexts()).includes('Test Pesach Kugel'));

    // Recipe requests
    await V.goto(F + '#requests'); await V.waitForTimeout(400);
    await V.fill('#rq-text', 'Potato kugel\nQuince tagine with saffron'); await V.click('#rqform .primary'); await V.waitForTimeout(1500);
    const rqt = await V.locator('.rq-result').innerText().catch(() => '');
    ok('request finds recipes in the cookbook', /Potato Kugel/.test(rqt), rqt.slice(0, 200));
    ok('request not in the cookbook goes to the admin', /Sent to/.test(rqt) && notes.some(n => /asking for a recipe/.test(n)), [rqt, notes.slice(-3)]);
    await A.goto(F + '#requests'); await A.waitForTimeout(600);
    ok('admin sees the request', /Quince tagine/.test(await A.locator('.rq-list').first().innerText().catch(() => '')));

    // Portals: owner/admin, employee, public
    const PP = await page(); await join(PP, 'Public Pat', 'pub123');
    await A.goto(F + '#admin'); await A.waitForTimeout(400);
    await A.locator('.mrow', {hasText: 'Public Pat'}).locator('[data-act=approve]').click(); await A.waitForTimeout(800);
    ok('approved as public', /PUBLIC PAT/.test(await PP.locator('.eyebrow').innerText().catch(() => '')) && await PP.evaluate(() => myRole()) === 'public');
    ok('public member sees recipes', await PP.evaluate(() => RECIPES.length) > 50);
    await PP.evaluate(() => { window.__sec = []; window.GKApp = Object.assign(window.GKApp || {}, {setSecure: v => __sec.push(v)}); capWas = null; renderAcct(); });
    ok('public members: the app blocks screenshots', await PP.evaluate(() => __sec[__sec.length - 1] === true && document.body.classList.contains('no-capture')));
    ok('…the website stops copying and shows their name faintly', await PP.evaluate(() => getComputedStyle(document.body).userSelect === 'none' && !!document.getElementById('wmark')));
    await PP.goto(F + '#r-challah'); await PP.waitForTimeout(300);
    ok('…and no downloads', !(await PP.locator('#dl').isVisible()));
    ok('employees and admins are not limited', await V.evaluate(() => !document.body.classList.contains('no-capture') && !document.getElementById('wmark')) && await A.evaluate(() => !document.body.classList.contains('no-capture')));
    await A.goto(F + '#public'); await A.waitForTimeout(400);
    await A.locator('[data-pc="Cakes"][data-pv="0"]').click(); await A.waitForTimeout(800);
    await A.uncheck('[data-pa=requests]'); await A.waitForTimeout(400);
    await PP.goto(F); await PP.waitForTimeout(600);
    ok('hidden category is gone for public members', await PP.evaluate(() => !RECIPES.some(r => r.c === 'Cakes')));
    ok('employees still see it', await V.evaluate(() => RECIPES.some(r => r.c === 'Cakes')));
    await V.goto(F); await V.waitForTimeout(400);
    ok('switched-off tool is gone for public members', (await PP.locator('.cats.tools a[href="#requests"]').count()) === 0 && (await V.locator('.cats.tools a[href="#requests"]').count()) === 1);
    await PP.goto(F + '#requests'); await PP.waitForTimeout(400);
    ok("public member can't open it by address", (await PP.locator('#rqform').count()) === 0);
    await A.goto(F + '#r-challah'); await A.waitForTimeout(300); await A.click('#pubtog'); await A.waitForTimeout(500);
    ok('admin can hide one recipe', await PP.evaluate(() => !RECIPES.some(r => r.id === 'r-challah')) && await V.evaluate(() => RECIPES.some(r => r.id === 'r-challah')));
    // Employees ask for a hidden recipe to go live
    await V.goto(F + '#r-challah'); await V.waitForTimeout(500);
    ok('employees see "Request to go live" on a hidden recipe', (await V.locator('#gl-btn').count()) === 1);
    await V.goto(F + '#r-croissants'); await V.waitForTimeout(300);
    ok('…and "Live ✓" on a visible one', /Live ✓/.test(await V.locator('.rhead').innerText()) && (await V.locator('#gl-btn').count()) === 0);
    await V.goto(F + '#r-challah'); await V.waitForTimeout(400);
    await V.click('#gl-btn'); await V.waitForTimeout(600);
    ok('…and it shows as asked', /Asked to go live/.test(await V.locator('.rhead').innerText()) && notes.some(n => /show a recipe to the public/.test(n)));
    await A.goto(F + '#public'); await A.waitForTimeout(600);
    ok('the request waits in Public portal settings', /Requests to go live/.test(await A.locator('main').innerText()));
    await A.locator('[data-gl][data-glok="1"]').first().click(); await A.waitForTimeout(800);
    ok('approving it shows the recipe to the public', await PP.evaluate(() => RECIPES.some(r => r.id === 'r-challah')));
    await A.goto(F + '#r-challah'); await A.waitForTimeout(300);
    ok('admins see "Live ✓" on a live recipe', (await A.locator('#pubtog').innerText()).trim() === 'Live ✓');
    await A.click('#pubtog'); await A.waitForTimeout(400);
    ok('…and "Go live" once it is taken off', (await A.locator('#pubtog').innerText()).trim() === 'Go live');
    await A.goto(F + '#public'); await A.waitForTimeout(400);
    await A.locator('[data-pd="Bread"] summary').click(); await A.waitForTimeout(200);
    const br = await A.locator('[data-pd="Bread"] [data-pr]').count();
    await A.locator('[data-pd="Bread"] [data-pr="r-croissants"]').uncheck(); await A.waitForTimeout(500);
    ok('recipe-by-recipe: untick hides just that one', br >= 5 && await PP.evaluate(() => !RECIPES.some(r => r.id === 'r-croissants') && RECIPES.some(r => r.c === 'Bread')), br);
    ok('category shows how many are visible', /of \d+ visible/.test(await A.locator('[data-pcat="Bread"] [data-psum]').innerText()));
    await A.fill('#pub-q', 'croissant'); await A.waitForTimeout(200);
    await A.locator('#pub-hits [data-pr="r-croissants"]').check(); await A.waitForTimeout(500);
    ok('search box finds and shows a recipe again', await PP.evaluate(() => RECIPES.some(r => r.id === 'r-croissants')) && await A.locator('[data-pd="Bread"] [data-pr="r-croissants"]').isChecked());
    await V.goto(F + '#public'); await V.waitForTimeout(300);
    ok("employees don't get admin pages", (await V.locator('.pub-cats').count()) === 0);
    await V.goto(F + '#r-challah'); await V.waitForTimeout(300);
    ok('employees suggest changes, not edit', /Suggest changes/.test(await V.locator('.rhead').innerText()) && (await V.locator('#pubtog').count()) === 0);
    await A.goto(F + '#admin'); await A.waitForTimeout(400);
    await A.locator('.mrow', {hasText: 'Public Pat'}).locator('[data-role]').selectOption('employee'); await A.waitForTimeout(1500);
    ok('making them an employee opens everything', await PP.evaluate(() => myRole()) === 'employee' && await PP.evaluate(() => RECIPES.some(r => r.c === 'Cakes')));
    ok('…and lifts the screenshot block', await PP.evaluate(() => !document.body.classList.contains('no-capture')));
    await A.locator('.mrow', {hasText: 'Public Pat'}).locator('[data-role]').selectOption('admin'); await A.waitForTimeout(1500);
    ok('owner can make an admin', await PP.evaluate(() => isAdmin()) && (await A.locator('.mrow', {hasText: 'Public Pat'}).locator('.tag').innerText()) === 'ADMIN');
    await PP.goto(F + '#admin'); await PP.waitForTimeout(500);
    ok("an admin can't change the owner", (await PP.locator('.mrow', {hasText: 'Shulem'}).locator('[data-role]').count()) === 0 && (await PP.locator('.mrow', {hasText: 'Test Member'}).first().locator('[data-role]').count()) === 1);
    await A.goto(F + '#public'); await A.waitForTimeout(300); await A.locator('[data-pc="Cakes"][data-pv="1"]').click(); await A.waitForTimeout(500); await A.check('[data-pa=requests]'); await A.waitForTimeout(300);

    // Per-person employee permissions
    const vn = await V.evaluate(() => myName());
    await A.goto(F + '#admin'); await A.waitForTimeout(400);
    await A.locator('.mrow', {hasText: vn}).locator('[data-act=perms]').click(); await A.waitForTimeout(200);
    await A.locator('[data-pk=edit]').check(); await A.waitForTimeout(1500);
    await V.goto(F + '#r-challah'); await V.waitForTimeout(500);
    ok('one employee can be allowed to edit recipes', /Edit recipe/.test(await V.locator('.rhead').innerText()) && await V.evaluate(() => may('edit') && !may('review')));
    await A.locator('[data-pk=photos]').uncheck(); await A.waitForTimeout(1500);
    await V.goto(F + '#r-challah'); await V.waitForTimeout(500);
    ok('an everyday permission can be switched off for one employee', (await V.locator('.ph-add').count()) === 0);
    await A.locator('[data-pk=photos]').check(); await A.waitForTimeout(400); await A.locator('[data-pk=edit]').uncheck(); await A.waitForTimeout(1500);
    await V.goto(F + '#r-challah'); await V.waitForTimeout(500);
    ok('taking a permission away works', /Suggest changes/.test(await V.locator('.rhead').innerText()) && (await V.locator('.ph-add').count()) > 0);
    await A.goto(F + '#employees'); await A.waitForTimeout(400);
    await A.locator('[data-ea=answer]').check(); await A.waitForTimeout(1500);
    await V.goto(F); await V.waitForTimeout(500);
    ok('Employee settings give every employee a permission', await V.evaluate(() => may('answer')) && /Recipe requests/.test(await V.evaluate(() => { openMenu(); const t = document.querySelector('.menu').innerText; closeMenu(); return t; })));
    await A.locator('[data-ea=answer]').uncheck(); await A.waitForTimeout(1500);
    await V.goto(F); await V.waitForTimeout(500);
    ok('…and take it away again', await V.evaluate(() => !may('answer')));
    await A.goto(F); await A.waitForTimeout(400); await A.click('#avbtn'); await A.waitForTimeout(200);
    const menuTxt = await A.locator('.menu').innerText();
    ok('account menu is grouped and short', (await A.locator('.menu .mgroup').count()) === 5 && /Employee settings/.test(menuTxt), menuTxt.slice(0, 300));
    await A.click('.menu details[data-mg=tools] summary'); await A.waitForTimeout(200);
    const toolsTxt = await A.locator('.menu details[data-mg=tools]').innerText();
    ok('the menu has a Kitchen tools drop-down with all the tools', ['Grocery list', 'Timers', 'Calendar', 'Calculator', 'Menu ideas', 'Scan a recipe', 'Recipe requests'].every(x => toolsTxt.includes(x)), toolsTxt);
    await A.click('#avbtn');
    ok('home has no shortcuts that are already in the bottom bar', (await A.locator('.cats.tools a[href="#timers"], .cats.tools a[href="#grocery"]').count()) === 0);
    // Who added / changed: admins only, plus the Activity page
    await V.goto(F + '#r-croissants'); await V.waitForTimeout(400);
    await A.goto(F + '#r-croissants'); await A.waitForTimeout(400);
    ok('only admins see who added or changed a recipe', (await V.locator('.byline').count()) === 0 && /Changed by/.test(await A.locator('.byline').innerText().catch(() => '')));
    await A.goto(F + '#activity'); await A.waitForTimeout(400);
    ok('Activity page lists changes by person, with charts', (await A.locator('.act-feed li').count()) > 0 && (await A.locator('.act-bar').count()) > 0 && (await A.locator('.act-col').count()) > 0);
    await A.locator('.act-bar').first().click(); await A.waitForTimeout(200);
    const who = await A.locator('#act-who').inputValue();
    ok('tapping a person shows only their changes', who !== '' && (await A.locator('.act-feed li b').allInnerTexts()).every(x => x === who), who);
    await V.goto(F + '#activity'); await V.waitForTimeout(300);
    ok("employees don't get the Activity page", (await V.locator('.act-feed, .act-bars').count()) === 0);
    // Duplicate recipes (admins)
    await A.goto(F); await A.waitForTimeout(500);
    ok('admin sees the duplicate recipes box', /Possible duplicate recipes/.test(await A.locator('.dup-note').innerText().catch(() => '')));
    ok('employees never see it', (await V.locator('.dup-note').count()) === 0);
    await A.goto(F + '#dupes'); await A.waitForTimeout(400);
    const nd = await A.locator('.dup').count();
    ok('duplicates page lists pairs with how alike they are', nd >= 1 && /\d+%/.test(await A.locator('.dup-pct').first().innerText()), nd);
    await A.locator('.dup [data-dupok]').first().click(); await A.waitForTimeout(600);
    ok('"Not duplicates" hides the pair', (await A.locator('.dup').count()) === nd - 1);
    await A.reload(); await A.waitForTimeout(1200);
    ok('…and it stays hidden after refreshing the page', (await A.locator('.dup').count()) === nd - 1, await A.locator('.dup').count());
    await A.evaluate(() => store('gk-dupes-ignore', null)); await A.reload(); await A.waitForTimeout(1200);
    ok('…even on a device that never saw it (loaded from the cookbook)', (await A.locator('.dup').count()) === nd - 1, await A.locator('.dup').count());
    await A.click('#dup-unhide'); await A.waitForTimeout(500);
    ok('hidden pairs can be shown again', (await A.locator('.dup').count()) === nd);
    ok('Duplicate recipes is under Recipes in the menu', await A.evaluate(() => { openMenu(); const ok = !!document.querySelector('.mgroup[data-mg=recipes] a[href="#dupes"]') && !document.querySelector('.mgroup[data-mg=manage] a[href="#dupes"]'); closeMenu(); return ok; }));

    ok('sources show without page numbers', await A.evaluate(() => creditText('The Haimishe Kitchen – Pesach Cookbook, page 22') === 'From The Haimishe Kitchen – Pesach Cookbook' && creditText('Bobby') === 'From Bobby'));

    // Calendar (Hebrew dates, holidays) and menus
    await A.goto(F + '#plan-2026-12-05'); await A.waitForTimeout(500);
    const dh = await A.locator('.pl-dhead').innerText();
    ok('calendar writes the Hebrew date and the Yom Tovim in Hebrew', /כ״ה כסלו תשפ״ז/.test(dh) && !/Kislev|Chanukah|Shabbos/.test(dh) && /חנוכה · נר א׳/.test(dh) && /שבת קודש/.test(dh), dh);
    await A.goto(F + '#plan-2026-09-26'); await A.waitForTimeout(400);
    ok('Yom Tov names in Hebrew in the calendar boxes too', /שמ״ע|חוה״מ|סוכות/.test(await A.locator('.cal').innerText()) && /סוכות/.test(await A.locator('.pl-up').innerText().catch(() => '') + await A.locator('.cal').innerText()));
    ok('Kiddush is one of the meals', (await A.locator('#pl-meal option', {hasText: 'Kiddush'}).count()) === 1);
    // a new menu for one meal, made right on the day
    await A.goto(F + '#plan-2026-12-05'); await A.waitForTimeout(400);
    await A.selectOption('#pl-meal', 'Kiddush'); await A.selectOption('#pl-what', 'new'); await A.waitForTimeout(100);
    await A.fill('#pl-newname', 'Test Kiddush'); await A.click('#pl-newgo'); await A.waitForTimeout(800);
    ok('a new menu for a meal opens to add its recipes', (await A.locator('#mi-q').count()) === 1 && /Back to Saturday/.test(await A.locator('.back').innerText()));
    await A.fill('#mi-q', 'cake'); await A.waitForTimeout(150); await A.locator('[data-miadd]').first().click(); await A.waitForTimeout(300);
    await A.click('.back'); await A.waitForTimeout(500);
    ok('…and sits on that day under that meal', /Kiddush/.test(await A.locator('.pl-meal').first().innerText()) && /Test Kiddush/.test(await A.locator('#pl-day').innerText()));
    // when to cook: a different day and a time
    await A.locator('[data-cook]').first().click(); await A.waitForTimeout(100);
    await A.fill('.pc-date', '2026-12-03'); await A.fill('.pc-time', '20:00'); await A.click('.pc-save'); await A.waitForTimeout(400);
    ok('a menu gets its own cooking day and time', /Cook Thu, Dec 3 at 8:00/.test(await A.locator('.pl-cook').first().innerText()), await A.locator('.pl-cook').first().innerText());
    await A.goto(F + '#plan-2026-12-03'); await A.waitForTimeout(400);
    ok('the cooking day shows what to cook and when', /To cook/i.test(await A.locator('.pl-cooking').innerText().catch(() => '')) && /8:00/.test(await A.locator('.pl-cooking').innerText().catch(() => '')) && /Test Kiddush/.test(await A.locator('.pl-cooking').innerText().catch(() => '')));
    ok('the month heading is in Hebrew too', /כסלו – טבת תשפ״ז/.test(await A.locator('.cal-title').innerText()), await A.locator('.cal-title').innerText());
    ok('Calendar is the last button in the bottom bar, where Me was', (await A.locator('#tabbar [data-nav=plan][aria-current=page]').count()) === 1 && await A.evaluate(() => [...document.querySelectorAll('#tabbar [data-nav]')].map(a => a.dataset.nav).join()) === 'home,cats,grocery,timers,plan');
    await A.goto(F + '#menus'); await A.waitForTimeout(300); await A.fill('#mn-name', 'Test Friday night'); await A.click('#mn-new .solid'); await A.waitForTimeout(600);
    for (const q of ['chicken soup', 'challah']) { await A.fill('#mi-q', q); await A.waitForTimeout(150); await A.locator('[data-miadd]').first().click(); await A.waitForTimeout(300); }
    ok('a menu holds recipes', (await A.locator('.mi-row').count()) === 2);
    await A.fill('#mi-date', '2026-12-04'); await A.selectOption('#mi-meal', 'Friday night'); await A.click('#mi-cal'); await A.waitForTimeout(700);
    ok('a menu goes on a chosen day and meal', /Friday night/.test(await A.locator('.pl-meal').innerText().catch(() => '')) && /Test Friday night/.test(await A.locator('.pl-entry').innerText().catch(() => '')) && await A.evaluate(() => planSel) === '2026-12-04');
    await A.locator('[data-pdone]').first().check(); await A.waitForTimeout(400);
    ok('ticking a recipe off counts what is done and what is left', /1 of 2 made/.test(await A.locator('.pl-prog').innerText()) && /left/.test(await A.locator('.pl-prog').innerText()));
    await A.evaluate(() => { const g = gStore(); g.items = []; gSave(g); }); await A.click('#pl-groc'); await A.waitForTimeout(200);
    ok('a day goes to the grocery list in one tap', await A.evaluate(() => gStore().items.length) === 2);
    // edit the menu: the linked day shows the change
    const mid = await A.evaluate(() => Object.values(MENUS).find(m => m.name === 'Test Friday night').id);
    await A.goto(F + '#menu-' + mid); await A.waitForTimeout(300); await A.fill('#mi-q', 'kugel'); await A.waitForTimeout(150); await A.locator('[data-miadd]').first().click(); await A.waitForTimeout(300);
    await A.goto(F + '#plan-2026-12-04'); await A.waitForTimeout(400);
    ok('the day is linked to the menu: changes show up', /1 of 3 made/.test(await A.locator('.pl-prog').innerText()));
    // share it
    const vn2 = await V.evaluate(() => myName());
    await A.goto(F + '#menu-' + mid); await A.waitForTimeout(300); await A.fill('#mi-share', vn2); await A.click('#mi-sharego'); await A.waitForTimeout(800);
    await V.goto(F + '#menus'); await V.waitForTimeout(800);
    ok('a shared menu shows up for the other member', /Shared with me/.test(await V.locator('main').innerText()) && /Test Friday night/.test(await V.locator('main').innerText()));
    await V.goto(F + '#menu-' + mid); await V.waitForTimeout(400);
    ok("…they can use it but not change it", (await V.locator('#mi-q').count()) === 0 && (await V.locator('#mi-cal').count()) === 1 && (await V.locator('#mi-copy').count()) === 1);
    await V.goto(F + '#plan-2026-12-04'); await V.waitForTimeout(400);
    ok("everyone's calendar is their own", !/Test Friday night/.test(await V.locator('#pl-day').innerText()));
    // from a recipe page
    await A.goto(F + '#r-croissants'); await A.waitForTimeout(300); await A.click('#toplan-btn');
    await A.fill('#tp-date', '2026-12-06'); await A.locator('#tp-date').dispatchEvent('change'); await A.selectOption('#tp-meal', 'Kiddush'); await A.selectOption('#tp-x', '2');
    ok('the recipe page shows the Hebrew date of the chosen day', /ו׳ כסלו|כסלו/.test(await A.locator('#tp-heb').innerText()));
    await A.click('#tp-cookbox summary'); await A.fill('#tp-cdate', '2026-12-04'); await A.fill('#tp-ctime', '10:30'); await A.click('#tp-cal'); await A.waitForTimeout(400);
    await A.goto(F + '#plan-2026-12-06'); await A.waitForTimeout(400);
    const pd6 = await A.locator('#pl-day').innerText();
    ok('a recipe page puts a recipe on a day, a meal and an amount', /Croissants/.test(pd6) && /Kiddush/i.test(pd6) && /2×/.test(pd6), pd6.slice(0, 300));
    ok('…with when to cook it', /Cook Fri, Dec 4 at 10:30/.test(pd6), pd6.slice(0, 400));
    await A.goto(F + '#plan-2026-12-04'); await A.waitForTimeout(400);
    ok('…and that cooking day lists it', /Croissants/.test(await A.locator('.pl-cooking').innerText().catch(() => '')));

    // Servings
    await A.goto(F + '#edit-r-croissants'); await A.waitForTimeout(300); await A.fill('#ed-serves', '6–8'); await A.click('#edform .primary'); await A.waitForTimeout(800);
    await A.goto(F + '#r-croissants'); await A.waitForTimeout(400);
    ok('a recipe shows how many it serves', /Serves 6–8/.test(await A.locator('.fact.serves').innerText().catch(() => '')));
    await A.click('[data-sx="2"]'); await A.waitForTimeout(300);
    ok('…and it doubles with the recipe', /Serves 12–16/.test(await A.locator('.fact.serves').innerText().catch(() => '')));
    await A.click('[data-sx="1"]'); await A.waitForTimeout(200);
    await A.goto(F + '#r-boston-cream-pie'); await A.waitForTimeout(300);
    ok('recipes without one show a guess', /about/.test(await A.locator('.fact.serves').innerText().catch(() => '')));
    // Moving recipes to another category
    await A.goto(F + '#r-croissants'); await A.waitForTimeout(300); await A.click('#mv-btn'); await A.selectOption('#mv1-cat', 'Cakes'); await A.click('#mv1-go'); await A.waitForTimeout(800);
    const mvd = await A.evaluate(() => { const r = RECIPES.find(x => x.id === 'r-croissants'); return [r.c, r.code, CODEMAP.cats.Cakes]; });
    ok('admins can move a recipe to another category, with a new code', mvd[0] === 'Cakes' && mvd[1].startsWith(mvd[2]), mvd);
    await A.goto(F + '#move-cakes'); await A.waitForTimeout(400);
    await A.locator('[data-mv="r-croissants"]').check(); await A.selectOption('#mv-cat', 'Bread'); await A.click('#mv-go'); await A.waitForTimeout(1000);
    ok('…or several at once', await A.evaluate(() => RECIPES.find(x => x.id === 'r-croissants').c) === 'Bread');
    await V.goto(F + '#r-croissants'); await V.waitForTimeout(400);
    ok("employees can't move recipes unless allowed", (await V.locator('#mv-btn').count()) === 0);
    const vn3 = await V.evaluate(() => myName());
    await A.goto(F + '#admin'); await A.waitForTimeout(400); await A.locator('.mrow', {hasText: vn3}).locator('[data-act=perms]').click(); await A.waitForTimeout(200);
    await A.locator('[data-pk=move]').check(); await A.waitForTimeout(1500);
    await V.goto(F + '#r-croissants'); await V.waitForTimeout(500);
    ok('…and can once you allow it', (await V.locator('#mv-btn').count()) === 1);
    await A.locator('[data-pk=move]').uncheck(); await A.waitForTimeout(800);

    // See it as… (owner)
    await A.goto(F + '#r-challah'); await A.waitForTimeout(300); if ((await A.locator('#pubtog').innerText()).includes('Live')) { await A.click('#pubtog'); await A.waitForTimeout(400); }
    await A.goto(F + '#viewas'); await A.waitForTimeout(300);
    ok('the owner can log in as admin, employee or customer', (await A.locator('[data-va]').count()) === 3);
    await A.click('[data-va=public]'); await A.waitForTimeout(1500);
    ok('seeing it as public: a bar says so', /Logged in as a customer/.test(await A.locator('#viewas-bar').innerText().catch(() => '')));
    ok('…hidden recipes are gone and the watermark shows', await A.evaluate(() => !RECIPES.some(r => r.id === 'r-challah') && !!document.getElementById('wmark') && myRole() === 'public' && !isAdmin()));
    await A.evaluate(() => { window.__sec2 = []; window.GKApp = Object.assign(window.GKApp || {}, {setSecure: v => __sec2.push(v)}); capWas = null; renderAcct(); });
    ok('…and screenshots are blocked in the app, like a real customer', await A.evaluate(() => __sec2[__sec2.length - 1] === true));
    await A.click('#avbtn'); await A.waitForTimeout(200);
    ok('…the menu has no admin pages', !/Members|Employee settings/.test(await A.locator('.menu').innerText()));
    await A.click('#avbtn');
    await A.goto(F + '#viewas'); await A.waitForTimeout(300); await A.click('[data-va=employee]'); await A.waitForTimeout(1500);
    ok('seeing it as an employee', /an employee/.test(await A.locator('#viewas-bar').innerText().catch(() => '')) && await A.evaluate(() => RECIPES.some(r => r.id === 'r-challah') && !isAdmin() && myRole() === 'employee'));
    await A.goto(F + '#account'); await A.waitForTimeout(300);
    ok("previews never offer to delete your own profile", (await A.locator('#prof-del').count()) === 0);
    // one particular employee, with their own permissions
    const vn4 = await V.evaluate(() => myName());
    await A.click('#va-back'); await A.waitForTimeout(1500);
    await A.goto(F + '#admin'); await A.waitForTimeout(400); await A.locator('.mrow', {hasText: vn4}).locator('[data-act=perms]').click(); await A.waitForTimeout(200);
    await A.locator('[data-pk=edit]').check(); await A.waitForTimeout(800);
    await A.goto(F + '#viewas'); await A.waitForTimeout(400); await A.fill('#va-q', vn4.slice(0, 6)); await A.waitForTimeout(100); await A.locator('.va-person', {hasText: vn4}).click(); await A.waitForTimeout(1500);
    ok('the owner can log in as one particular employee, with their own permissions', new RegExp(vn4).test(await A.locator('#viewas-bar').innerText().catch(() => '')) && await A.evaluate(() => may('edit') && myRole() === 'employee'));
    await A.click('#va-back'); await A.waitForTimeout(1500);
    await A.goto(F + '#admin'); await A.waitForTimeout(400); await A.locator('.mrow', {hasText: vn4}).locator('[data-act=perms]').click(); await A.waitForTimeout(200);
    await A.locator('[data-pk=edit]').uncheck(); await A.waitForTimeout(800);
    ok('Back to my view brings everything back', (await A.locator('#viewas-bar').count()) === 0 && await A.evaluate(() => isOwner() && isAdmin()));

    // Team messages about a recipe
    const PU = await page(); await join(PU, 'Public Paula', 'pub456');
    await A.goto(F + '#admin'); await A.waitForTimeout(600); await A.locator('.mrow', {hasText: 'Public Paula'}).locator('[data-act=approve]').click(); await A.waitForTimeout(1500);
    await V.goto(F + '#r-croissants'); await V.waitForTimeout(800); await PU.goto(F + '#r-croissants'); await PU.waitForTimeout(400);
    ok('employees see "Ask the team about this" on a recipe; public members do not', (await V.locator('#askteam-btn').count()) === 1 && (await PU.locator('#askteam-btn').count()) === 0);
    await V.click('#askteam-btn'); await V.waitForTimeout(200);
    ok('the team list lets an employee pick the admins or one person', await V.locator('#at-to option').count() >= 3);
    await V.selectOption('#at-to', 'admins'); await V.fill('#at-text', 'Can you check the oven time on this one?'); await V.click('#at-send'); await V.waitForTimeout(800);
    ok('sending opens the conversation with the recipe attached', /^#team-/.test(await V.evaluate(() => location.hash)) && (await V.locator('.tm-recipe[href="#r-croissants"]').count()) === 1);
    ok('the owner gets a phone notice', notes.some(n => /: about /.test(n)), notes.slice(-2));
    await V.goto(F); await A.goto(F + '#team'); await A.waitForTimeout(800);
    ok('the admin sees it as new in Team messages', (await A.locator('.tm-row.unread', {hasText: 'oven time'}).count()) === 1 && await A.evaluate(() => unreadThreads() === 1));
    await A.locator('.tm-row', {hasText: 'oven time'}).click(); await A.waitForTimeout(600);
    await A.fill('#tm-reply', 'Fixed it, 375°F now.'); await A.click('#tm-form button'); await A.waitForTimeout(800);
    ok('opening it marks it read', await A.evaluate(() => unreadThreads() === 0));
    await V.goto(F + '#team'); await V.waitForTimeout(800);
    ok('the employee sees the reply as new', (await V.locator('.tm-row.unread', {hasText: '375°F'}).count()) === 1);
    await V.locator('.tm-row', {hasText: '375°F'}).click(); await V.waitForTimeout(600);
    await V.click('#tm-done'); await V.waitForTimeout(600);
    await V.goto(F + '#team'); await V.waitForTimeout(500);
    ok('marking done moves it to Done', (await V.locator('details .tm-row', {hasText: '375°F'}).count()) === 1);
    await PU.goto(F + '#team'); await PU.waitForTimeout(400);
    ok("public members can't open Team messages", (await PU.locator('#tn-form').count()) === 0 && await PU.evaluate(() => THREADS.length === 0));

    // Phone notices, and recipe requests from customers
    await V.goto(F + '#account'); await V.waitForTimeout(700);
    ok('employees can turn on phone notices in Account settings', (await V.locator('#nt-on').count()) === 1 && (await PU.evaluate(() => isPublic())));
    await V.click('#nt-on'); await V.waitForTimeout(700);
    const vtopic = (await V.locator('.nt-topic code').innerText()).trim();
    ok('…which gives them their own private topic, with a test button', /^gk-[0-9a-f]{24}$/.test(vtopic) && (await V.locator('#nt-test').count()) === 1, vtopic);
    const vuid = await V.evaluate(() => me), vname = await V.evaluate(() => myName());
    await A.goto(F + '#admin'); await A.waitForTimeout(500);
    if (!(await A.locator(`[data-pk=answer][data-pu="${vuid}"]`).count())) { await A.locator('.mrow', {hasText: vname}).locator('[data-act=perms]').click(); await A.waitForTimeout(300); }
    await A.locator(`[data-pk=answer][data-pu="${vuid}"]`).check(); await A.waitForTimeout(4500);
    ok('choosing an employee for recipe requests means they hear about new ones', await A.evaluate(u => ((__fakeDB().meta.reqwatch || {}).uids || []).includes(u), vuid));
    await PU.goto(F + '#requests'); await PU.waitForTimeout(500);
    const nBefore = ntfyPaths.length;
    await PU.fill('#rq-text', 'Quince jelly from Bubby'); await PU.click('#rqform .primary'); await PU.waitForTimeout(2000);
    ok('customers can ask for a recipe, and the admin hears about it', notes.slice(-4).some(n => /asking for a recipe/.test(n)));
    ok('…and so does the chosen employee, on their own phone', ntfyPaths.slice(nBefore).includes('/' + vtopic), ntfyPaths.slice(nBefore));
    await A.locator(`[data-pk=answer][data-pu="${vuid}"]`).uncheck(); await A.waitForTimeout(4500);
    ok('taking it away stops the notices', await A.evaluate(u => !((__fakeDB().meta.reqwatch || {}).uids || []).includes(u), vuid));
    await PU.goto(F + '#account'); await PU.waitForTimeout(500);
    ok("customers don't get the phone notices setting", (await PU.locator('#ntfypanel').count()) === 0);

    await PU.goto(F); await PU.waitForTimeout(500);
    ok('customers have “Request a recipe” on the home page, by Suggestions & comments', (await PU.locator('.rq-card a[href="#requests"]').count()) === 1 && (await PU.locator('.fb-card').count()) === 2);
    // Grocery list: any item
    await PU.goto(F + '#grocery'); await PU.waitForTimeout(400);
    await PU.fill('#g-item', 'paper tow'); await PU.waitForTimeout(150);
    ok('“Add any item” suggests everyday groceries', /paper towels/.test(await PU.locator('#g-isugg').innerText()));
    await PU.fill('#g-item', '2 lb apples'); await PU.press('#g-item', 'Enter'); await PU.waitForTimeout(300);
    await PU.fill('#g-item', 'paper towels'); await PU.click('#g-iadd'); await PU.waitForTimeout(300);
    const gl = await PU.locator('.glist').allInnerTexts();
    ok('any item can go on the grocery list, in its aisle', /apples/.test(gl.join(' ')) && /paper towels/.test(gl.join(' ')) && /2 lb/.test(gl.join(' ')), gl);
    await PU.locator('[data-gxrm="1"]').click(); await PU.waitForTimeout(300);
    ok('…and taken off again', !/paper towels/.test((await PU.locator('.glist').allInnerTexts()).join(' ')));

    // Member numbers
    ok('every approved member has their own member number', await A.evaluate(() => { const n = members.filter(m => m.status === 'approved').map(m => m.no); return n.every(x => x > 1000) && new Set(n).size === n.length; }));
    await PU.goto(F + '#account'); await PU.waitForTimeout(500);
    ok('…shown in Account settings', /^\d{4,}$/.test((await PU.locator('.acc-no b').innerText()).trim()));
    const puNo = String(await PU.evaluate(() => profile.no));

    // Log in as one particular customer, found by email or number
    await PU.goto(F + '#r-croissants'); await PU.waitForTimeout(400); if ((await PU.locator('#fav[aria-pressed=false]').count())) { await PU.click('#fav'); await PU.waitForTimeout(400); }
    await A.goto(F + '#viewas'); await A.waitForTimeout(400); await A.fill('#va-q', 'public.paula@'); await A.waitForTimeout(100);
    ok('Log in as finds a customer by email', (await A.locator('.va-person').count()) === 1 && /Public Paula/.test(await A.locator('.va-person').innerText()));
    await A.fill('#va-q', puNo); await A.waitForTimeout(100);
    ok('…or by member number', (await A.locator('.va-person', {hasText: 'Public Paula'}).count()) === 1);
    await A.locator('.va-person', {hasText: 'Public Paula'}).click(); await A.waitForTimeout(1800);
    await A.goto(F); await A.waitForTimeout(600);
    ok('…and shows their home page with their name', /Public Paula/i.test(await A.locator('.hello .eyebrow').innerText()) && /Public Paula/.test(await A.locator('#viewas-bar').innerText()) && await A.evaluate(() => isPublic()));
    ok('…with their favorites', await A.evaluate(() => favs().includes('r-croissants')));
    await A.evaluate(() => setFavs([])); await A.waitForTimeout(300);
    ok("…and nothing done while looking is saved", await PU.evaluate(() => favs().includes('r-croissants')) && /Nothing is saved/.test(await A.locator('#toast').innerText()));
    await A.click('#va-back'); await A.waitForTimeout(1500);
    // Employees may look in as customers only, and only when allowed
    await V.goto(F); await V.waitForTimeout(400); await V.click('#avbtn'); await V.waitForTimeout(200);
    ok("employees can't log in as anyone unless allowed", (await V.locator('.menu a[href="#viewas"]').count()) === 0);
    await V.click('#avbtn');
    await A.goto(F + '#admin'); await A.waitForTimeout(500);
    if (!(await A.locator(`[data-pk=viewas][data-pu="${vuid}"]`).count())) { await A.locator('.mrow', {hasText: vname}).locator('[data-act=perms]').click(); await A.waitForTimeout(300); }
    await A.locator(`[data-pk=viewas][data-pu="${vuid}"]`).check(); await A.waitForTimeout(4500);
    await V.goto(F + '#viewas'); await V.waitForTimeout(900);
    const vaTxt = await V.locator('#va-people').innerText();
    ok('an allowed employee can log in as customers only', (await V.locator('[data-va]').count()) === 1 && (await V.locator('[data-va=public]').count()) === 1 && /Public Paula/.test(vaTxt) && !/Shulem/.test(vaTxt), vaTxt);
    await V.locator('.va-person', {hasText: 'Public Paula'}).click(); await V.waitForTimeout(1800);
    ok('…and sees what that customer sees', /Public Paula/.test(await V.locator('#viewas-bar').innerText().catch(() => '')) && await V.evaluate(() => isPublic() && favs().includes('r-croissants')));
    await V.click('#va-back'); await V.waitForTimeout(1500);
    await A.locator(`[data-pk=viewas][data-pu="${vuid}"]`).uncheck(); await A.waitForTimeout(800);

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
