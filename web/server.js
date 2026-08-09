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
const preview = require('./preview');
const live    = require('./live');
const { generateAppIcon } = require('../utils/appIconVisual');
const { generateSocialMark, MARK_KEYS } = require('../utils/socialMarks');
const { memoizeRender } = require('../utils/renderCache');

// 180 is what iOS asks for as an apple-touch-icon; 192 and 512 are the sizes
// Android's manifest handling expects. Memoised because the icon never
// changes at runtime, and drawing one blocks the same thread Discord uses.
const ICON_SIZES = [180, 192, 512];
const appIcon = memoizeRender(generateAppIcon, { name: 'appIcon', max: ICON_SIZES.length });

// The platform marks. Two sizes: one for the panel's own list, one for the
// author icon on a posted card. Memoised for the same reason the app icon is —
// drawing one blocks the thread Discord is on.
const MARK_SIZES = [64, 128];
const socialMark = memoizeRender(generateSocialMark, { name: 'socialMark', max: MARK_KEYS.length * MARK_SIZES.length });
const writes   = require('./writes');
const calendar = require('./calendar');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT = { windowMs: 60_000, max: 120 };

/* ─── rate limiting ──────────────────────────────────────────────────────── */

// Per-IP fixed window. Crude, but this panel has one user — it exists to blunt
// someone hammering the login endpoint, not to shape real traffic.
const hits = new Map(); // ip → { count, resetAt }

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

/* ─── responses ──────────────────────────────────────────────────────────── */

