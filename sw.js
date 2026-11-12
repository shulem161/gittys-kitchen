// Gitty's Kitchen offline support: keeps a copy of the cookbook for use without internet.
const CACHE = "gk-v4.38";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // The owner's preview (/preview/) is left alone: it never touches the live site's saved copy.
  if (url.pathname.includes("/preview/")) return;
  // The page itself: always try for the newest version, fall back to the saved copy offline.
  if (req.mode === "navigate" || (url.origin === location.origin && CORE.some(p => url.pathname.endsWith(p.slice(1)) && p !== "./"))) {
    const saved = () => caches.match(req.mode === "navigate" ? "./index.html" : req).then(r => r || caches.match("./index.html"));
    const net = fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req.mode === "navigate" ? "./index.html" : req, copy)); }
      return res;
    });
    e.waitUntil(net.catch(() => {}));   // the newest copy is still saved when it arrives late
    // On a weak signal, don't wait: after 3 seconds use the saved copy if there is one.
    const slow = new Promise(ok => setTimeout(ok, 3000)).then(saved).then(r => r || net);
    e.respondWith(Promise.race([net, slow]).catch(saved).then(r => r || saved()));
    return;
  }
  // Firebase libraries and fonts: use the saved copy, refresh it in the background.
  if (url.hostname === "www.gstatic.com" || url.hostname.startsWith("fonts.")) {
    e.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(res => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })));
  }
  // Everything else (the online member list and recipes) goes straight to the network.
});
