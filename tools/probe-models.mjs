// Tries several Gemini models with a small photo request and reports which answer, and how fast.
import { initializeApp } from 'firebase/app';
import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';
import fs from 'fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const config = JSON.parse(html.match(/\/\*FIREBASE\*\/(\{[^}]*\})/)[1]);
const ai = getAI(initializeApp(config, 'probe'), { backend: new GoogleAIBackend() });
const img = fs.readFileSync(new URL('samples/recipe-photo.jpg', import.meta.url)).toString('base64');
const names = ['gemini-3.8-flash-lite', 'gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3-flash', 'gemini-3-flash-lite', 'gemini-2.5-flash-lite', 'gemini-3.8-flash'];
await Promise.all(names.map(async n => {
  const m = getGenerativeModel(ai, { model: n, generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }, { timeout: 60000 });
  const t = Date.now();
  try {
    const r = await m.generateContent(['Return JSON {"title":string,"ingredients":[string]} for the recipe in this photo.', { inlineData: { data: img, mimeType: 'image/jpeg' } }]);
    console.log(`::notice::${n}: OK in ${((Date.now() - t) / 1000).toFixed(1)}s → ${r.response.text().replace(/\s+/g, ' ').slice(0, 110)}`);
  } catch (e) { console.log(`::warning::${n}: ${((Date.now() - t) / 1000).toFixed(1)}s ${String(e.message || e).replace(/.*generateContent: /, '').replace(/\s+/g, ' ').slice(0, 150)}`); }
}));
