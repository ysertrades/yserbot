'use strict';

/** Same-origin emergency panel app restore (CSP blocks CDN). */
const https = require('node:https');

const PANEL_APP_SRC =
  'https://raw.githubusercontent.com/ysertrades/yserbot/cf3277b2cde73a9f153a225f03a517f81b4063f5/web/public/app.js';

let cache = null;
const TTL = 60 * 60 * 1000;

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'yserbot-panel-restore' } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        return fetchText(r.headers.location).then(resolve, reject);
      }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        if (r.statusCode !== 200) return reject(new Error('http_' + r.statusCode));
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      r.on('error', reject);
    }).on('error', reject);
  });
}

async function serve(res, send) {
  try {
    const now = Date.now();
    if (!cache || now - cache.at > TTL) {
      let body = await fetchText(PANEL_APP_SRC);
      if (!body || body.length < 100000) throw new Error('too_small');
      if (!body.includes('window.state = state')) {
        const inject = '\nwindow.state = state;\n';
        const needle = 'gawBump: null,';
        const idx = body.indexOf(needle);
        if (idx !== -1) {
          const close = body.indexOf('};', idx);
          if (close !== -1) body = body.slice(0, close + 2) + inject + body.slice(close + 2);
          else body += inject;
        } else body += inject;
      }
      cache = { body, at: now };
    }
    return send(res, 200, cache.body, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    });
  } catch (err) {
    console.error('[Panel] panel-app restore failed:', err.message || err);
    return send(res, 503, '/* panel restore failed */', {
      'content-type': 'text/javascript; charset=utf-8',
    });
  }
}

module.exports = { serve };
