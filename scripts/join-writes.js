#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const a = fs.readFileSync(path.join(root, 'scripts/writes.b64.part0'), 'utf8');
const b = fs.readFileSync(path.join(root, 'scripts/writes.b64.part1'), 'utf8');
const out = path.join(root, 'web/writes.js');
fs.writeFileSync(out, Buffer.from(a + b, 'base64'));
console.log('Restored', out, fs.statSync(out).size);