// Locked down hard: the panel loads nothing from anywhere else, so anything
// injected into a page has nothing to talk to. Avatars are the one exception,
// and they come from Discord's CDN only.
function csp() {
  // Who may embed the panel. Defaults to nobody; PANEL_FRAME_ANCESTORS opts
  // specific hosts in (Whop, typically). Built per-request rather than once at
  // load so the setting takes effect on restart without a code change.
  const { frameAncestors } = auth.config();
  return [
    "default-src 'self'",
    // blob: is needed for the Studio previews — the PNG arrives as a blob and
    // is shown via createObjectURL. Blob URLs are same-origin and minted by
    // our own script, so this doesn't widen what the page can reach.
    //
    // https: is needed because half of what the panel previews is a picture
    // somebody typed the address of — an embed's image, an author icon, a
    // social post's banner. Restricted to our own origin and Discord's CDN,
    // the browser simply refused to load any of them, so the Preview button
    // drew an embed with a hole where the picture goes and no way to tell
    // that from a URL that was wrong. It is images only, still no http://,
    // and it grants the page nothing it can read back — an <img> is opaque
    // to script from another origin.
    "img-src 'self' data: blob: https:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
    // Covered by default-src, but stated outright: a blocked manifest fails
    // silently — the install prompt just never appears, with nothing logged.
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

/** Reads a JSON body, refusing anything oversized or malformed. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const onData = chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Deliberately not req.destroy(): tearing the socket down here means
        // the 413 never reaches the client, which then sees a connection
        // error instead of a reason. Stop collecting, let the rest drain, and
        // let the route answer properly.
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

/**
 * The page a popup login lands on. It carries the token in a data attribute
 * and hands it to the opener from an external script — the CSP forbids inline
 * script, and relaxing that for one page would be a poor trade.
 */
function popupPage(token) {
  const base = auth.config().baseUrl;
  const safe = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<title>Signed in</title></head>`
    + `<body data-token="${safe(token)}" data-origin="${safe(base)}" style="background:#0B0D11;color:#E8EBF1;font:15px system-ui;padding:2rem">`
    + `Signed in. You can close this window.<script src="/popup.js"></script></body></html>`;
}

/* ─── static files ───────────────────────────────────────────────────────── */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  // Served with its registered type or the install prompt never appears.
  '.webmanifest': 'application/manifest+json',
  // Instrument Serif, self-hosted for the legal pages. Served from our own
  // origin so the panel's content policy stays at 'self' — pulling it from a
  // font CDN would have meant widening style-src and font-src for everything.
  '.woff2': 'font/woff2',
};

/**
 * @param {object} [opts]
 *   orPanel — serve the panel itself when the path names no file on disk.
 *   Only ever set for a path with no file extension; see the call site.
 */
function serveStatic(res, urlPath, { orPanel = false } = {}) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);

  // resolve() collapses any ../ before this check, so a crafted path cannot
  // escape the public directory.
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    return send(res, 403, 'Forbidden', { 'content-type': 'text/plain' });
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      // orPanel is false on the retry, so a missing index.html 404s rather
      // than recursing.
      if (orPanel) return serveStatic(res, '/');
      return send(res, 404, 'Not found', { 'content-type': 'text/plain' });
    }
    send(res, 200, buf, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  });
}

/* ─── routing ────────────────────────────────────────────────────────────── */

async function route(req, res, client) {
  const url = new URL(req.url, 'http://internal');
  const p = url.pathname;

  /* -- health: the only thing reachable without logging in ---------------- */
  if (p === '/healthz') return json(res, 200, { ok: true });

  // The legal pages, on purpose without a session and without a redirect.
  // A terms or privacy link has to open for somebody who has never logged in
  // — a reviewer, a member deciding whether to use the bot, Discord's own app
  // directory — so putting them behind the gate would defeat the point of
  // having them. Clean paths rather than /terms.html because these are the
  // addresses that get pasted into places that never change.
  if (p === '/terms' || p === '/terms/') return serveStatic(res, 'terms.html');
  if (p === '/privacy' || p === '/privacy/') return serveStatic(res, 'privacy.html');

  // Home-screen icons. Public on purpose: iOS and Android fetch these from
  // outside any session — often before one exists — so putting them behind the
  // auth gate would mean an installed app with a blank icon.
  // The platform marks, on the same terms as the icons and for the same
  // reason: Discord's CDN fetches the author icon on a posted card from
  // outside any session, so these cannot sit behind the auth gate.
  const markMatch = /^\/social\/([a-z]+)-(\d{2,4})\.png$/.exec(p);
  if (markMatch) {
    const [, key, raw] = markMatch;
    const size = Number(raw);
    if (!MARK_KEYS.includes(key) || !MARK_SIZES.includes(size)) {
      return send(res, 404, 'Not found', { 'content-type': 'text/plain' });
    }
    return send(res, 200, socialMark(key, size), {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=604800',
    });
  }

  const iconMatch = /^\/icon-(\d{2,4})\.png$/.exec(p);
  if (iconMatch) {
    const size = Number(iconMatch[1]);
    if (!ICON_SIZES.includes(size)) return send(res, 404, 'Not found', { 'content-type': 'text/plain' });
    return send(res, 200, appIcon(size), {
      'content-type': 'image/png',
      // Long-lived: the icon only changes when the brand does, and a stale one
      // on a home screen is worse than a re-fetch.
      'cache-control': 'public, max-age=604800',
    });
  }

  /* -- login ------------------------------------------------------------- */
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

    // The state must match the cookie we set AND still carry a valid
    // signature — one without the other is a replay or a forged callback.
    if (!code || !state || state !== cookieState || !auth.verify(state, auth.config().secret)) {
      return redirect(res, '/?error=bad_state', { 'set-cookie': auth.clearCookie(auth.STATE_COOKIE) });
    }

    const stateData = auth.verify(state, auth.config().secret) || {};

    try {
      const { token } = await auth.completeLogin(code, client);
      const cookies = [auth.clearCookie(auth.STATE_COOKIE), auth.cookie(auth.SESSION_COOKIE, token, auth.SESSION_TTL_MS)];

      // Park the session for the page that started this, whether or not the
      // browser kept an opener relationship. On iOS it usually does not.
      if (stateData.h) auth.parkHandoff(stateData.h, token);

      // A popup login hands the token back to the page that opened it. That
      // page is the panel running inside someone else's iframe, where the
      // cookie we just set may never be sent — Safari drops third-party
      // cookies outright. The popup itself is first-party, so this is the one
      // moment the token can cross over.
      if (stateData.popup) return send(res, 200, popupPage(token), { 'content-type': 'text/html; charset=utf-8', 'set-cookie': cookies });

      return redirect(res, '/', { 'set-cookie': cookies });
    } catch (err) {
      const reason = err.code === 'no_manageable_guilds' ? 'no_access' : 'login_failed';
      if (reason === 'login_failed') console.error('[Panel] login failed:', err.message);
      return redirect(res, `/?error=${reason}`, { 'set-cookie': auth.clearCookie(auth.STATE_COOKIE) });
    }
  }

  if (p === '/auth/handoff') {
    // Unauthenticated on purpose: this is how a page that has no session yet
    // collects one. The id is 128 bits of randomness, single use, and expires
    // in two minutes, so guessing it is the only attack and it is not viable.
    const token = auth.collectHandoff(url.searchParams.get('h'));
    return json(res, token ? 200 : 404, token ? { token } : { error: 'not_ready' });
  }

  if (p === '/auth/logout') {
    // Clearing the cookie was never enough. The same session also exists as a
    // bearer token in the browser's storage — and, inside a host app, in the
    // URL that host reloads every time it opens — and a bearer token does not
    // care what happened to a cookie. So the account's session generation is
    // bumped here, which stops every token it ever issued from verifying,
    // whatever the client managed to clear on its way out.
    //
    // sessionFor reads the bearer header first and the cookie second, which
    // matters: a plain link navigation carries only the cookie, and the tab
    // that most needs signing out is the one whose cookie was never allowed
    // in the first place. So the page sends this as a fetch carrying its
    // token, and the anchor stays as the fallback for a cookie session with
    // no JavaScript.
    //
    // Only POST revokes. A GET must never be destructive: browsers, link
    // prefetchers and scanners follow same-origin links on their own, and any
    // other site can point an <img> at this address — all of which would have
    // silently killed a live session, and a session killed a moment after
    // signing in looks exactly like signing in not working at all.
    //
    // Dropping revocation from the GET costs nothing, because the GET is the
    // fallback for a browser running no JavaScript, and without JavaScript
    // there is no bearer token to revoke — the token only ever exists because
    // a script put it in storage. For that visitor the cookie *is* the whole
    // session, so clearing it is a complete sign-out. Everyone else arrives
    // here by POST from the button, which carries the token and revokes.
    const clear = { 'set-cookie': auth.clearCookie(auth.SESSION_COOKIE) };
    if (req.method !== 'POST') return redirect(res, '/', clear);

    const session = auth.sessionFor(req);
    if (session?.uid) auth.revokeSessions(session.uid);
    return json(res, 200, { ok: true }, clear);
  }

  /* -- api (everything below requires a session) -------------------------- */
  if (p.startsWith('/api/')) {
    // Reported before the session check so a fresh install lands on the setup
    // screen rather than a sign-in button that cannot work yet.
    const missing = auth.missingConfig();
    if (missing.length) return json(res, 503, { error: 'setup_incomplete', missing });

    // EventSource cannot set request headers, so where the panel runs on a
    // bearer token rather than a cookie — inside somebody else's iframe,
    // where the cookie is blocked outright — the stream has no way to
    // present it. That one route accepts the same signed token on the query
    // string instead. It is checked by exactly the same code; nothing is
    // trusted that would not be trusted in a header.
    const session = auth.sessionFor(req)
      || (/^\/api\/guild\/\d{5,25}\/stream$/.test(p) ? auth.sessionForToken(url.searchParams.get('t')) : null);
    if (!session) return json(res, 401, { error: 'not_authenticated' });

    // The CSRF token rides along with identity so the page always has a fresh
    // one without a separate round trip.
    if (p === '/api/me') {
      // Hand back a fresh token when this one is getting old, so an account in
      // regular use is never bounced back to the sign-in screen mid-task.
      const renewed = auth.refreshed(session);
      // Either a rolled token, or the first sight of a bearer-only session
      // that has no cookie of its own yet. The second case is what keeps an
      // embedded panel signed in: the token gets written back as a partitioned
      // cookie belonging to the host page, so reopening the app finds it.
      const plant = renewed || auth.adoptable(req);
      const headers = plant ? { 'set-cookie': auth.cookie(auth.SESSION_COOKIE, plant, auth.SESSION_TTL_MS) } : {};
      // csrfFor is bound to session.exp, so it has to be computed against
      // whichever session the client is about to start using — the renewed
      // one, when there is one — or every write on this page load would fail
      // with a stale token until the next reload.
      const csrfSession = renewed ? auth.verify(renewed, auth.config().secret) : session;
      return json(res, 200, { ...api.me(session, client), csrf: auth.csrfFor(csrfSession), token: renewed || null }, headers);
    }
    if (p === '/api/health')    return json(res, 200, api.health(client));
    if (p === '/api/templates') return json(res, 200, { templates: preview.listTemplates() });

    /* -- the Whop embed link ----------------------------------------------
     * Whop reloads whatever URL sits in its own embed settings rather than
     * anything the page did on its own, so a session that needs to survive
     * the app being closed there has to live in that URL instead of in
     * browser storage. These are account-level, not guild-scoped. */
    if (p === '/api/embed-link') {
      if (req.method !== 'POST' && req.method !== 'DELETE') return json(res, 405, { error: 'use_post_or_delete' });
      if (!auth.csrfValid(session, req.headers['x-csrf-token'])) return json(res, 403, { error: 'bad_csrf' });
      if (req.method === 'DELETE') { auth.revokeEmbedLinks(session.uid); return json(res, 200, { revoked: true }); }
      const token = auth.mintEmbedLink(session);
      return json(res, 200, { url: `${auth.config().baseUrl}/?t=${token}` });
    }

    if (p === '/api/leaderboard') {
      return json(res, 200, await api.leaderboard(client, 10));
    }

    /* -- banner previews -------------------------------------------------- */
    // Generated embed art, by its dynamic:<key> key. Separate from the route
    // below because those keys are camelCase and that one is deliberately not.
    const dynamicMatch = /^\/api\/preview-image\/([A-Za-z]{1,40})$/.exec(p);
    if (dynamicMatch) {
      const forGuild = url.searchParams.get('g');
      if (forGuild && !auth.canAccessGuild(session, forGuild, client)) return json(res, 403, { error: 'forbidden' });
      const out = preview.renderDynamicImage(dynamicMatch[1], forGuild || null);
      if (!out) return json(res, 404, { error: 'unknown_image' });
      if (out.retryAfterMs) return json(res, 429, { error: 'too_fast', retryAfterMs: out.retryAfterMs });
      return send(res, 200, out.png, {
        'content-type': 'image/png',
        'content-disposition': `inline; filename="${out.filename}"`,
        'x-render-cached': String(out.cached),
      });
    }

    const previewMatch = /^\/api\/preview\/([a-z]+)$/.exec(p);
    if (previewMatch) {
      // `g` lets a preview with no copy on the query string fall back to what
      // that guild has saved. It is access-checked like any other guild read —
      // a session may not preview a server it cannot open.
      const forGuild = url.searchParams.get('g');
      if (forGuild && !auth.canAccessGuild(session, forGuild, client)) return json(res, 403, { error: 'forbidden' });
      const out = preview.render(previewMatch[1], url.searchParams, forGuild || null);
      if (!out) return json(res, 404, { error: 'unknown_template' });
      if (out.retryAfterMs) {
        // Deliberately not queued: a backlog of renders would block the bot
        // for as long as it took to drain. The client retries instead.
        return json(res, 429, { error: 'too_fast', retryAfterMs: out.retryAfterMs });
      }
      return send(res, 200, out.png, {
        'content-type': 'image/png',
        'content-disposition': `inline; filename="${out.filename}"`,
        'x-render-cached': String(out.cached),
      });
    }

    /* -- the live stream --------------------------------------------------
       Kept above the general guild route because it answers with an open
       connection rather than a document, and none of the machinery below
       applies to it. */
    const streamMatch = /^\/api\/guild\/(\d{5,25})\/stream$/.exec(p);
    if (streamMatch) {
      const guildId = streamMatch[1];
      if (!auth.canAccessGuild(session, guildId, client)) return json(res, 403, { error: 'forbidden' });
      if (req.method !== 'GET') return json(res, 405, { error: 'use_get' });
      live.subscribe(guildId, res, req, client);
      return undefined;
    }

    /* -- the week ahead ---------------------------------------------------
       Above the general guild route because that one is POST-only for
       anything with a name on the end, and this is a read. It is also the one
       read in the panel that can reach the network — the calendar mirror,
       when its three-hour cache is cold — which is exactly why it is not part
       of the overview. */
    const calendarMatch = /^\/api\/guild\/(\d{5,25})\/calendar$/.exec(p);
    if (calendarMatch) {
      const guildId = calendarMatch[1];
      if (!auth.canAccessGuild(session, guildId, client)) return json(res, 403, { error: 'forbidden' });
      if (req.method !== 'GET') return json(res, 405, { error: 'use_get' });
      try {
        return json(res, 200, await calendar.agenda(guildId));
      } catch (err) {
        // The mirror being down is a fact about the mirror, not a broken
        // panel: the card says so and everything else on the tab still works.
        console.warn('[Panel] calendar unavailable:', err.message);
        return json(res, 503, { error: 'calendar_unavailable' });
      }
    }

    /* -- guild reads and writes ------------------------------------------- */
    const guildMatch = /^\/api\/guild\/(\d{5,25})(?:\/([a-z]+))?$/.exec(p);
    if (guildMatch) {
      const [, guildId, op] = guildMatch;
      if (!auth.canAccessGuild(session, guildId, client)) return json(res, 403, { error: 'forbidden' });

      if (!op) return json(res, 200, await api.guildOverview(guildId, client));

      if (req.method !== 'POST') return json(res, 405, { error: 'use_post' });
      if (!auth.csrfValid(session, req.headers['x-csrf-token'])) return json(res, 403, { error: 'bad_csrf' });

      let body;
      try { body = await readJsonBody(req); }
      catch (err) { return json(res, err.message === 'body_too_large' ? 413 : 400, { error: err.message }); }

      const guild = client.guilds.cache.get(guildId);
      const result = await writes.apply(op, guildId, body, { client, session, guild });
      if (result.error) return json(res, 400, result);
      // Hand back the refreshed overview so the page never has to guess what
      // the write actually produced.
      return json(res, 200, { ...result, overview: await api.guildOverview(guildId, client) });
    }

    return json(res, 404, { error: 'unknown_endpoint' });
  }

  /* -- the page itself ---------------------------------------------------- */
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method not allowed', { 'content-type': 'text/plain' });
  }

  // The panel is one page, so an address that names no file is still the
  // panel. Without this only "/" answered, and every host that mounts an app
  // at a path of its own got a plain-text "Not found" inside its frame —
  // Whop's default is /experiences/[experienceId], which is not a file here
  // and never will be. The same rule covers reloading a deep link and an
  // installed home-screen app reopening on the address it was closed at.
  //
  // Gated on there being no file extension, which is the difference between a
  // page and an asset. A missing /app.js has to stay a 404: answering it with
  // the HTML instead would hand the browser a page where it asked for a
  // script, and it would fail as a syntax error pointing nowhere near the
  // real problem.
  return serveStatic(res, p, { orPanel: !path.extname(p) });
}

/* ─── lifecycle ──────────────────────────────────────────────────────────── */

function start(client) {
  const port = Number(process.env.SERVER_PORT) || 3000;

  const server = http.createServer((req, res) => {
    // Behind Caddy, so the client address is the proxy — the forwarded header
    // is what identifies the caller for rate limiting.
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

    if (rateLimited(ip)) return json(res, 429, { error: 'rate_limited' });

    // Body size is capped inside readJsonBody, which is the only thing that
    // consumes the stream. A second listener here would read the same chunks
    // and race it to the 413.
    Promise.resolve(route(req, res, client)).catch(err => {
      console.error('[Panel] request failed:', err);
      if (!res.writableEnded) json(res, 500, { error: 'internal_error' });
    });
  });

  // A socket error must not reach the process — an unhandled 'error' here
  // would be an uncaught exception, and the bot would go offline with it.
  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  server.on('error', err => {
    console.error(`[Panel] server error (bot keeps running):`, err.message);
  });

  server.listen(port, '0.0.0.0', () => {
    const missing = auth.missingConfig();
    console.log(`[Panel] listening on 0.0.0.0:${port}`);
    if (missing.length) {
      console.warn(`[Panel] login is disabled until these are set: ${missing.join(', ')}`);
    } else {
      console.log(`[Panel] ${auth.config().baseUrl}`);
    }

    // Said out loud, because the failure is otherwise invisible from this end.
    // With nothing set, the panel answers every request with
    // `frame-ancestors 'none'` and a host page gets a blank frame with the
    // reason buried in a browser console nobody is looking at. One line here
    // is the difference between "it did not work" and knowing why.
    const { frameAncestors } = auth.config();
    if (frameAncestors.length) {
      console.log(`[Panel] Embedding allowed from: ${frameAncestors.join(' ')}`);
    } else {
      console.log('[Panel] Embedding is off — no host page may frame this panel. '
        + 'Set PANEL_FRAME_ANCESTORS to the host origins (e.g. "https://whop.com https://*.whop.com") to allow it.');
    }
  });

  return server;
}

module.exports = { start };
