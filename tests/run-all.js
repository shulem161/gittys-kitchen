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
  const ctx = await b.newContext({viewport: {width: 1100, height: 900}});
  await ctx.route(/gstatic\.com|fonts\.g/, r => r.fulfill({contentType: 'text/javascript', body: ''}));
  await ctx.route(/gstatic\.com\/firebasejs\/.*app-compat/, r => r.fulfill({contentType: 'text/javascript', body: FAKE}));
  await ctx.route(/version\.json/, r => r.fulfill({contentType: 'application/json', body: '{"web":"0","apk":0}'}));
  const notes = []; await ctx.route(/ntfy\.sh/, r => { notes.push(new URL(r.request().url()).searchParams.get('title')); r.fulfill({status: 200, body: '{}', headers: {'access-control-allow-origin': '*'}}); });
  const page = async () => { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); await p.goto(F); await p.waitForTimeout(400); return p; };
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

    // Member suggests changes → admin approves
    await B.goto(F + '#edit-r-challah'); await B.waitForTimeout(300); await B.fill('#ed-n', 'Test note'); await B.click('text=Send for approval'); await B.waitForTimeout(600);
    await B.goto(F + '#r-challah'); await B.waitForTimeout(300);
    ok('suggested change not live before approval', await B.locator('text=Test note').count() === 0);
    await A.goto(F + '#review'); await A.waitForTimeout(500); await A.locator('.sub-card', {hasText: 'Challah'}).locator('[data-sact=approve]').click(); await A.waitForTimeout(800);
    await B.goto(F + '#r-challah'); await B.waitForTimeout(400);
    ok('suggested change live after approval', await B.locator('text=Test note').count() === 1);

    // Photos
    await B.goto(F + '#r-bobbys-challah'); await B.waitForTimeout(400); await B.setInputFiles('#ph-file', IMG); await B.waitForTimeout(1500);
    await B.click('#ph-send'); await B.waitForTimeout(700);
    ok('member photo waits', /Waiting for approval/.test(await B.locator('#ph-grid').innerText()));
    await A.goto(F + '#review'); await A.waitForTimeout(500); await A.click('[data-pact=ok]'); await A.waitForTimeout(800);
    await B.goto(F + '#c-bread'); await B.waitForTimeout(500);
    ok('approved photo shows on card', await B.locator('.rc.has-img').count() >= 1);

    // Favorites
    await B.goto(F + '#r-croissants'); await B.waitForTimeout(300); await B.click('#fav'); await B.waitForTimeout(300);
    await B.goto(F + '#favorites'); await B.waitForTimeout(300);
    ok('favorites work', await B.locator('.rc').count() === 1);

    // Search
    await B.goto(F); await B.waitForTimeout(300); await B.fill('#q', 'challah'); await B.waitForTimeout(300);
    ok('search finds recipes', await B.locator('.rc').count() >= 3);

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
