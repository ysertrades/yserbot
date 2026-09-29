'use strict';
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const dir = __dirname;
const parts = [0, 1, 2].map((i) => fs.readFileSync(path.join(dir, 'server.pack.' + i + '.b64'), 'utf8'));
const code = zlib.gunzipSync(Buffer.from(parts.join(''), 'base64')).toString('utf8');
new Function('require', 'module', 'exports', '__dirname', '__filename', code)(
  require, module, exports, __dirname, __filename
);
