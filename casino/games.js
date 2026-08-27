'use strict';

/**
 * casino/games.js
 *
 * The one list of casino games.
 *
 * It was written out twice — once as buttons in commands/economy/casino.js and
 * again as a label map in events/casinoInteraction.js — which is how Coinflip
 * and Dice ended up sharing the dice emoji in one place and not the other.
 * Both now build from here, and so does the control panel, so a game's name,
 * icon and whether it is switched on are answered in exactly one place.
 *
 * Order is the order the menu shows them in.
 */

const { ButtonStyle } = require('discord.js');

const GAMES = [
  { key: 'blackjack', label: 'Blackjack',   emoji: '🃏', style: ButtonStyle.Secondary },
  { key: 'slots',     label: 'Slots',       emoji: '🎰', style: ButtonStyle.Secondary },
  { key: 'coinflip',  label: 'Coinflip',    emoji: '🪙', style: ButtonStyle.Secondary },
  { key: 'dice',      label: 'Dice',        emoji: '🎲', style: ButtonStyle.Secondary },
  { key: 'trading',   label: 'Trade',       emoji: '📈', style: ButtonStyle.Secondary },
  { key: 'crash',     label: 'Crash',       emoji: '🛩️', style: ButtonStyle.Secondary },
  // The two races are multiplayer-ish and green in the menu to say so.
  { key: 'horse',     label: 'Horses',      emoji: '🐎', style: ButtonStyle.Success },
  { key: 'turtle',    label: 'Turtles',     emoji: '🐢', style: ButtonStyle.Success },
  { key: 'roulette',  label: 'Roulette',    emoji: '🎡', style: ButtonStyle.Secondary },
  { key: 'wheel',     label: 'Wheel',       emoji: '🎰', style: ButtonStyle.Secondary },
  { key: 'higherlower', label: 'Higher / Lower', emoji: '🃏', style: ButtonStyle.Secondary },
  { key: 'monte',     label: 'Find the Queen', emoji: '👑', style: ButtonStyle.Secondary },
];

const GAME_KEYS = GAMES.map(g => g.key);
const byKey = new Map(GAMES.map(g => [g.key, g]));

/** "🪙 Coinflip" — the heading a game screen shows. */
function gameTitle(key) {
  const g = byKey.get(key);
  return g ? `${g.emoji} ${g.label}` : key;
}

/** The longer name used where there is room for it. */
const LONG_LABELS = { horse: 'Horse Race', turtle: 'Turtle Race', trading: 'Trading',
  higherlower: 'Higher or Lower', monte: 'Find the Queen' };

function gameHeading(key) {
  const g = byKey.get(key);
  if (!g) return key;
  return `${g.emoji} ${LONG_LABELS[key] || g.label}`;
}

module.exports = { GAMES, GAME_KEYS, byKey, gameTitle, gameHeading };
