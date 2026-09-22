#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

console.log('=== apply giveaway prize features ===');

// --- app.css: softer grid ---
{
  const p = path.join(root, 'web/public/app.css');
  let t = fs.readFileSync(p, 'utf8');
  const before = t;
  t = t.replace(/rgba\(255,\s*255,\s*255,\s*0\.022\)/g, 'rgba(255, 255, 255, 0.0028)');
  if (!t.includes('.roster-entries')) {
    t += `
.roster-name-row{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap}
.roster-entries{font-size:.68rem;font-weight:600;letter-spacing:.02em;padding:.12rem .45rem;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.55);white-space:nowrap}
.roster-entries.is-bonus{background:rgba(34,51,245,.18);border-color:rgba(77,92,255,.35);color:#a8b0ff}
.prize-image-row{display:flex;align-items:center;gap:.65rem;flex-wrap:wrap;margin-top:.55rem}
.prize-image-name{font-size:.78rem;color:rgba(255,255,255,.5)}
`;
  }
  fs.writeFileSync(p, t);
  console.log(t === before ? 'app.css unchanged' : 'app.css grid + badges OK');
}

// --- giveaway.js: sendPrizeDm imageOpts ---
{
  const p = path.join(root, 'commands/utility/giveaway.js');
  let t = fs.readFileSync(p, 'utf8');
  if (!t.includes('imageOpts = null')) {
    t = t.replace(
      'async function sendPrizeDm(guild, shortId, text, onlyWinnerId = null) {',
      'async function sendPrizeDm(guild, shortId, text, onlyWinnerId = null, imageOpts = null) {'
    );
    t = t.replace(
      `let sent = 0;
  for (const id of winners) {
    try {
      const user = await guild.client.users.fetch(id);
      // Plain text only — no embed, no separator lines
      await user.send({ content: body.slice(0, 1800) });
      sent += 1;
    } catch { /* DMs closed */ }
  }`,
      `let files = [];
  try {
    const { buildPrizeFiles } = require('../../utils/gawPrizeAttach');
    files = await buildPrizeFiles(imageOpts);
  } catch (err) {
    console.warn('[GIVEAWAY] prize image:', err.message || err);
  }
  let sent = 0;
  for (const id of winners) {
    try {
      const user = await guild.client.users.fetch(id);
      const payload = { content: body.slice(0, 1800) };
      if (files.length) payload.files = files;
      await user.send(payload);
      sent += 1;
    } catch { /* DMs closed */ }
  }`
    );
  }
  if (!t.includes('function ticketsForMember')) {
    const marker = 'async function buildWeightedPool(entrantIds, guild, bonusRoleId)';
    const idx = t.indexOf(marker);
    if (idx >= 0) {
      const after = t.indexOf('\nasync function ', idx + 10);
      const end = after > 0 ? after : t.indexOf('\n// ──', idx + 10);
      const insert = `
function normalizeBonusRoles(bonusRoleId, bonusRoles) {
  const out = [];
  const seen = new Set();
  if (Array.isArray(bonusRoles)) {
    for (const r of bonusRoles) {
      const id = r && r.id != null ? String(r.id) : null;
      if (!id || seen.has(id)) continue;
      let extra = Number(r.extra);
      if (!Number.isInteger(extra) || extra < 1) extra = 1;
      if (extra > 10) extra = 10;
      seen.add(id);
      out.push({ id, extra });
    }
  }
  if (!out.length && bonusRoleId) {
    out.push({ id: String(bonusRoleId), extra: typeof BONUS_ROLE_EXTRA !== 'undefined' ? BONUS_ROLE_EXTRA : 1 });
  }
  return out;
}
function ticketsForMember(member, bonusList) {
  let tickets = typeof BASE_TICKETS !== 'undefined' ? BASE_TICKETS : 1;
  if (member?.roles?.cache && bonusList.length) {
    for (const b of bonusList) {
      if (member.roles.cache.has(b.id)) tickets += b.extra;
    }
  }
  const max = typeof MAX_TICKETS_PER_USER !== 'undefined' ? MAX_TICKETS_PER_USER : 3;
  return Math.min(max, Math.max(1, tickets));
}
async function buildWeightedPool(entrantIds, guild, bonusRoleId, bonusRoles) {
  const ids = Array.isArray(entrantIds) ? [...new Set(entrantIds.map(String))] : [];
  if (!ids.length) return [];
  const bonusList = normalizeBonusRoles(bonusRoleId, bonusRoles);
  const pool = [];
  let members = null;
  if (bonusList.length && guild?.members) {
    try {
      if (guild.members.fetch) await guild.members.fetch({ user: ids }).catch(() => null);
      members = guild.members.cache;
    } catch { members = guild.members.cache; }
  }
  for (const id of ids) {
    const m = members?.get(id) || null;
    const tickets = ticketsForMember(m, bonusList);
    for (let i = 0; i < tickets; i++) pool.push(id);
  }
  return pool;
}
`;
      if (end > idx) t = t.slice(0, idx) + insert + t.slice(end);
    }
  }
  t = t.replace(
    /await buildWeightedPool\(data\.entrants, guild, data\.bonusRoleId\)/g,
    'await buildWeightedPool(data.entrants, guild, data.bonusRoleId, data.bonusRoles || null)'
  );
  if (!t.includes('module.exports.ticketsForMember')) {
    t = t.replace(
      'module.exports.sendPrizeDm = sendPrizeDm;',
      'module.exports.sendPrizeDm = sendPrizeDm;\nmodule.exports.buildWeightedPool = buildWeightedPool;\nmodule.exports.ticketsForMember = ticketsForMember;\nmodule.exports.normalizeBonusRoles = normalizeBonusRoles;'
    );
  }
  fs.writeFileSync(p, t);
  console.log('giveaway.js OK');
}

