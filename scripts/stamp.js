#!/usr/bin/env node
// Stamps each script tag in index.html with a short hash of its file (js/app.js?v=1a2b3c4d).
// GitHub Pages lets phones keep files for 10 minutes, so without it a phone that just loaded
// the new page could run it with the old scripts. With it, a changed script has a new address
// and is fetched fresh, while unchanged ones stay cached.
// Run it after changing any file under js/:   node scripts/stamp.js
// (node tests/core.test.js fails while a stamp is out of date.)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const TAG = /<script src="(js\/[\w.-]+\.js)(?:\?v=[0-9a-f]*)?"><\/script>/g;

function hashOf(src) {
  return crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, src))).digest('hex').slice(0, 8);
}
// index.html with every script tag stamped with its file's current hash.
function stamped(html) {
  return html.replace(TAG, (m, src) => `<script src="${src}?v=${hashOf(src)}"></script>`);
}

if (require.main === module) {
  const html = fs.readFileSync(INDEX, 'utf8'), out = stamped(html);
  const n = (html.match(TAG) || []).length;
  if (out === html) console.log(`✓ index.html: all ${n} script stamps are current`);
  else { fs.writeFileSync(INDEX, out); console.log(`✓ index.html: stamped ${n} scripts`); }
}
module.exports = { stamped, hashOf };
