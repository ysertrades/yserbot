#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const appPath = path.join(__dirname, '..', 'web', 'public', 'app.js');
let text = fs.readFileSync(appPath, 'utf8');
if (text.includes('try { renderFeedForms()')) {
  console.log('app.js already has renderOverview guards');
  process.exit(0);
}
const oldOv = `function renderOverview() {
  if (!state.overview) return;
  renderOverviewCards();
  bindMembersSearch();
  renderMembersRoster();
  try { syncFeatureNav(); } catch {}
  if (isEditing() || sheetIsOpen()) {
    liveMissed = true;
    return;
  }
  renderFeedForms();
  renderModerationForm();`;

const newOv = `function renderOverview() {
  if (!state.overview) return;
  try { renderOverviewCards(); } catch (e) { console.warn('[panel] renderOverviewCards', e); }
  try { bindMembersSearch(); } catch (e) { console.warn('[panel] bindMembersSearch', e); }
  try { renderMembersRoster(); } catch (e) { console.warn('[panel] renderMembersRoster', e); }
  try { syncFeatureNav(); } catch {}
  if (isEditing() || sheetIsOpen()) {
    liveMissed = true;
    return;
  }
  try { renderFeedForms(); } catch (e) { console.warn('[panel] renderFeedForms', e); }
  try { renderModerationForm(); } catch (e) { console.warn('[panel] renderModerationForm', e); }`;

if (!text.includes(oldOv.slice(0, 80))) {
  console.error('renderOverview start not found — manual merge needed');
  process.exit(1);
}
text = text.replace(oldOv, newOv);

const oldFeed = `function renderFeedForms() {
  const d = state.overview;

  // News feed removed — Financial Juice live feed retired.

  const ec = {
    enabled: d.econcal.enabled,
    impactFilter: d.econcal.impact.slice(),
    currencyFilter: d.econcal.currencies.slice(),
    weeklyPost: { ...d.econcal.weekly },
  };`;

const newFeed = `function renderFeedForms() {
  const d = state.overview;
  if (!d) return;

  // News feed removed — Financial Juice live feed retired.

  const cal = d.econcal || {};
  const weekly = cal.weekly || { enabled: false, weekday: 1, hour: 0, minute: 0, offsetMinutes: 0 };
  const ec = {
    enabled: !!cal.enabled,
    impactFilter: Array.isArray(cal.impact) ? cal.impact.slice() : [],
    currencyFilter: Array.isArray(cal.currencies) ? cal.currencies.slice() : [],
    weeklyPost: { ...weekly },
  };`;

if (text.includes(oldFeed)) {
  text = text.replace(oldFeed, newFeed);
} else {
  console.warn('renderFeedForms exact block not found');
}

const oldRefs = `pickOne('Channel', 'channel', d.econcal.channelId, v => { ec.channelId = v; }),
    pickOne('Ping this role on reminders', 'role', d.econcal.roleId, v => { ec.roleId = v; },
      { blank: 'No ping' }),
    pickValues('Impact levels', d.econcal.impactLevels || [], ec.impactFilter,
      v => { ec.impactFilter = v; }, { allNote: 'Nothing picked — every impact level is sent.' }),
    pickValues('Currencies', d.econcal.currencyCodes || [], ec.currencyFilter,
      v => { ec.currencyFilter = v; }, { allNote: 'Nothing picked — every currency is sent.' }),`;

const newRefs = `pickOne('Channel', 'channel', cal.channelId, v => { ec.channelId = v; }),
    pickOne('Ping this role on reminders', 'role', cal.roleId, v => { ec.roleId = v; },
      { blank: 'No ping' }),
    pickValues('Impact levels', cal.impactLevels || cal.impactOptions || [], ec.impactFilter,
      v => { ec.impactFilter = v; }, { allNote: 'Nothing picked — every impact level is sent.' }),
    pickValues('Currencies', cal.currencyCodes || cal.currencyOptions || [], ec.currencyFilter,
      v => { ec.currencyFilter = v; }, { allNote: 'Nothing picked — every currency is sent.' }),`;

if (text.includes(oldRefs)) text = text.replace(oldRefs, newRefs);

fs.writeFileSync(appPath, text);
console.log('patched', appPath, 'size', text.length);
