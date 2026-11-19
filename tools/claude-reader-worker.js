// Gitty's Kitchen – Claude reader (a Cloudflare Worker)
// When Google's reader refuses a recipe photo or file, the app can ask Claude to read it through this Worker.
// The Anthropic key stays here as a secret (ANTHROPIC_API_KEY) and never goes into the app's public code.
// Only signed-in, approved members of Gitty's Kitchen can use it: their sign-in is checked with Firebase.
//
// Set up (Cloudflare dashboard → Workers & Pages → Create → Worker → paste this file → Deploy), then under
// Settings → Variables and Secrets add:  ANTHROPIC_API_KEY  (type: Secret)
// Optional variables: MODEL (default claude-sonnet-5-5), ALLOWED_ORIGIN (default https://shulem161.github.io)

const PROJECT = "gittys-kitchen";

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGIN || "https://shulem161.github.io").split(",").map(s => s.trim());
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    };
    const out = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method === "GET") return out(200, { ok: true, ready: !!env.ANTHROPIC_API_KEY });
    if (req.method !== "POST") return out(405, { error: "POST only" });
    if (!allowed.includes(origin)) return out(403, { error: "Not allowed from this site" });
    if (!env.ANTHROPIC_API_KEY) return out(500, { error: "The Anthropic key isn't set up in the Worker yet" });

    // Who is asking: an approved member of Gitty's Kitchen (Firebase checks the sign-in token itself)
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    let uid = "";
    try { uid = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).user_id || ""; } catch (e) {}
    if (!uid) return out(401, { error: "Please sign in first" });
    const u = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/users/${encodeURIComponent(uid)}`,
      { headers: { Authorization: "Bearer " + token } });
    if (!u.ok) return out(401, { error: "Please sign in first" });
    const me = await u.json();
    if ((((me.fields || {}).status) || {}).stringValue !== "approved") return out(403, { error: "Only approved members can use this" });

    // What to read: the instructions, and the photos or file
    let body;
    try { body = await req.json(); } catch (e) { return out(400, { error: "Bad request" }); }
    const files = Array.isArray(body.files) ? body.files.slice(0, 12) : [];
    if (!body.prompt || !files.length) return out(400, { error: "Nothing to read" });
    const content = [];
    for (const f of files) {
      if (f.text) content.push({ type: "text", text: String(f.text).slice(0, 200000) });
      else if (f.mime === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } });
      else if (/^image\/(jpeg|png|gif|webp)$/.test(f.mime || "")) content.push({ type: "image", source: { type: "base64", media_type: f.mime, data: f.data } });
    }
    content.push({ type: "text", text: String(body.prompt).slice(0, 30000) });

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.MODEL || "claude-sonnet-5-5", max_tokens: 16000, messages: [{ role: "user", content }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return out(r.status === 429 || r.status >= 500 ? 503 : 502, { error: (j.error && j.error.message) || "Claude couldn't read it" });
    const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
    return out(200, { text, truncated: j.stop_reason === "max_tokens" });
  },
};
