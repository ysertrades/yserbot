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
const app = read('web/public/app.js');
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
for (const rel of ['web/writes.js', 'web/server.js', 'web/public/app.js', 'web/public/index.html']) {
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
