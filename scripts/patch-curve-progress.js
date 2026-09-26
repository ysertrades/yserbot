#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const target = path.join(__dirname, '..', 'utils', 'levelingEngine.js');
let src = fs.readFileSync(target, 'utf8');
if (src.includes('curveVersion')) {
  console.log('curveVersion already present');
  process.exit(0);
}
const old = `  if (patch.curveMode != null || patch.curveBase != null || patch.curveMult != null) {
    for (const u of Object.values(g.users || {})) {
      if (!u || u.xp == null) continue;
      u.level = levelFromXp(u.xp, g);
    }
  }
  all[guildId] = g;
  saveAll(all);
  return panelSnapshot(guildId, guild || null);
}`;
const neu = `  // Curve change: recompute levels so into/need (progress bars) follow new base & multiplier live
  if (patch.curveMode != null || patch.curveBase != null || patch.curveMult != null) {
    for (const u of Object.values(g.users || {})) {
      if (!u || u.xp == null) continue;
      u.level = levelFromXp(u.xp, g);
    }
    g.curveVersion = (Number(g.curveVersion) || 0) + 1;
    g.curveUpdatedAt = Date.now();
  }
  all[guildId] = g;
  saveAll(all);
  return panelSnapshot(guildId, guild || null);
}`;
if (!src.includes(old)) {
  console.error('saveConfig curve block not found — layout changed');
  process.exit(1);
}
src = src.replace(old, neu);
const oldSnap = `    curveMode: g.curveMode || 'quadratic',
    curveBase: g.curveBase ?? 100,
    curveMult: g.curveMult ?? 1.5,`;
const neuSnap = `    curveMode: g.curveMode || 'quadratic',
    curveBase: g.curveBase ?? 100,
    curveMult: g.curveMult ?? 1.5,
    curveVersion: g.curveVersion || 0,`;
if (src.includes(oldSnap)) src = src.replace(oldSnap, neuSnap);
fs.writeFileSync(target, src);
console.log('Patched levelingEngine curve recompute + curveVersion');
