'use strict';

const { buildGatherCommand } = require('../../utils/gatherCommand');
const { generateMineImage } = require('../../utils/mineVisual');

const FINDS = [
  { name: 'Loose Pebble',      rarity: 'junk',      weight: 18, min: 0,   max: 15 },
  { name: 'Chunk of Coal',     rarity: 'junk',      weight: 16, min: 5,   max: 20 },
  { name: 'Cracked Rock',      rarity: 'junk',      weight: 14, min: 0,   max: 10 },
  { name: 'Bent Nail',         rarity: 'junk',      weight: 13, min: 0,   max: 12 },
  { name: 'Broken Pickaxe Head', rarity: 'junk',    weight: 11, min: 0,   max: 8 },
  { name: 'Rusty Chain',       rarity: 'junk',      weight: 10, min: 0,   max: 10 },
  { name: 'Cracked Vial',      rarity: 'junk',      weight: 9,  min: 0,   max: 8 },
  { name: 'Iron Ore',          rarity: 'common',     weight: 18, min: 30,  max: 90 },
  { name: 'Copper Ore',        rarity: 'common',     weight: 14, min: 40,  max: 100 },
  { name: 'Tin Ore',           rarity: 'common',     weight: 10, min: 35,  max: 95 },
  { name: 'Granite Chunk',     rarity: 'common',     weight: 8,  min: 35,  max: 95 },
  { name: 'Silver Vein',       rarity: 'uncommon',   weight: 8,  min: 120, max: 230 },
  { name: 'Gold Nugget',       rarity: 'uncommon',   weight: 6,  min: 160, max: 280 },
  { name: 'Quartz Crystal',    rarity: 'uncommon',   weight: 5,  min: 130, max: 240 },
  { name: 'Amethyst',          rarity: 'uncommon',   weight: 4,  min: 150, max: 260 },
  { name: 'Obsidian Shard',    rarity: 'uncommon',   weight: 4,  min: 140, max: 250 },
  { name: 'Opal',              rarity: 'uncommon',   weight: 3,  min: 150, max: 260 },
  { name: 'Emerald',           rarity: 'rare',       weight: 3,  min: 300, max: 500 },
  { name: 'Diamond',           rarity: 'rare',       weight: 2,  min: 380, max: 600 },
  { name: 'Sapphire',          rarity: 'rare',       weight: 2,  min: 320, max: 520 },
  { name: 'Ruby',              rarity: 'rare',       weight: 2,  min: 340, max: 540 },
  { name: 'Topaz',             rarity: 'rare',       weight: 2,  min: 330, max: 530 },
  { name: 'Platinum Bar',      rarity: 'rare',       weight: 1,  min: 400, max: 620 },
  { name: 'Ancient Relic',     rarity: 'legendary',  weight: 1,  min: 700, max: 1200 },
  { name: 'Buried Skeleton Key', rarity: 'legendary', weight: 1, min: 800, max: 1300 },
  { name: 'Meteorite Fragment', rarity: 'legendary', weight: 1, min: 900, max: 1500 },
  { name: 'Fossilized Bone',   rarity: 'legendary',  weight: 1,  min: 850, max: 1400 },
];

module.exports = buildGatherCommand({
  action: 'mine',
  commandName: 'mine',
  description: 'Swing your pickaxe and see what you dig up (10 digs per session, 2 hour cooldown)',
  table: FINDS,
  generateImage: generateMineImage,
  imagePrefix: 'mine',
  embedTitle: '⛏️ Mining',
  embedColor: 0xB98A46,
  cooldownTitle: '⛏️ Pickaxe Needs Rest',
  cooldownVerb: 'mining',
  buttonLabel: 'Mine',
  buttonEmoji: '⛏️',
  sessionNoun: 'digs',
});