// --- app.js: giftcard + image + entries badge ---
{
  const p = path.join(root, 'web/public/app.js');
  let t = fs.readFileSync(p, 'utf8');

  if (!t.includes('roster-entries')) {
    const old = `        const info = el('div', 'roster-info');
        info.append(el('span', 'roster-name', p.tag || p.id));
        const bits = [
          p.accountAgeDays != null ? \`Age \${p.accountAgeDays}d\` : null,
          p.serverJoinDays != null ? \`Server \${p.serverJoinDays}d\` : null,
          p.young ? 'Young' : null,
        ].filter(Boolean);
        info.append(el('span', 'roster-sub', bits.join(' · ') || p.id));
        row.append(info);`;
    const neu = `        const info = el('div', 'roster-info');
        const nameRow = el('div', 'roster-name-row');
        nameRow.append(el('span', 'roster-name', p.tag || p.id));
        const entries = Math.max(1, Number(p.entries) || 1);
        const ent = el('span', 'roster-entries' + (entries > 1 ? ' is-bonus' : ''), entries === 1 ? '1 entry' : (entries + ' entries'));
        if (entries > 1) ent.title = 'Base 1 + ' + (entries - 1) + ' bonus from role';
        nameRow.append(ent);
        info.append(nameRow);
        const bits = [
          p.accountAgeDays != null ? \`Age \${p.accountAgeDays}d\` : null,
          p.serverJoinDays != null ? \`Server \${p.serverJoinDays}d\` : null,
          p.young ? 'Young' : null,
        ].filter(Boolean);
        info.append(el('span', 'roster-sub', bits.join(' · ') || p.id));
        row.append(info);`;
    if (t.includes(old)) { t = t.replace(old, neu); console.log('  entries badge OK'); }
    else console.log('  entries badge MISS');
  } else console.log('  entries badge already present');

  if (!t.includes('giftcard')) {
    t = t.replace(
      "let mode = 'code'; // code | followup | custom",
      "let mode = 'code'; // code | giftcard | followup | custom\n    let prizeImageData = null;\n    let prizeImageName = '';"
    );
    t = t.replace(
      "[['code', 'Checkout code'], ['followup', 'Mod follow-up'], ['custom', 'Custom message']]",
      "[['code', 'Checkout code'], ['giftcard', 'Gift card'], ['followup', 'Mod follow-up'], ['custom', 'Custom message']]"
    );
    t = t.replace(
      "codeBox.style.display = mode === 'code' ? '' : 'none';",
      "codeBox.style.display = (mode === 'code' || mode === 'giftcard') ? '' : 'none';\n          const _cl = codeBox.querySelector('label');\n          const _ci = codeBox.querySelector('input');\n          if (_cl) _cl.textContent = mode === 'giftcard' ? 'Gift card code' : 'Checkout / redeem code';\n          if (_ci) _ci.placeholder = mode === 'giftcard' ? 'e.g. XXXX-XXXX-XXXX-XXXX' : 'e.g. SAVE50-WEEKEND';"
    );
    if (!t.includes('prize-image-row')) {
      const needle = 'body.push(codeBox);';
      const imgBlock = `body.push(codeBox);

    const imgRow = el('div', 'prize-image-row field');
    imgRow.append(el('label', null, 'Optional image (full quality)');
    const imgInput = el('input');
    imgInput.type = 'file';
    imgInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
    const imgName = el('span', 'prize-image-name', 'No image');
    imgInput.addEventListener('change', () => {
      const file = imgInput.files && imgInput.files[0];
      prizeImageData = null;
      prizeImageName = '';
      if (!file) { imgName.textContent = 'No image'; return; }
      if (file.size > 7.5 * 1024 * 1024) { imgName.textContent = 'Too large (max ~7.5MB)'; return; }
      const reader = new FileReader();
      reader.onload = () => {
        prizeImageData = String(reader.result || '');
        prizeImageName = file.name || 'prize.png';
        imgName.textContent = prizeImageName + ' · full quality';
      };
      reader.readAsDataURL(file);
    });
    imgRow.append(imgInput);
    imgRow.append(imgName);
    body.push(imgRow);`;
      if (t.includes(needle)) {
        t = t.replace(needle, imgBlock);
        console.log('  image upload row OK');
      }
    }
    console.log('  giftcard mode OK');
  } else console.log('  giftcard already present');

  if (!t.includes('Your quantlab gift card is ready')) {
    const re = /if \(mode === 'code'\) \{[\s\S]*?Your code:[\s\S]*?\n      \}/;
    const m = t.match(re);
    if (m) {
      const gift = `if (mode === 'giftcard') {
        return (
          \`🎁 Your quantlab gift card is ready!\\n\\n\`
          + \`**Drop:** \\\`\${dropRef}\\\`\\n\`
          + \`**Prize:** \${prizeName}\\n\`
          + \`**Gift card code:**\\n\\\`\${codeVal}\\\`\\n\\n\`
          + \`Redeem it on the store. Keep this message private.\`
        );
      }
      ` + m[0];
      t = t.replace(re, gift);
      console.log('  giftcard buildMessage OK');
    } else console.log('  giftcard buildMessage MISS');
  }
  if (!t.includes('if (prizeImageData) payload.imageData')) {
    const oldP = `          const payload = { shortId: x.shortId, text };
          if (w.id) payload.winnerId = String(w.id);
          const out = await post('giveawaysendprize', payload);`;
    const newP = `          const payload = { shortId: x.shortId, text };
          if (w.id) payload.winnerId = String(w.id);
          if (prizeImageData) payload.imageData = prizeImageData;
          const out = await post('giveawaysendprize', payload);`;
    if (t.includes(oldP)) {
      t = t.replace(oldP, newP);
      console.log('  imageData payload OK');
    } else console.log('  imageData payload MISS');
  }
  t = t.replace(
    "mode === 'code' ? 'Enter the checkout code first.'",
    "(mode === 'code' || mode === 'giftcard') ? 'Enter the code first.'"
  );

  fs.writeFileSync(p, t);
  console.log('app.js written');
}

console.log('Done. Run: node --check commands/utility/giveaway.js && node --check web/public/app.js');
