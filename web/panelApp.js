'use strict';

/**
 * Serves /panel-app.js — the control panel's browser code, web/public/app.full.js.
 *
 * Only the file on disk. This used to fall back to a base64 pack and then to
 * downloading app.js from a pinned GitHub commit at runtime, which meant the
 * panel could run code that was never in the deployed tree (and the pinned
 * file was the 14-line loader, not the panel). A missing panel is now a clear
 * 503 instead of a surprise.
 */
const fs = require('node:fs');
const path = require('node:path');

const PANEL_FILE = path.join(__dirname, 'public', 'app.full.js');
let cache = null;

function injectState(body) {
  if (body.includes('window.state = state')) return body;
  // Append only — never splice mid-file (breaks JS and leaves panel on Loading).
  return body + '\n;window.state = state;\n';
}

function load() {
  const body = fs.readFileSync(PANEL_FILE, 'utf8');
  if (!body || body.length < 100000) throw new Error('panel file too small');
  return injectState(body);
}

async function serve(res, send) {
  try {
    if (!cache) cache = load();
    return send(res, 200, cache, {
      'content-type': 'text/javascript; charset=utf-8',
      // Revalidated, not stored: see send() in server.js. A reload gets a
      // 304 instead of the whole script; a deploy is picked up at once.
      'cache-control': 'no-cache',
    });
  } catch (err) {
    console.error('[Panel] panel-app failed:', err.message || err);
    return send(res, 503, '/* panel failed to load: ' + String(err.message || err).slice(0, 80) + ' */', {
      'content-type': 'text/javascript; charset=utf-8',
    });
  }
}

module.exports = { serve };
