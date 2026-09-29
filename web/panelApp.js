'use strict';

/** Panel app restore: local packs first, then GitHub with hard timeout. */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const https = require('node:https');

const PANEL_APP_SRC =
  'https://raw.githubusercontent.com/ysertrades/yserbot/cf3277b2cde73a9f153a225f03a517f81b4063f5/web/public/app.js';
const LOCAL_N = 28;
let cache = null;

function injectState(body) {
  if (body.includes('window.state = state')) return body;
  // Append only — never splice mid-file (breaks JS and leaves panel on Loading).
  return body + '\n;window.state = state;\n';
}

function loadLocal() {
  const first = path.join(__dirname, 'app.pack.0.b64');
  if (!fs.existsSync(first)) return null;
  const parts = [];
  for (let i = 0; i < LOCAL_N; i++) {
    const p = path.join(__dirname, 'app.pack.' + i + '.b64');
    if (!fs.existsSync(p)) return null;
    parts.push(fs.readFileSync(p, 'utf8'));
  }
  const body = zlib.gunzipSync(Buffer.from(parts.join(''), 'base64')).toString('utf8');
  if (!body || body.length < 100000) return null;
  return injectState(body);
}

function fetchRemote() {
  return new Promise((resolve, reject) => {
    const req = https.get(PANEL_APP_SRC, { headers: { 'user-agent': 'yserbot-panel-restore' } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume();
        return fetchRemoteUrl(r.headers.location).then(resolve, reject);
      }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        if (r.statusCode !== 200) return reject(new Error('http_' + r.statusCode));
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      r.on('error', reject);
    });
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

function fetchRemoteUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'yserbot-panel-restore' } }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        if (r.statusCode !== 200) return reject(new Error('http_' + r.statusCode));
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      r.on('error', reject);
    });
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

async function serve(res, send) {
  try {
    if (!cache) {
      let body = loadLocal();
      if (!body) {
        body = injectState(await fetchRemote());
        if (!body || body.length < 100000) throw new Error('too_small');
      }
      cache = body;
    }
    return send(res, 200, cache, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    });
  } catch (err) {
    console.error('[Panel] panel-app failed:', err.message || err);
    return send(res, 503, '/* panel restore failed: ' + String(err.message || err).slice(0, 80) + ' */', {
      'content-type': 'text/javascript; charset=utf-8',
    });
  }
}

module.exports = { serve };
