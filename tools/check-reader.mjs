// Sends one small request to the recipe reader (Gemini through Firebase AI Logic),
// exactly as the cookbook does, and reports whether it works.
import { initializeApp } from 'firebase/app';
import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';
import fs from 'fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const config = JSON.parse(html.match(/\/\*FIREBASE\*\/(\{[^}]*\})/)[1]);
const app = initializeApp(config, 'check');
const ai = getAI(app, { backend: new GoogleAIBackend() });
const model = getGenerativeModel(ai, { model: (html.match(/model:"([^"]+)"/)||[])[1], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } });
try {
  const res = await model.generateContent('Return JSON {"title": string, "items": [string]} for this recipe: "Honey Cake. 2 cups flour, 1 cup honey, 3 eggs. Bake at 350 for 1 hour."');
  console.log('::notice::Recipe reader works. Answer: ' + res.response.text().replace(/\s+/g, ' ').slice(0, 300));
} catch (e) {
  console.log('::error::Recipe reader failed: ' + String(e && (e.message || e)).replace(/\s+/g, ' ').slice(0, 900));
  process.exit(1);
}
