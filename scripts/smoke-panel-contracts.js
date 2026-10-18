'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const fails = []; const ok = [];
function fail(id, msg) { fails.push(`[${id}] ${msg}`); }
function pass(id, msg) { ok.push(`[${id}] ${msg}`); }
function mustInclude(id, text, needle, hint) {
  if (!text.includes(needle)) fail(id, `missing ${JSON.stringify(needle)}${hint ? ` — ${hint}` : ''}`);
  else pass(id, `has ${JSON.stringify(needle).slice(0, 60)}`);
}
function mustMatch(id, text, re, hint) {
  if (!re.test(text)) fail(id, `pattern ${re} failed${hint ? ` — ${hint}` : ''}`);
  else pass(id, `matched ${re}`);
}
function mustNotMatch(id, text, re, hint) {
  if (re.test(text)) fail(id, `forbidden pattern ${re}${hint ? ` — ${hint}` : ''}`);
  else pass(id, `absent ${re}`);
}
const api = read('web/api.js');
// The panel's code. web/public/app.js is only a 14-line load check, so every
// panel contract below used to be tested against the wrong file and fail.
const app = read('web/public/app.full.js');
const css = read('web/public/app.css');
const html = read('web/public/index.html');
const whopWeb = read('web/whop.js');
const whopFeed = read('utils/whopFeed.js');
const whopRunner = read('utils/whopRunner.js');
const auth = read('web/auth.js');
const writes = read('web/writes.js');
const interaction = read('events/interactionCreate.js');
const help = read('commands/system/help.js');
const featureToggles = read('utils/featureToggles.js');
// The landing page and sign-in screen carry decorative 3D pieces that bleed
// past their boxes. Without these guards the page grows wider than a phone's
// screen and the browser draws everything zoomed out.
const homeCss = read('web/public/landing/home.css');
const loginCss = read('web/public/login.css');
mustMatch('overflow.home', homeCss, /^html \{[^}]*overflow-x: clip/m, 'landing page must never scroll sideways');
mustMatch('overflow.hero', homeCss, /\.hero \{[^}]*overflow-x: clip/, 'hero must clip its tilted stage');
mustMatch('overflow.login', loginCss, /\.view\[data-view="login"\] \.lg \{[^}]*overflow: hidden auto/, 'sign-in screen scrolls vertically only');
// The launch splash hands over with one cross-fade. Each of these broke it:
// timing the hold off an animation clock (stalls with frames, stops at its
// end: seconds of dead screen), hiding the page under the splash (leaks via
// visibility:visible !important, shows as a stuck empty screen), and fading
// #main in from 0 as the splash fades out (both layers transparent: a blink).
const bootFn = (app.match(/function bootReady\(\) \{[\s\S]*?\r?\n\}/) || [''])[0];
mustMatch('boot.exists', bootFn, /boot\.classList\.add\('out'\)/, 'bootReady must lift the splash');
mustNotMatch('boot.clock', bootFn, /getAnimations|currentTime/, 'time the splash with performance.now(), not an animation clock');
mustNotMatch('boot.raf', bootFn, /requestAnimationFrame/, 'a paused webview never runs rAF; use timers');
mustNotMatch('boot.hide', html, /:has\(#boot\)[^{]*\{[^}]*visibility:\s*hidden/, 'do not hide the page under the splash');
mustNotMatch('boot.dip', html, /html\.booted #main\{animation/, 'do not fade #main in while the splash fades out');
// The landing page's panel window tilts with scroll. It shook when the code
// measured the element it transforms (its own tilt moved its rect), read
// innerHeight (iOS changes it as the toolbar returns on scroll-up), and had a
// CSS transition fighting the per-frame easing.
const homeJs = read('web/public/landing/home.js');
mustNotMatch('tilt.self', homeJs, /win\.getBoundingClientRect/, 'measure the untransformed wrapper, not the tilted window');
mustNotMatch('tilt.transition', homeCss, /\.window \{[^}]*transition:\s*transform/, 'no CSS transition on the scroll-driven window');
mustMatch('intro.land', homeJs, /setTimeout\(startReveals, LAND\)/, 'the hero lands while the intro lifts, not after it');
// Scroll jank and flicker. Each of these made something lag behind the scroll
// or flicker on phones: a live blur on a sticky bar (re-blurs what scrolls
// under it every frame; on iOS it trails), a `fixed` page background (iOS
// repaints the page with it), keyframes that move left/top/width/height
// (layout every frame), and blur in entrance animations (re-rasterised per frame).
const allCss = ['app.css', 'shell-am.css', 'desk.css', 'login.css', 'landing/home.css'].map(f => read('web/public/' + f)).join('\n');
const ruleFor = (text, sel) => (text.match(new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}', 'g')) || []).join('\n');
for (const [file, text, sels] of [['app.css', css, ['.bar', '.sidebar']], ['home.css', homeCss, ['.nav']], ['desk.css', read('web/public/desk.css'), ['.desk-head']]]) {
  for (const s of sels) mustNotMatch(`jank.stickyblur.${s}`, ruleFor(text, s), /backdrop-filter:\s*blur/, `${file} ${s}: no live blur on a sticky bar`);
}
mustNotMatch('jank.fixedbg', homeCss, /background[^;]*\)\s*fixed\b|background-attachment:\s*fixed/, 'landing: no background-attachment fixed (use a fixed layer)');
// Each @keyframes block exactly (its steps are one level of nested braces).
const layoutKeys = [...allCss.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)]
  .filter(m => /(^|[{;\s])(left|top|width|height)\s*:/.test(m[2])).map(m => m[1]);
if (layoutKeys.length) fail('jank.layoutkeys', `keyframes animate left/top/width/height: ${layoutKeys.join(', ')} (use transform)`);
else pass('jank.layoutkeys', 'no keyframes animate layout properties');
mustNotMatch('jank.revealblur', homeCss, /\.js \.reveal \{[^}]*filter/, 'landing reveals: opacity and rise only');
mustNotMatch('jank.enterblur', read('web/public/shell-am.css'), /@keyframes bu-enter \{[^}]*filter/, 'panel entrance: opacity and rise only');
mustNotMatch('jank.progress', css, /\.bar::after \{[^}]*transition:\s*width/, 'header progress line: scale it, do not transition its width');
// The tab icon on Safari/iOS. Safari asks for /apple-touch-icon.png on its own
// and draws the domain's first letter (a "Y") when it can't get an icon; it
// also ignores data: URL icons, so the live icon script must leave it alone.
const serverJs = read('web/server.js');
mustInclude('icon.touchroute', serverJs, "p === '/apple-touch-icon.png'", 'serve /apple-touch-icon.png');
for (const f of ['index.html', 'home.html', 'verify.html', 'terms.html', 'privacy.html']) {
  mustInclude(`icon.touchlink.${f}`, read('web/public/' + f), 'href="/apple-touch-icon.png"', `${f} links the touch icon`);
}
mustMatch('icon.safariskip', read('web/public/favicon-live.js'), /if \(ios \|\| safari\) return;/, 'favicon-live.js must not run on Safari/iOS');
// The sidebar: light icons, a collapse toggle, a rail on PC, a swipeable drawer
// on the phone, all without backdrop-filter (scroll jank).
const sbCss = read('web/public/sidebar.css'), sbJs = read('web/public/sidebar.js');
mustInclude('sidebar.loaded', html, 'href="/sidebar.css"', 'index.html loads sidebar.css');
mustInclude('sidebar.script', html, 'src="/sidebar.js"', 'index.html loads sidebar.js');
mustMatch('sidebar.toggle', html, /id="sb-toggle"[^>]*aria-controls="sections"/, 'the collapse toggle is in the sidebar');
mustMatch('sidebar.lighticons', sbCss, /svg\.nav-ico \{[^}]*stroke-width: 1\.5 !important/, 'nav icons draw at 1.5px');
mustMatch('sidebar.rail', sbCss, /\[data-sb="rail"\] \{ --sidebar-w: 76px; \}/, 'PC rail width');
mustNotMatch('sidebar.noblur', sbCss, /backdrop-filter/, 'no backdrop-filter in the sidebar');
mustInclude('sidebar.navapi', read('web/public/shell-am.js'), 'window.__openNav = openNav;', 'shell-am.js exposes openNav for the swipe');
mustMatch('sidebar.lsguard', sbJs, /try \{ return localStorage\.getItem/, 'sidebar state read is guarded');
// The link card Discord builds when /home or the panel is shared: a large
// image, a title and a description, and an absolute image URL (crawlers
// don't resolve relative ones). The image file itself must ship.
for (const f of ['home.html', 'index.html']) {
  const head = read('web/public/' + f).split('</head>')[0];
  for (const tag of ['og:title', 'og:description', 'og:image']) mustMatch(`og.${f}.${tag}`, head, new RegExp(`property="${tag}" content="[^"]{8,}"`), `${f} needs ${tag}`);
  mustMatch(`og.${f}.absolute`, head, /property="og:image" content="https:\/\//, `${f}: og:image must be an absolute https URL`);
  mustInclude(`og.${f}.large`, head, 'name="twitter:card" content="summary_large_image"', `${f}: large image card`);
}
mustMatch('og.image.file', String(require('fs').existsSync(require('path').join(root, 'web/public/og-home.png'))), /true/, 'web/public/og-home.png must exist');
mustInclude('health.api', api, 'uptimeMs:', 'health() must expose uptimeMs');
mustInclude('health.api', api, 'memoryMb:', 'health() must expose memoryMb');
mustInclude('health.api', api, 'renderCache', 'health() must expose renderCache');
mustInclude('health.ui', app, 'h.uptimeMs', 'renderHealth must read uptimeMs');
mustInclude('health.ui', app, 'h.memoryMb', 'renderHealth must read memoryMb');
mustInclude('health.ui', app, 'c.hits', 'renderHealth must read renderCache.hits');
mustNotMatch('health.drift', api, /return \{[\s\S]*?\buptime:\s*[^M]/, 'do not return bare uptime without uptimeMs');
mustMatch('composer.await', api, /composer:\s*await\s+composer\.list\s*\(/, 'overview must await composer.list');
mustNotMatch('composer.bare', api, /composer:\s*composer\.list\s*\([^)]*\)\s*,/, 'bare composer.list Promise forbidden');
mustInclude('composer.array', app, 'Array.isArray(raw)', 'composer consumers must Array.isArray');
mustInclude('composer.templateOptions', app, 'function templateOptions', 'templateOptions required');
mustMatch('composer.templateOptions.safe', app, /function templateOptions\(\)\s*\{[\s\S]*?Array\.isArray/, 'templateOptions must guard array');
mustInclude('auth.staff', auth, 'staffGuildsFor', 'staffGuildsFor must exist');
mustInclude('api.me.staff', api, 'staffGuildsFor', 'me() must use staffGuildsFor');
mustNotMatch('api.me.accessible', api, /accessibleGuilds/, 'accessibleGuilds must not be called');
mustInclude('nav.sync', app, 'function syncFeatureNav', 'syncFeatureNav required');
mustInclude('nav.sync.call', app, 'syncFeatureNav()', 'syncFeatureNav must be invoked');
mustInclude('nav.feed', html, 'data-goto="feeds"', 'feeds nav');
mustInclude('nav.gaw', html, 'data-goto="giveaways"', 'giveaways nav');
mustInclude('nav.auto', html, 'data-goto="automation"', 'automation nav');
mustMatch('whop.api.min', whopWeb, /n\s*<\s*0\.25|n\s*<\s*\.25/, 'web/whop.js min poll must be 0.25');
mustNotMatch('whop.api.oldmin', whopWeb, /n\s*<\s*2\s*\|\|/, 'old min 2 minutes must not remain');
mustInclude('whop.feed.clamp', whopFeed, '0.25', 'whopFeed clamp includes 0.25');
mustInclude('whop.runner.tick', whopRunner, 'TICK_MS', 'runner tick present');
for (const id of ['sched-list', 'sched-composer', 'reply-list', 'reply-composer', 'tpl-index', 'composer-body', 'members-roster']) {
  mustInclude(`html.${id}`, html, `id="${id}"`, `panel host #${id}`);
}
mustInclude('render.sched', app, 'function renderSchedules', 'renderSchedules');
mustInclude('render.reply', app, 'function renderAutoreplies', 'renderAutoreplies');
mustInclude('render.composer', app, 'function renderComposer', 'renderComposer');
mustInclude('render.members', app, 'renderMembersRoster', 'members roster');
mustInclude('ft.groups', featureToggles, 'FEATURE_GROUPS', 'feature groups');
mustInclude('ft.enabled', featureToggles, 'isFeatureEnabled', 'isFeatureEnabled');
mustInclude('help.filter', help, 'enabledOnly', 'help filters disabled features');
mustInclude('ix.feature', interaction, 'isFeatureEnabled', 'execute path feature gate');
for (const op of ['featuretoggles', 'memberrole', 'memberdm', 'giveawaystart', 'autoreply']) {
  mustMatch(`writes.${op}`, writes, new RegExp(`async\\s+${op}\\s*\\(|'${op}'\\s*:`), `writes handler ${op}`);
}
const openB = (css.match(/\{/g) || []).length;
const closeB = (css.match(/\}/g) || []).length;
if (openB !== closeB) fail('css.brace', `unbalanced braces {=${openB} }=${closeB}`);
else pass('css.brace', `balanced ${openB}`);
mustInclude('css.mobile', css, 'overflow-x: clip', 'mobile overflow lock');
mustInclude('writes.imageupload', writes, 'imageupload', 'imageupload handler');

mustMatch('panelLog.shape', api, /panelLog:\s*\{[\s\S]*?categories:[\s\S]*?values:/, 'panelLog must expose categories + values');
mustInclude('channellock.writes', writes, 'channellock', 'channellock write op');
mustInclude('channellock.server', read('web/server.js'), "op === 'channellock'", 'server skips overview for channellock');
mustInclude('lock.modes', read('commands/moderation/lock.js'), "value: 'media'", 'lock default media');
mustNotMatch('lock.chatonly', read('commands/moderation/lock.js'), /Chat only/, 'lock must not offer Chat only');
mustInclude('econcal.weekly', api, 'weekly:', 'econcal exposes weekly object for Feeds tab');
for (const rel of ['web/writes.js', 'web/server.js', 'web/public/app.full.js', 'web/public/index.html']) {
  const head = read(rel).slice(0, 200);
  if (/PLACEHOLDER_WILL_BE_REPLACED|LOADING_FROM_DISK/.test(head)) fail('placeholder.' + rel, rel + ' starts with PLACEHOLDER');
  else pass('placeholder.' + rel, rel + ' not placeholder');
  const sz = fs.statSync(path.join(root, rel)).size;
  if (sz < 1000) fail('size.' + rel, rel + ' too small (' + sz + ')');
  else pass('size.' + rel, rel + ' size ' + sz);
}

console.log('=== smoke-panel-contracts ===');
for (const line of ok) console.log('  OK  ', line);
for (const line of fails) console.log('  FAIL', line);
console.log(`\n${ok.length} passed, ${fails.length} failed`);
if (fails.length) process.exitCode = 1;
