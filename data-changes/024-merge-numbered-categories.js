// Owner's request (2026-11-26): categories like "Cakes 1" and "Cookies 1" were made by mistake from file names
// such as cakes_1.pdf (the number was read as part of the category). Merge each one into its real category
// ("Cakes 1" → "Cakes"): recipes (with a new number in the real category, the old one kept as an old number),
// "Also in" lists, recipes still waiting in the inboxes, and the list of added categories.
// The category's code number stays taken, so it's never given to another category.
const n2 = v => String(+v).padStart(2, '0');
module.exports = async (db) => {
  const codesRef = db.collection('meta').doc('codes');
  const map = (await codesRef.get()).data() || {};
  const cats = map.cats || {}, added = map.added || [];
  const recs = await db.collection('recipes').get(), subs = await db.collection('submissions').get();
  const known = new Set([...Object.keys(cats), ...added, ...recs.docs.map(d => d.data().c).filter(Boolean)]);
  const lower = new Map([...known].map(c => [c.toLowerCase(), c]));
  const baseOf = c => { const m = /^(.*?)[\s_-]*\(?\d{1,2}\)?$/.exec(String(c || '').trim()); return m && m[1] && m[1].toLowerCase() !== String(c).toLowerCase() ? lower.get(m[1].toLowerCase()) : null; };
  const merge = new Map([...known].map(c => [c, baseOf(c)]).filter(([c, b]) => b && b !== c));
  if (!merge.size) return 'No numbered duplicate categories found';
  // next free number in a category: above every number ever used there (recipes, old numbers, held numbers)
  const holds = await db.collection('codeholds').get().catch(() => ({ docs: [] }));
  const used = new Set([...recs.docs.flatMap(d => [d.data().code, ...(d.data().oldCodes || []).map(o => o.code)]), ...holds.docs.map(d => d.id)].filter(Boolean));
  const nextCode = base => { const p = '1' + n2(cats[base] || 99); let n = 0;
    used.forEach(c => { if (c.length === 6 && c.startsWith(p)) n = Math.max(n, +c.slice(3)); });
    const code = p + String(n + 1).padStart(3, '0'); used.add(code); return code; };
  const writes = []; let nr = 0, ns = 0, na = 0;
  for (const d of recs.docs) {
    const r = d.data(), up = {};
    if (merge.has(r.c)) { const to = merge.get(r.c); up.c = to; if (r.code && cats[to]) { up.oldCodes = [...(r.oldCodes || []), { code: r.code, at: Date.now() }].slice(-12); up.code = nextCode(to); } nr++; }
    if (Array.isArray(r.also) && r.also.some(x => merge.has(x))) { up.also = [...new Set(r.also.map(x => merge.get(x) || x))].filter(x => x !== (up.c || r.c)); na++; }
    if (Object.keys(up).length) writes.push(b => b.update(d.ref, up));
  }
  for (const d of subs.docs) {
    const x = d.data(), up = {};
    if (merge.has(x.c)) { up.c = merge.get(x.c); ns++; }
    if (Array.isArray(x.also) && x.also.some(y => merge.has(y))) up.also = [...new Set(x.also.map(y => merge.get(y) || y))].filter(y => y !== (up.c || x.c));
    if (Object.keys(up).length) writes.push(b => b.update(d.ref, up));
  }
  writes.push(b => b.set(codesRef, { added: added.filter(c => !merge.has(c)) }, { merge: true }));
  for (let i = 0; i < writes.length; i += 400) { const batch = db.batch(); writes.slice(i, i + 400).forEach(w => w(batch)); await batch.commit(); }
  return `Merged ${[...merge].map(([a, b]) => `"${a}" into "${b}"`).join(', ')}: ${nr} recipes, ${ns} waiting recipes, ${na} "Also in" lists`;
};
