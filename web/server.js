'use strict';

/**
 * web/server.js
 *
 * The control panel's HTTP server, running inside the bot process.
 *
 * Sharing the process is deliberate. Storage is an in-memory cache warmed once
 * at boot (utils/mongoStorage.js), so a separate process would read a snapshot
 * the bot had already moved past, and its writes would be overwritten by the
 * bot's next flush. In here, the panel and the slash commands are looking at
 * exactly the same objects.
 *
 * The cost of that choice is that a fault in here can take the bot down with
 * it, so nothing in this file is allowed to throw into the process: every
 * handler is wrapped, the listener has its own error handling, and a failure
 * to bind the port is logged and shrugged off rather than fatal.
 */

const http = require('node:http');
const fs   = require('node:fs');
const path = require('node:path');

const auth    = require('./auth');
const api     = require('./api');
const owner   = require('./owner');
const preview = require('./preview');
const live    = require('./live');
const { generateAppIcon } = require('../utils/appIconVisual');
const { memoizeRender } = require('../utils/renderCache');

const ICON_SIZES = [180, 192, 512];
const appIcon = memoizeRender(generateAppIcon, { name: 'appIcon', max: ICON_SIZES.length });

const writes   = require('./writes');
const calendar = require('./calendar');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const RATE_LIMIT = { windowMs: 60_000, max: 120 };

const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || rec.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
    return false;
  }
  rec.count++;
  return rec.count > RATE_LIMIT.max;
}

function csp() {
  const { frameAncestors } = auth.config();
  return [
    "default-src 'self'",
    "img-src 'self' data: blob: https:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors.length ? frameAncestors.join(' ') : "'none'"}`,
    "base-uri 'none'",
  ].join('; ');
}

function send(res, status, body, headers = {}) {
  if (res.writableEnded) return;
  res.writeHead(status, {
    'content-security-policy': csp(),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function json(res, status, data, headers = {}) {
  send(res, status, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8', ...headers });
}

function redirect(res, location, headers = {}) {
  send(res, 302, '', { location, ...headers });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const onData = chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.off('data', onData);
        req.resume();
        reject(new Error('body_too_large'));
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('bad_json')); }
    });
    req.on('error', reject);
  });
}

