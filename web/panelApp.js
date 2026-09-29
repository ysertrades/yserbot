'use strict';

/** Serve full panel app from local gzip packs (no outbound network). */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const N = 12;
let cache = null;

function loadLocal() {
  const parts = [];
  for (let i = 0; i < N; i++) {
    const p = path.join(__dirname, 'app.pack.' + i + '.b64');
    parts.push(fs.readFileSync(p, 'utf8'));
  }
  const body = zlib.gunzipSync(Buffer.from(parts.join(''), 'base64')).toString('utf8');
  if (!body || body.length < 100000) throw new Error('too_small');
  return body;
}

function serve(res, send) {
  try {
    if (!cache) cache = loadLocal();
    return send(res, 200, cache, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    });
  } catch (err) {
    console.error('[Panel] panel-app local load failed:', err.message || err);
    return send(res, 503, '/* panel restore failed */', {
      'content-type': 'text/javascript; charset=utf-8',
    });
  }
}

module.exports = { serve };
