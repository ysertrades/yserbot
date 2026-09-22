const fs = require('fs');
const path = require('path');
const parts = [];
for (let i = 0; ; i++) {
  const f = path.join(__dirname, 'xp-engine-part' + i + '.b64');
  if (!fs.existsSync(f)) break;
  parts.push(Buffer.from(fs.readFileSync(f, 'utf8'), 'base64'));
}
const out = Buffer.concat(parts);
fs.writeFileSync(path.join(__dirname, '..', 'utils', 'levelingEngine.js'), out);
console.log('assembled', out.length);
