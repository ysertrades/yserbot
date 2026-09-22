#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'web/public/app.js');
let t = fs.readFileSync(p, 'utf8');
const bad = "imgRow.append(el('label', null, 'Optional image (full quality)');";
const good = "imgRow.append(el('label', null, 'Optional image (full quality)'));";
if (!t.includes(bad)) {
  if (t.includes(good)) {
    console.log('already fixed');
    process.exit(0);
  }
  console.error('pattern not found — app.js may differ');
  process.exit(1);
}
t = t.split(bad).join(good);
fs.writeFileSync(p, t);
console.log('fixed missing paren in prize image label');
