'use strict';

const { buildGatherCommand } = require('../../utils/gatherCommand');
const { generateMineImage } = require('../../utils/mineVisual');

const FINDS = [
  { name: 'Loose Pebble',      rarity: 'junk',      weight: 18, min: 0,   max: 15 },
  { name: 'Chunk of Coal',     rarity: 'junk',      weight: 16, min: 5,   max: 20 },
  { name: 'Cracked Rock',      rarity: 'junk',      weight: 14, min: 0,   max: 10 },
  { name: 'Iron Ore',          rarity: 'common',     weight: 18, min: 30,  max: 90 },
  { name: 'Copper Ore',        rarity: 'common',     weight: 14, min: 40,  max: 100 },
  { name: 'Tin Ore',           rarity: 'common',     weight: 10, min: 35,  max: 95 },
  { name: 'Silver Vein',       rarity: 'uncommon',   weight: 8,  min: 120, max: 230 },
  { name: 'Gold Nugget',       rarity: 'uncommon',   weight: 6,  min: 160, max: 280 },
  { name: 'Emerald',           rarity: 'rare',       weight: 3,  min: 300, max: 500 },
  { name: 'Diamond',           rarity: 'rare',       weight: 2,  min: 380, max: 600 },
  { name: 'Ancient Relic',     rarity: 'legendary',  weight: 1,  min: 700, max: 1200 },
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
