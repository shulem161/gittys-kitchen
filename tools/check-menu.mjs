// Sends real "Menu ideas" requests to Gemini (Firebase AI Logic) exactly as the cookbook builds them,
// and checks the answer: valid JSON, real recipe ids, and no meat with dairy.
import { initializeApp } from 'firebase/app';
import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';
import fs from 'fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const config = JSON.parse(html.match(/\/\*FIREBASE\*\/(\{[^}]*\})/)[1]);
const models = JSON.parse((html.match(/READER_MODELS = (\[[^\]]*\])/) || [, '[]'])[1]);
const line = html.split('\n').find(l => l.startsWith('const BUNDLED='));
const RECIPES = new Function('return ' + line.slice('const BUNDLED='.length).replace(/;\s*$/, ''))();
const kindCode = html.slice(html.indexOf('const MEAT_RE'), html.indexOf('const KIND_LABEL'));
const menuCode = html.slice(html.indexOf('/*MENU-PROMPT*/'), html.indexOf('/*END-MENU-PROMPT*/'));
const lib = new Function('RECIPES', kindCode + menuCode + '; return {menuPrompt, menuCatalog, kindOf, COURSES};')(RECIPES);
const app = initializeApp(config, 'menu-check');
const ai = getAI(app, { backend: new GoogleAIBackend() });
const asks = [
  ['Chicken for Shabbos, 10 people', lib.COURSES],
  ['Beef, Yom Tov', lib.COURSES],
  ['A light dairy dinner', ['Opening', 'Main dish', 'Vegetable side dish', 'Dessert']],
];
let bad = 0;
const prompt0 = lib.menuPrompt(asks[0][0], asks[0][1], true, [], lib.menuCatalog(RECIPES));
console.log(`::notice::Prompt is ${prompt0.length} characters for ${RECIPES.length} recipes`);
for (const [q, courses] of asks) {
  const t = Date.now(); let done = false;
  for (const name of models) {
    try {
      const model = getGenerativeModel(ai, { model: name, generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }, { timeout: 75000 });
      const res = await model.generateContent([lib.menuPrompt(q, courses, true, [], lib.menuCatalog(RECIPES))]);
      const j = JSON.parse(res.response.text().trim().replace(/^```(?:json)?\s*/, '').replace(/```$/, ''));
      const picks = j.courses.map(c => ({ c: c.course, r: RECIPES.find(r => r.id === c.recipeId), name: c.name }));
      const kinds = new Set(picks.filter(p => p.r).map(p => lib.kindOf(p.r)).filter(k => k !== 'other'));
      const missing = picks.filter(p => !p.r).length;
      const summary = picks.map(p => `${p.c}: ${p.r ? p.r.t + ' [' + lib.kindOf(p.r) + ']' : '(' + p.name + ')'}`).join(' · ');
      const mixed = kinds.size > 1;
      if (mixed) bad++;
      console.log(`::${mixed ? 'error' : 'notice'}::"${q}" via ${name} in ${((Date.now() - t) / 1000).toFixed(1)}s, ${picks.length} courses, ${missing} without a cookbook recipe${mixed ? ', MIXES MEAT AND DAIRY' : ''}: ${j.title} → ${summary}`);
      done = true; break;
    } catch (e) { console.log(`::warning::"${q}" with ${name}: ${String(e && (e.message || e)).replace(/\s+/g, ' ').slice(0, 300)}`); }
  }
  if (!done) { bad++; console.log(`::error::"${q}": no model answered`); }
}
process.exit(bad ? 1 : 0);
