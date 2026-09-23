#!/usr/bin/env node
/**
 * Run in repo root AFTER restoring web/writes.js if it was corrupted:
 *   git show 371cf93c17e6f781bbab3c4aa05581153e63a3fc:web/writes.js > web/writes.js
 *   node scripts/patch-leveling-writes.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'web', 'writes.js');
let w = fs.readFileSync(file, 'utf8');
if (w.trim() === 'PLACEHOLDER' || w.length < 1000) {
  console.error('web/writes.js is still broken. Restore first:');
  console.error('  git show 371cf93c17e6f781bbab3c4aa05581153e63a3fc:web/writes.js > web/writes.js');
  process.exit(1);
}
if (w.includes("op === 'reset'") && w.includes('resetAllXp')) {
  console.log('Already patched.');
  process.exit(0);
}
const old = `async leveling(guildId, body, ctx) {
    const leveling = require('../utils/levelingEngine');
    if (body && body.op === 'manual') {
      const r = leveling.manualXp(guildId, {
        userId: body.userId,
        amount: body.amount,
        reason: body.reason,
        staffId: ctx.session?.uid,
      });
      if (r.error) return r;
      return { ok: true, ...r };
    }
    const snap = leveling.saveConfig(guildId, body || {}, ctx.session?.uid);
    return { ok: true, levels: snap };
  },`;
const neu = `async leveling(guildId, body, ctx) {
    try {
      const leveling = require('../utils/levelingEngine');
      if (body && body.op === 'manual') {
        const r = leveling.manualXp(guildId, {
          userId: body.userId,
          amount: body.amount,
          reason: body.reason,
          staffId: ctx.session?.uid,
        });
        if (r?.error) return r;
        return { ok: true, ...r, changed: ['Manual XP'] };
      }
      if (body && body.op === 'reset') {
        if (typeof leveling.resetAllXp !== 'function') {
          return { error: 'leveling_unavailable', detail: 'Reset not supported on this build' };
        }
        const snap = leveling.resetAllXp(guildId, ctx.session?.uid);
        return { ok: true, levels: snap, changed: ['XP leaderboard reset'] };
      }
      const snap = leveling.saveConfig(guildId, body || {}, ctx.session?.uid);
      return { ok: true, levels: snap, changed: ['Leveling config'] };
    } catch (err) {
      console.error('[writes.leveling]', err);
      return { error: 'leveling_save_failed', detail: err.message || String(err) };
    }
  },`;
if (!w.includes(old)) {
  console.error('Could not find leveling handler block to patch.');
  process.exit(1);
}
w = w.replace(old, neu);
const old2 = `async resetlevels(guildId, body, ctx) {
    return { error: 'Leveling has been removed.' };
  },`;
const neu2 = `async resetlevels(guildId, body, ctx) {
    try {
      const leveling = require('../utils/levelingEngine');
      if (typeof leveling.resetAllXp !== 'function') {
        return { error: 'leveling_unavailable', detail: 'Reset not supported on this build' };
      }
      const snap = leveling.resetAllXp(guildId, ctx.session?.uid);
      return { ok: true, levels: snap, changed: ['XP leaderboard reset'] };
    } catch (err) {
      console.error('[writes.resetlevels]', err);
      return { error: 'leveling_save_failed', detail: err.message || String(err) };
    }
  },`;
if (w.includes(old2)) w = w.replace(old2, neu2);
fs.writeFileSync(file, w);
console.log('Patched', file, fs.statSync(file).size, 'bytes');
