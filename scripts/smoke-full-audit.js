'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const fails = []; const warns = []; const ok = [];
function fail(msg) { fails.push(msg); }
function warn(msg) { warns.push(msg); }
function pass(msg) { ok.push(msg); }
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}
function rel(p) { return path.relative(root, p); }
const files = walk(root);
let syntaxFail = 0;
for (const f of files) {
  try {
    require('child_process').execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    syntaxFail++;
    fail(`syntax ${rel(f)}: ${(e.stderr || e.message || '').toString().split('\n')[0]}`);
  }
}
if (!syntaxFail) pass(`syntax ok (${files.length} files)`);
let missReq = 0;
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  const re = /require\(['"](\.[^'"]+)['"]\)/g;
  let m;
  while ((m = re.exec(t))) {
    let target = path.resolve(path.dirname(f), m[1]);
    if (!target.endsWith('.js')) {
      if (fs.existsSync(target + '.js')) target += '.js';
      else if (fs.existsSync(path.join(target, 'index.js'))) target = path.join(target, 'index.js');
      else { missReq++; fail(`missing require ${rel(f)} → ${m[1]}`); }
    } else if (!fs.existsSync(target)) { missReq++; fail(`missing require ${rel(f)} → ${m[1]}`); }
  }
}
if (!missReq) pass('relative requires resolve');
const cmdFiles = walk(path.join(root, 'commands'));
let cmdOk = 0;
for (const f of cmdFiles) {
  const mod = fs.readFileSync(f, 'utf8');
  if (mod.includes('buildGatherCommand')) { cmdOk++; continue; }
  if (!/module\.exports/.test(mod)) { warn(`command no exports: ${rel(f)}`); continue; }
  if (!/\bdata\b/.test(mod) || !/\bexecute\b/.test(mod)) warn(`command may lack data/execute: ${rel(f)}`);
  else cmdOk++;
}
pass(`commands scanned ${cmdFiles.length} (ok-ish ${cmdOk})`);
const app = fs.readFileSync(path.join(root, 'web/public/app.js'), 'utf8');
const writes = fs.readFileSync(path.join(root, 'web/writes.js'), 'utf8');
const posts = new Set([...app.matchAll(/post\(\s*['"]([a-z0-9_]+)['"]/gi)].map(m => m[1].toLowerCase()));
const handlers = new Set();
for (const m of writes.matchAll(/async\s+([a-z0-9_]+)\s*\(\s*guildId/gi)) handlers.add(m[1].toLowerCase());
for (const m of writes.matchAll(/['"]([a-z0-9_]+)['"]\s*:\s*async/gi)) handlers.add(m[1].toLowerCase());
const deadSocial = ['social', 'socialaccount', 'socialpost', 'socialtest'];
const missing = [...posts].filter(p => !handlers.has(p) && !deadSocial.includes(p));
const socialLeftover = [...posts].filter(p => deadSocial.includes(p));
if (missing.length) fail(`panel post() without writes handler: ${missing.join(', ')}`);
else pass(`panel post actions covered (${posts.size} posts, ${handlers.size} handlers)`);
if (socialLeftover.length) warn(`dead social post() still in app.js: ${socialLeftover.join(', ')}`);
const html = fs.readFileSync(path.join(root, 'web/public/index.html'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
for (const id of ['tpl-index', 'composer-body', 'sched-composer', 'reply-composer', 'members-roster', 'form-whop', 'form-featuretoggles']) {
  if (!ids.includes(id)) fail(`critical html id missing: ${id}`);
  else if (!app.includes(id)) fail(`critical id never referenced in app.js: ${id}`);
  else pass(`host #${id}`);
}
const ft = fs.readFileSync(path.join(root, 'utils/featureToggles.js'), 'utf8');
const gated = new Set([...ft.matchAll(/commands:\s*\[([^\]]*)\]/g)].flatMap(m =>
  [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map(x => x[1])));
const onDisk = new Set();
for (const f of cmdFiles) {
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(/\.setName\(\s*['"]([a-z0-9-]+)['"]\s*\)/g)) onDisk.add(m[1]);
  for (const m of t.matchAll(/commandName:\s*['"]([a-z0-9-]+)['"]/g)) onDisk.add(m[1]);
}
const gatedMissing = [...gated].filter(c => !onDisk.has(c));
if (gatedMissing.length) warn(`feature-gated names not on disk: ${gatedMissing.join(', ')}`);
else pass(`all gated command names present on disk (${gated.size})`);
const ready = fs.readFileSync(path.join(root, 'events/ready.js'), 'utf8');
for (const name of ['startWhopRunner', 'startScheduleRunner', 'startLotteryRunner', 'seedDefaultContent']) {
  if (!ready.includes(name)) fail(`ready.js missing ${name}`);
  else pass(`ready starts ${name}`);
}
const css = fs.readFileSync(path.join(root, 'web/public/app.css'), 'utf8');
const o = (css.match(/\{/g) || []).length;
const c = (css.match(/\}/g) || []).length;
if (o !== c) fail(`app.css braces {=${o} }=${c}`);
else pass(`app.css braces balanced (${o})`);
console.log('=== smoke-full-audit ===');
for (const line of ok) console.log('  OK   ', line);
for (const line of warns) console.log('  WARN ', line);
for (const line of fails) console.log('  FAIL ', line);
console.log(`\n${ok.length} ok, ${warns.length} warnings, ${fails.length} failures`);
if (fails.length) process.exitCode = 1;
