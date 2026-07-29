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
  { name: 'Plastic Bag',            rarity: 'junk',      weight: 13, min: 0,   max: 12 },
  { name: 'Soggy Newspaper',        rarity: 'junk',      weight: 11, min: 0,   max: 8 },
  { name: 'Barnacle Cluster',       rarity: 'junk',      weight: 10, min: 0,   max: 10 },
  { name: 'Fishing Hook',           rarity: 'junk',      weight: 9,  min: 0,   max: 8 },
  { name: 'Minnow',                 rarity: 'common',    weight: 18, min: 30,  max: 80 },
  { name: 'Bluegill Bass',          rarity: 'common',    weight: 14, min: 50,  max: 110 },
  { name: 'Catfish',                rarity: 'common',    weight: 10, min: 60,  max: 130 },
  { name: 'Jellyfish',              rarity: 'common',    weight: 9,  min: 40,  max: 100 },
  { name: 'Crawfish',               rarity: 'common',    weight: 8,  min: 45,  max: 105 },
  { name: 'Herring',                rarity: 'common',    weight: 8,  min: 35,  max: 90 },
  { name: 'Octopus',                rarity: 'common',    weight: 7,  min: 45,  max: 110 },
  { name: 'Rainbow Trout',          rarity: 'uncommon',  weight: 8,  min: 120, max: 220 },
  { name: 'Silver Salmon',          rarity: 'uncommon',  weight: 6,  min: 150, max: 260 },
  { name: 'Pufferfish',             rarity: 'uncommon',  weight: 5,  min: 140, max: 240 },
  { name: 'Sea Turtle',             rarity: 'uncommon',  weight: 4,  min: 160, max: 260 },
  { name: 'Manta Ray',              rarity: 'uncommon',  weight: 3,  min: 170, max: 270 },
  { name: 'Golden Marlin',          rarity: 'rare',      weight: 3,  min: 300, max: 500 },
  { name: 'Great White Shark',      rarity: 'rare',      weight: 2,  min: 350, max: 550 },
  { name: 'Electric Eel',           rarity: 'rare',      weight: 2,  min: 320, max: 520 },
  { name: 'Giant Squid',            rarity: 'rare',      weight: 1,  min: 380, max: 580 },
  { name: 'Swordfish',              rarity: 'rare',      weight: 2,  min: 340, max: 540 },
  { name: 'Anglerfish',             rarity: 'rare',      weight: 1,  min: 360, max: 560 },
  { name: 'Ancient Treasure Chest', rarity: 'legendary', weight: 1,  min: 700, max: 1200 },
  { name: "Kraken's Eye",           rarity: 'legendary', weight: 1,  min: 900, max: 1500 },
  { name: 'Golden Seahorse',        rarity: 'legendary', weight: 1,  min: 950, max: 1400 },
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
