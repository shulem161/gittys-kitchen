// Takes phone-size screenshots of each design (with the real web fonts) for choosing a look.
import { chromium } from 'playwright';
import fs from 'fs';
const FAKE = fs.readFileSync('tests/fake-firebase.js', 'utf8');
const F = 'file://' + process.cwd() + '/index.html';
const LOOKS = ['classic', 'warm', 'garden', 'shabbos', 'modern'];
fs.mkdirSync('previews', {recursive: true});
const b = await chromium.launch();
const ctx = await b.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2});
await ctx.route(/www\.gstatic\.com\/firebasejs|version\.json|ntfy/, r => r.fulfill({contentType: 'text/javascript', body: ''}));
await ctx.route(/www\.gstatic\.com\/firebasejs\/.*app-compat/, r => r.fulfill({contentType: 'text/javascript', body: FAKE}));
const p = await ctx.newPage();
await p.goto(F); await p.waitForTimeout(800);
await p.click('[data-mode=create]'); await p.fill('#nm', 'Shulem'); await p.fill('#pw', 'admin123'); await p.fill('#pw2', 'admin123'); await p.click('.primary'); await p.waitForTimeout(1200);
const ib = await p.$('#importbtn'); if (ib) { await ib.click(); await p.waitForTimeout(1500); }
for (const l of LOOKS) {
  await p.goto(F + '?look=' + l); await p.waitForTimeout(1500);
  await p.screenshot({path: `previews/${l}-1-home.png`});
  await p.evaluate(() => window.scrollTo(0, document.querySelector('.cats').getBoundingClientRect().top + scrollY - 70)); await p.waitForTimeout(300);
  await p.screenshot({path: `previews/${l}-2-categories.png`});
  await p.goto(F + '?look=' + l + '#c-cakes'); await p.waitForTimeout(800);
  await p.screenshot({path: `previews/${l}-3-category.png`});
  await p.goto(F + '?look=' + l + '#r-bobbys-challah'); await p.waitForTimeout(800);
  await p.screenshot({path: `previews/${l}-4-recipe.png`});
  console.log('done', l);
}
await b.close();
