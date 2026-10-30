// Owner's request (3.94): spell out tablespoon and teaspoon in every recipe (no tbsp / tsp).
// Spell out tbsp/tsp ("2 tbsp" → "2 tablespoons", "½ tsp" → "½ teaspoon")
const SU_FRAC = {"½":.5,"¼":.25,"¾":.75,"⅓":1/3,"⅔":2/3,"⅛":.125,"⅜":.375,"⅝":.625,"⅞":.875};
function suVal(s){ s=String(s).trim(); let m;
  if((m=s.match(/^(\d+)\s(\d+)\/(\d+)$/))) return +m[1] + m[2]/m[3];
  if((m=s.match(/^(\d+)\/(\d+)$/))) return m[1]/m[2];
  if((m=s.match(/^(\d+(?:\.\d+)?)\s?([½¼¾⅓⅔⅛⅜⅝⅞])$/))) return +m[1] + SU_FRAC[m[2]];
  if(SU_FRAC[s]!==undefined) return SU_FRAC[s];
  return parseFloat(s); }
function spellUnits(text){
  return String(text).replace(/\b(tbsps?|tbls?|tblsp|tbs|tsps?|tspn)\b/gi, (tok, w, off, all)=>{
    const tea=/^ts/i.test(w), before=all.slice(Math.max(0,off-30), off);
    const N="(?:\\d+(?:\\.\\d+)?\\s?[½¼¾⅓⅔⅛⅜⅝⅞]|\\d+\\s\\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞])";
    const m=before.match(new RegExp("("+N+")(?:\\s*(?:-|–|to|or)\\s*("+N+"))?\\s*(?:heaping|heaped|level|scant|rounded|generous|good|large|small|full|big)?\\s*$","i"));
    let plural=false;
    if(m){ plural = !!m[2] || suVal(m[1])>1; }
    else if(/\b(a|an|one|per|each|the|1)\s+(heaping |level |scant |rounded |generous |good |large |small |full |big )?$/i.test(before)) plural=false;
    else if(/\b(two|three|four|five|six|several|few|some|more|extra)\s+(heaping |level |scant |rounded |generous |good |large |small |full |big )?$/i.test(before)) plural=true;
    let word=(tea?"teaspoon":"tablespoon")+(plural?"s":"");
    if(/^[A-Z]/.test(tok) && !m && (off===0 || /[.\n:]\s*$/.test(before))) word=word[0].toUpperCase()+word.slice(1);
    return word;
  }).replace(/\b([Tt]ablespoons?|[Tt]easpoons?)\.(?=\s*[a-z0-9(,;)])/g, "$1");
}
module.exports = async (db) => {
  const snap = await db.collection('recipes').get();
  const todo = []; let lines = 0;
  for (const d of snap.docs) {
    const r = d.data(); if (!Array.isArray(r.s)) continue;
    let changed = false;
    const s = r.s.map(sec => Object.assign({}, sec, {items: (sec.items || []).map(it => { const o = spellUnits(it); if (o !== it) { changed = true; lines++; } return o; })}));
    const upd = {s};
    if (r.n) { const n = spellUnits(r.n); if (n !== r.n) { upd.n = n; changed = true; } }
    if (changed) todo.push([d.ref, upd]);
  }
  for (let i = 0; i < todo.length; i += 400) {
    const batch = db.batch();
    todo.slice(i, i + 400).forEach(([ref, upd]) => batch.update(ref, upd));
    await batch.commit();
  }
  return `${lines} lines in ${todo.length} recipes now say tablespoon / teaspoon`;
};