function popupPage(token) {
  const base = auth.config().baseUrl;
  const safe = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<title>Signed in</title></head>`
    + `<body data-token="${safe(token)}" data-origin="${safe(base)}" style="background:#0B0D11;color:#E8EBF1;font:15px system-ui;padding:2rem">`
    + `Signed in. You can close this window.<script src="/popup.js"></script></body></html>`;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

function serveStatic(res, urlPath, { orPanel = false } = {}) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    return send(res, 403, 'Forbidden', { 'content-type': 'text/plain' });
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      if (orPanel) return serveStatic(res, '/');
      return send(res, 404, 'Not found', { 'content-type': 'text/plain' });
    }
    send(res, 200, buf, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  });
}

async function route(req, res, client) {
  const url = new URL(req.url, 'http://internal');
  const p = url.pathname;

  if (p === '/healthz') return json(res, 200, { ok: true });
  if (p === '/terms' || p === '/terms/') return serveStatic(res, 'terms.html');
  if (p === '/privacy' || p === '/privacy/') return serveStatic(res, 'privacy.html');

  const iconMatch = /^\/icon-(\d{2,4})\.png$/.exec(p);
  if (iconMatch) {
    const size = Number(iconMatch[1]);
    if (!ICON_SIZES.includes(size)) return send(res, 404, 'Not found', { 'content-type': 'text/plain' });
    return send(res, 200, appIcon(size), {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=604800',
    });
  }

  if (p === '/auth/login') {
    const missing = auth.missingConfig();
    if (missing.length) return json(res, 503, { error: 'setup_incomplete', missing });
    const { url: to, state } = auth.authorizeUrl({
      popup: url.searchParams.get('popup') === '1',
      handoff: url.searchParams.get('h'),
    });
    return redirect(res, to, { 'set-cookie': auth.cookie(auth.STATE_COOKIE, state, auth.STATE_TTL_MS) });
  }

  if (p === '/auth/callback') {
    const missing = auth.missingConfig();
    if (missing.length) return json(res, 503, { error: 'setup_incomplete', missing });
    const code  = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const cookieState = auth.parseCookies(req)[auth.STATE_COOKIE];
    if (!code || !state || state !== cookieState || !auth.verify(state, auth.config().secret)) {
      return redirect(res, '/?error=bad_state', { 'set-cookie': auth.clearCookie(auth.STATE_COOKIE) });
    }
    const stateData = auth.verify(state, auth.config().secret) || {};
    try {
      const { token } = await auth.completeLogin(code, client);
      const cookies = [auth.clearCookie(auth.STATE_COOKIE), auth.cookie(auth.SESSION_COOKIE, token, auth.SESSION_TTL_MS)];
      if (stateData.h) auth.parkHandoff(stateData.h, token);
      if (stateData.popup) return send(res, 200, popupPage(token), { 'content-type': 'text/html; charset=utf-8', 'set-cookie': cookies });
      return redirect(res, '/', { 'set-cookie': cookies });
    } catch (err) {
      const reason = err.code === 'no_manageable_guilds' ? 'no_access' : 'login_failed';
      if (reason === 'login_failed') console.error('[Panel] login failed:', err.message);
      return redirect(res, `/?error=${reason}`, { 'set-cookie': auth.clearCookie(auth.STATE_COOKIE) });
    }
  }

  if (p === '/auth/handoff') {
    const token = auth.collectHandoff(url.searchParams.get('h'));
    return json(res, token ? 200 : 404, token ? { token } : { error: 'not_ready' });
  }

  if (p === '/auth/logout') {
    const clear = { 'set-cookie': auth.clearCookie(auth.SESSION_COOKIE) };
    if (req.method !== 'POST') return redirect(res, '/', clear);
    const session = auth.sessionFor(req);
    if (session?.uid) auth.revokeSessions(session.uid);
    return json(res, 200, { ok: true }, clear);
  }

  if (p.startsWith('/api/')) {
    const missing = auth.missingConfig();
    if (missing.length) return json(res, 503, { error: 'setup_incomplete', missing });
    const session = auth.sessionFor(req)
      || (/^\/api\/guild\/\d{5,25}\/stream$/.test(p) ? auth.sessionForToken(url.searchParams.get('t')) : null);
    if (!session) return json(res, 401, { error: 'not_authenticated' });

    if (p === '/api/me') {
      const renewed = auth.refreshed(session);
      const plant = renewed || auth.adoptable(req);
      const headers = plant ? { 'set-cookie': auth.cookie(auth.SESSION_COOKIE, plant, auth.SESSION_TTL_MS) } : {};
      const csrfSession = renewed ? auth.verify(renewed, auth.config().secret) : session;
      return json(res, 200, { ...api.me(session, client), csrf: auth.csrfFor(csrfSession), token: renewed || null }, headers);
    }
    if (p === '/api/health')    return json(res, 200, api.health(client));
    if (p === '/api/templates') return json(res, 200, { templates: preview.listTemplates() });

    if (p === '/api/embed-link') {
      if (req.method !== 'POST' && req.method !== 'DELETE') return json(res, 405, { error: 'use_post_or_delete' });
      if (!auth.csrfValid(session, req.headers['x-csrf-token'])) return json(res, 403, { error: 'bad_csrf' });
      if (req.method === 'DELETE') { auth.revokeEmbedLinks(session.uid); return json(res, 200, { revoked: true }); }
      const token = auth.mintEmbedLink(session);
      return json(res, 200, { url: `${auth.config().baseUrl}/?embed=${encodeURIComponent(token)}` });
    }

    const guildMatch = /^\/api\/guild\/(\d{5,25})(?:\/(.*))?$/.exec(p);
    if (guildMatch) {
      const guildId = guildMatch[1];
      const rest = guildMatch[2] || '';
      if (!session.guildIds?.includes(guildId) && !session.isOwner) {
        return json(res, 403, { error: 'forbidden' });
      }

      if (rest === 'stream') {
        return live.handle(req, res, client, session, guildId);
      }

      if (req.method === 'GET' && rest === '') {
        try {
          const data = await api.guildOverview(guildId, client, session);
          return json(res, 200, data);
        } catch (err) {
          console.error('[Panel] overview', err);
          return json(res, 500, { error: 'overview_failed', detail: String(err.message || err).slice(0, 120) });
        }
      }

      if (req.method === 'POST' && rest) {
        const op = rest;
        if (!auth.csrfValid(session, req.headers['x-csrf-token'])) return json(res, 403, { error: 'bad_csrf' });
        let body;
        try { body = await readJsonBody(req); }
        catch (err) { return json(res, err.message === 'body_too_large' ? 413 : 400, { error: err.message }); }

        const guild = client.guilds.cache.get(guildId);
        const result = await writes.apply(op, guildId, body, { client, session, guild });
        if (result.error) return json(res, 400, result);

        const light = op === 'bot-profile-global' || op === 'bot-profile-nick' || op === 'bot-profile-presence' || op === 'channellock';
        let overview = null;
        try {
          overview = await api.guildOverview(guildId, client, session, { skipMembers: light });
        } catch (err) {
          console.error('[Panel] overview after write failed:', err);
        }
        return json(res, 200, { ...result, overview });
      }

      return json(res, 404, { error: 'unknown_endpoint' });
    }

    if (p === '/api/owner' || p.startsWith('/api/owner/')) {
      return owner.handle(req, res, client, session, p, readJsonBody);
    }

    return json(res, 404, { error: 'unknown_endpoint' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method not allowed', { 'content-type': 'text/plain' });
  }

  if (rateLimited(req.socket.remoteAddress || 'unknown')) {
    return send(res, 429, 'Too many requests', { 'content-type': 'text/plain' });
  }

  const session = auth.sessionFor(req);
  if (!session && p === '/') {
    return serveStatic(res, 'login.html');
  }
  if (!session && !p.includes('.')) {
    return redirect(res, '/auth/login');
  }

  return serveStatic(res, p, { orPanel: !path.extname(p) });
}

function start(client, port = Number(process.env.PANEL_PORT) || 3000) {
  const server = http.createServer((req, res) => {
    route(req, res, client).catch((err) => {
      console.error('[Panel] route error:', err);
      if (!res.writableEnded) json(res, 500, { error: 'internal' });
    });
  });
  server.on('error', (err) => console.error('[Panel] server error:', err));
  server.listen(port, () => console.log(`[Panel] listening on :${port}`));
  return server;
}

module.exports = { start };
