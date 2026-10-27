# Gitty's Kitchen tests

`node tests/run-all.js` runs the live `index.html` through the main flows (joining, approval,
recipe editing, member recipes and suggested changes, photos, favorites, search, phone layout,
offline) against a stand-in for Firebase. It never touches the real member list or recipes.
Needs Node and Playwright with Chromium.
