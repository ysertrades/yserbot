#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const aPath = path.join(dir, '_lvl_a.txt');
const bPath = path.join(dir, '_lvl_b.txt');
if (!fs.existsSync(aPath) || !fs.existsSync(bPath)) {
  console.error('Missing scripts/_lvl_a.txt or scripts/_lvl_b.txt');
  console.error('Restore base UI: git show 9d7c0aaa:web/public/leveling-ui.js > web/public/leveling-ui.js');
  process.exit(1);
}
const text = fs.readFileSync(aPath, 'utf8') + fs.readFileSync(bPath, 'utf8');
if (!text.includes('paintBoardBody') || !text.includes('startLiveBoard')) {
  console.error('stitch failed integrity check');
  process.exit(1);
}
const target = path.join(dir, '..', 'web', 'public', 'leveling-ui.js');
fs.writeFileSync(target, text);
console.log('Live XP ladder written to', target, text.length, 'bytes');
