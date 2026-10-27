// Sends real requests to the recipe reader (Gemini through Firebase AI Logic), the same way the
// cookbook does: a recipe photo, a PDF and a Word document's text. Reports timing and any error.
import { initializeApp } from 'firebase/app';
import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';
import fs from 'fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const config = JSON.parse(html.match(/\/\*FIREBASE\*\/(\{[^}]*\})/)[1]);
const modelName = JSON.parse((html.match(/READER_MODELS = (\[[^\]]*\])/) || [,"[]"])[1])[0];
const genCfg = { responseMimeType: "application/json", temperature: 0.2 };
const app = initializeApp(config, 'check');
const ai = getAI(app, { backend: new GoogleAIBackend() });
const model = getGenerativeModel(ai, { model: modelName, generationConfig: genCfg });
const prompt = 'You are helping a family put recipes into their cookbook app. Read the recipe(s) and return ONLY JSON {"recipes":[{"title":string,"category":string,"from":string,"note":string,"parts":[{"type":"ingredients"|"method","heading":string,"items":[string]}]}]}. Keep the family wording; one ingredient per item; one step per item.';
const s = f => fs.readFileSync(new URL('samples/' + f, import.meta.url));
const tests = [
  ['photo', { inlineData: { data: s('recipe-photo.jpg').toString('base64'), mimeType: 'image/jpeg' } }],
  ['PDF', { inlineData: { data: s('Bread.pdf').toString('base64'), mimeType: 'application/pdf' } }],
];
let bad = 0;
console.log(`::notice::Model ${modelName}, settings ${JSON.stringify(genCfg)}`);
for (const [name, part] of tests) {
  const t = Date.now();
  try {
    const res = await model.generateContent([prompt, part]);
    const txt = res.response.text();
    let n = '?'; try { n = JSON.parse(txt.replace(/^```(?:json)?\s*/, '').replace(/```$/, '')).recipes.length; } catch (e) { n = 'NOT JSON: ' + txt.slice(0, 120); }
    console.log(`::notice::${name}: OK in ${((Date.now() - t) / 1000).toFixed(1)}s, recipes found: ${n}. Start: ${txt.replace(/\s+/g, ' ').slice(0, 160)}`);
  } catch (e) { bad++; console.log(`::error::${name}: FAILED after ${((Date.now() - t) / 1000).toFixed(1)}s: ${String(e && (e.message || e)).replace(/\s+/g, ' ').slice(0, 700)}`); }
}
process.exit(bad ? 1 : 0);
