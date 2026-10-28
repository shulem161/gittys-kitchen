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
    await A.goto(F + '#categories'); await A.waitForTimeout(300);
    const total = parseInt(await A.locator('.section-head p').first().innerText());
    ok('recipes go online', total > 100, total);
    const B = await page(); await join(B, 'Test Member', 'member1');
    ok('new member waits for approval', (await B.locator('h2').innerText()) === 'Waiting for approval');
    ok('admin is notified of join request', notes.some(n => /asked to join/.test(n)), notes);
    await A.goto(F + '#admin'); await A.waitForTimeout(400); await A.click('[data-act=approve]'); await A.waitForTimeout(700);
    ok('a newly approved member starts as public', await B.evaluate(() => myRole()) === 'public');
    await A.locator('.mrow', {hasText: 'Test Member'}).locator('[data-role]').selectOption('employee'); await A.waitForTimeout(1500);
    ok('an admin moves them up to employee by hand', await B.evaluate(() => myRole()) === 'employee');
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
    ok('admin stays admin after rename', await A.evaluate(() => isAdmin()) && /Owner/.test(await A.locator('.prof-head .hint').innerText()));
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
    // Today's to-do list
    await A.goto(F); await A.waitForTimeout(300);
    await A.fill('#td-new', 'Take out the chicken'); await A.click('#td-form .solid'); await A.waitForTimeout(200);
    await A.goto(F + '#r-challah'); await A.waitForTimeout(300); await A.click('#td-rec'); await A.waitForTimeout(200);
    await A.goto(F); await A.waitForTimeout(300);
    const td = await A.locator('#today').innerText();
    ok('today list has a task and a recipe', /Take out the chicken/.test(td) && /Make Challah/.test(td), td);
    await A.locator('#today [data-td]').first().check(); await A.waitForTimeout(200);
    ok('today tasks can be ticked off', (await A.locator('#today li.done').count()) === 1);
    await A.evaluate(() => { const v = store(uk('today')); v.day = '2000-01-01'; store(uk('today'), v); }); await A.goto(F + '#categories'); await A.goto(F); await A.waitForTimeout(300);
    const td2 = await A.locator('#today').innerText();
    ok('next day: finished tasks go, unfinished stay', !/Take out the chicken/.test(td2) && /Make Challah/.test(td2) && /from before/.test(td2), td2);
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
    await A.goto(F + '#profile'); await A.waitForTimeout(400);
    ok('profile has five designs to choose from', (await A.locator('#lookpanel .look').count()) === 5);
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
    await A.click('#cook'); await A.waitForTimeout(200);
    const cookOn = (await A.locator('#cook').innerText()).trim();
    await A.click('#cook'); await A.waitForTimeout(200);
    ok('Start cooking turns into Stop cooking, and back', cookOn === 'Stop cooking' && (await A.locator('#cook').innerText()).trim() === 'Start cooking', cookOn);
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
    ok('account menu is grouped and short', (await A.locator('.menu .mgroup').count()) === 3 && !/Grocery list|Kitchen calculator|Menu ideas/.test(menuTxt) && /Employee settings/.test(menuTxt), menuTxt.slice(0, 300));
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
