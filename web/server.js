'use strict';
/* Temporary loader: full server.js is stored gzip+base64 (upload size limit). */
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const packed = fs.readFileSync(path.join(__dirname, 'server.pack.b64'), 'utf8');
const code = zlib.gunzipSync(Buffer.from(packed, 'base64')).toString('utf8');
new Function('require', 'module', 'exports', '__dirname', '__filename', code)(
  require, module, exports, __dirname, __filename
);
