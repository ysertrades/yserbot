#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'web', 'public', 'app.js');
let t = fs.readFileSync(file, 'utf8');
const checks = [];

function replace(old, neu, name) {
  if (!t.includes(old)) {
    if (t.includes(neu.slice(0, 80))) { console.log('already:', name); return; }
    console.error('MISSING block:', name);
    process.exit(1);
  }
  t = t.replace(old, neu);
  checks.push(name);
}

replace(
`function renderLevelRoles() {
  const lv = state.overview?.features?.levels;
  const list = $('#levelroles');
  const nodes = [];

  if (!lv?.roles?.length) nodes.push(el('p', 'muted', 'No level rewards set.'));
  for (const r of (lv?.roles || [])) {
    const line = el('div', 'post-row');
    line.append(el('span', 'k', \`Level \${r.level} → \${r.roleName || 'role deleted'}\`));
    const del = el('button', 'btn small danger', 'Remove');
    del.type = 'button';
    del.addEventListener('click', () => post('levelrole', { level: r.level, remove: true }));
    line.append(del);
    nodes.push(line);
  }

  const add = el('details', 'item');
  const sum = el('summary');
  sum.append(el('span', 'nm', '+ Reward a role at a level'));
  const nb = { level: 5, roleId: null };
  const body = el('div', 'body');
  body.append(
    textField('Level', '5', v => { nb.level = Number(v); }),
    pickOne('Role to grant', 'role', '', v => { nb.roleId = v; }, { blank: 'Pick a role' }),
    actions(() => post('levelrole', nb)),
  );
  add.append(sum, body);
  nodes.push(add);

  list.replaceChildren(...nodes);
}`,
`function renderLevelRoles() {
  /* Legacy Engagement level-roles block removed — Rank ladder lives in Leveling tab. */
  const list = document.getElementById('levelroles');
  if (!list) return;
  list.replaceChildren();
}`,
'renderLevelRoles');

replace(
`function renderLevelBadges() {
  const lv = state.overview?.features?.levels;
  const list = $('#levelbadges');
  if (!list) return;
  const nodes = [];

  if (!lv?.badges?.length) nodes.push(el('p', 'muted', 'No level badges set.'));
  for (const b of (lv?.badges || [])) {
    const line = el('div', 'post-row');
    line.append(el('span', 'k', \`Level \${b.level} → \${b.badgeLabel}\`));
    const del = el('button', 'btn small danger', 'Remove');
    del.type = 'button';
    del.addEventListener('click', () => post('levelbadge', { level: b.level, remove: true }));
    line.append(del);
    nodes.push(line);
  }

  const catalog = lv?.badgeCatalog || [];
  const add = el('details', 'item');
  const sum = el('summary');
  sum.append(el('span', 'nm', '+ Award a badge at a level'));
  const nb = { level: 5, badgeId: catalog[0]?.id || null };
  const body = el('div', 'body');
  body.append(
    textField('Level', '5', v => { nb.level = Number(v); }),
    select('Badge to grant', nb.badgeId || '', catalog.map(c => ({ value: c.id, label: \`\${c.emoji} \${c.label}\` })),
      v => { nb.badgeId = v; }),
    actions(() => post('levelbadge', nb)),
  );
  add.append(sum, body);
  nodes.push(add);

  list.replaceChildren(...nodes);
}`,
`function renderLevelBadges() {
  /* Legacy level-badges block removed — managed in Leveling tab if needed. */
  const list = document.getElementById('levelbadges');
  if (!list) return;
  list.replaceChildren();
}`,
'renderLevelBadges');

replace(
`function renderLevelsReset() {
  const box = $('#levels-reset');
  if (!box) return;
  const lv = state.overview?.features?.levels;
  const btn = el('button', 'btn danger', 'Reset all levels');
  btn.type = 'button';
  btn.addEventListener('click', async () => {
    if (!await askConfirm({
      title: 'Reset every member\\u2019s level?',
      message: \`\${num(lv?.tracked || 0)} tracked member\${lv?.tracked === 1 ? '' : 's'} will be put back to level 1 with 0 XP. Level reward roles and level badges stay configured. This cannot be undone.\`,
      confirmLabel: 'Reset levels', danger: true,
    })) return;
    await post('resetlevels', {});
  });
  box.replaceChildren(btn);
}`,
`function renderLevelsReset() {
  /* Legacy Engagement reset removed — use Reset all XP on the Leveling tab. */
  const box = document.getElementById('levels-reset');
  if (!box) return;
  box.replaceChildren();
}`,
'renderLevelsReset');

const oldCalls = `  renderLevels();
  renderLevelRoles();
  renderLevelBadges();
  renderLevelsReset();`;
const newCalls = `  try { renderLevels(); } catch (e) { console.warn('[panel] renderLevels', e); }
  try { renderLevelRoles(); } catch (e) { console.warn('[panel] renderLevelRoles', e); }
  try { renderLevelBadges(); } catch (e) { console.warn('[panel] renderLevelBadges', e); }
  try { renderLevelsReset(); } catch (e) { console.warn('[panel] renderLevelsReset', e); }`;
if (t.includes(oldCalls)) { t = t.replace(oldCalls, newCalls); checks.push('overview-calls'); }
else if (t.includes('try { renderLevels()')) console.log('already: overview-calls');
else { console.error('MISSING overview calls'); process.exit(1); }

const oldRL = `const channelList = () => state.overview?.settings?.channels || [];
const roleList = () => state.overview?.settings?.roles || [];`;
const newRL = `const channelList = () => {
  const x = state.overview?.settings?.channels;
  return Array.isArray(x) ? x : [];
};
const roleList = () => {
  const x = state.overview?.settings?.roles;
  return Array.isArray(x) ? x : [];
};`;
if (t.includes(oldRL)) { t = t.replace(oldRL, newRL); checks.push('roleList'); }
else if (t.includes('Array.isArray(x) ? x : []')) console.log('already: roleList');

const oldSel = `  for (const opt of options) {
    const o = el('option', null, opt.label);`;
const newSel = `  for (const opt of (options || [])) {
    const o = el('option', null, opt.label);`;
if (t.includes(oldSel)) { t = t.replace(oldSel, newSel); checks.push('select'); }

fs.writeFileSync(file, t);
console.log('patched:', checks.join(', '));
