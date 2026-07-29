'use strict';

const { buildGatherCommand } = require('../../utils/gatherCommand');
const { generateFishImage } = require('../../utils/fishVisual');

// Weighted so junk/common dominate and legendary is a real rarity — the
// coin range on each entry is the "creative" part users are chasing.
const CATCHES = [
  { name: 'Old Boot',              rarity: 'junk',      weight: 18, min: 0,   max: 15 },
  { name: 'Rusty Can',              rarity: 'junk',      weight: 16, min: 0,   max: 15 },
  { name: 'Tangled Seaweed',        rarity: 'junk',      weight: 14, min: 5,   max: 25 },
  { name: 'Broken Bottle',          rarity: 'junk',      weight: 12, min: 0,   max: 10 },
  { name: 'Minnow',                 rarity: 'common',    weight: 18, min: 30,  max: 80 },
  { name: 'Bluegill Bass',          rarity: 'common',    weight: 14, min: 50,  max: 110 },
  { name: 'Catfish',                rarity: 'common',    weight: 10, min: 60,  max: 130 },
  { name: 'Rainbow Trout',          rarity: 'uncommon',  weight: 8,  min: 120, max: 220 },
  { name: 'Silver Salmon',          rarity: 'uncommon',  weight: 6,  min: 150, max: 260 },
  { name: 'Golden Marlin',          rarity: 'rare',      weight: 3,  min: 300, max: 500 },
  { name: 'Great White Shark',      rarity: 'rare',      weight: 2,  min: 350, max: 550 },
  { name: 'Ancient Treasure Chest', rarity: 'legendary', weight: 1,  min: 700, max: 1200 },
];

module.exports = buildGatherCommand({
  action: 'fish',
  commandName: 'fish',
  description: 'Cast a line and see what you reel in (10 casts per session, 2 hour cooldown)',
  table: CATCHES,
  generateImage: generateFishImage,
  imagePrefix: 'fish',
  embedTitle: '🎣 Fishing',
  embedColor: 0x1D9BF0,
  cooldownTitle: "🎣 Line's Still Out",
  cooldownVerb: 'fishing',
  buttonLabel: 'Fish',
  buttonEmoji: '🎣',
  sessionNoun: 'casts',
});
