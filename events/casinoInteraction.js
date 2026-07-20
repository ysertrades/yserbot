'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Handles all interactions whose customId starts with "cs:"
// ─────────────────────────────────────────────────────────────────────────────

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { getBalance, addCoins, removeCoins, hasEnough, checkCooldown, setCooldown } = require('../utils/economyManager');
const { getSession, updateSession, tryLock, unlock } = require('../casino/sessions');
const { getSettings } = require('../casino/settings');
const { readJson, writeJson } = require('../utils/jsonStorage');
const engine = require('../casino/engine');

const WHEEL_DAILY_LIMIT = 5;

function getTodayStr() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function checkWheelLimit(userId) {
  const data  = readJson('wheel_limits.json', {});
  const entry = data[userId] || { date: '', count: 0 };
  const today = getTodayStr();
  if (entry.date !== today) return { spinsLeft: WHEEL_DAILY_LIMIT, used: 0 };
  return { spinsLeft: WHEEL_DAILY_LIMIT - entry.count, used: entry.count };
}

function recordWheelSpin(userId) {
  const data  = readJson('wheel_limits.json', {});
  const today = getTodayStr();
  const entry = (data[userId]?.date === today) ? data[userId] : { date: today, count: 0 };
  entry.count += 1;
  data[userId] = entry;
  writeJson('wheel_limits.json', data);
  return entry.count;
}

const fmt  = n => Number(n).toLocaleString();
const wait = ms => new Promise(r => setTimeout(r, ms));

// Global map for live crash sessions (userId → { interval, message, state })
if (!global.crashSessions) global.crashSessions = new Map();
// Global map for open PvP dice challenges
if (!global.diceChallenges) global.diceChallenges = new Map();

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (interaction.isButton()     && interaction.customId.startsWith('cs:'))
      return handleButton(interaction).catch(e => handleError(interaction, e));
    if (interaction.isModalSubmit() && interaction.customId.startsWith('cs:'))
      return handleModal(interaction).catch(e => handleError(interaction, e));
  },
};

// ─── Error fallback ───────────────────────────────────────────────────────────
async function handleError(interaction, err) {
  console.error('[CASINO ERROR]', err);
  const m = { content: '❌ Something went wrong. Use `/casino` to start fresh.', flags: 64 };
  try { interaction.replied || interaction.deferred ? await interaction.followUp(m) : await interaction.reply(m); } catch {}
}

function guardSession(interaction) {
  const s = getSession(interaction.user.id);
  if (!s) return null;
  if (interaction.message && s.messageId && s.messageId !== interaction.message.id) return null;
  return s;
}

async function expired(interaction) {
  return interaction.reply({ content: '⚠️ Session expired. Use `/casino` to start a new game.', flags: 64 });
}

const afterRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('cs:again').setLabel('🔁 Play Again').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId('cs:menu').setLabel('🏠 Menu').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('cs:close').setLabel('🔒 Close').setStyle(ButtonStyle.Danger),
);

// ─────────────────────────────────────────────────────────────────────────────
// Button router
// ─────────────────────────────────────────────────────────────────────────────

async function handleButton(interaction) {
  const parts = interaction.customId.split(':');
  const type  = parts[1];

  if (type === 'close') {
    const s = getSession(interaction.user.id);
    if (s) unlock(s.userId);
    // Also stop any running crash session
    if (global.crashSessions.has(interaction.user.id)) {
      clearInterval(global.crashSessions.get(interaction.user.id).interval);
      global.crashSessions.delete(interaction.user.id);
    }
    try { await interaction.message.delete(); } catch {}
    return;
  }

  if (type === 'menu') {
    const s = getSession(interaction.user.id);
    if (!s) return expired(interaction);
    const { mainEmbed, mainRows } = require('../commands/economy/casino');
    updateSession(s.userId, { game: null, bjState: null, tradeState: null, raceState: null });
    return interaction.update({ embeds: [mainEmbed(s.userId, s.guildId, s.lastResult)], components: mainRows() });
  }

  if (type === 'again') {
    const s = getSession(interaction.user.id);
    if (!s || !s.game || !s.bet) return expired(interaction);
    if (!hasEnough(s.userId, s.bet))
      return interaction.reply({ content: `❌ Not enough coins. Balance: **${fmt(getBalance(s.userId))}**.`, flags: 64 });
    removeCoins(s.userId, s.bet);
    updateSession(s.userId, { bjState: null, tradeState: null, raceState: null });
    await interaction.deferUpdate();
    const upd = getSession(s.userId);
    if (s.game === 'coinflip')  return showCoinflipChoice(interaction, upd);
    if (s.game === 'blackjack') return startBlackjack(interaction, upd);
    if (s.game === 'trading')   return startTrading(interaction, upd);
    if (s.game === 'slots')     return startSlots(interaction, upd);
    if (s.game === 'crash')     return startCrash(interaction, upd);
    if (s.game === 'horse' || s.game === 'turtle') return showRacePick(interaction, upd);
    if (s.game === 'wheel')    return resolveWheel(interaction, upd);
    if (s.game === 'roulette') return showRoulettePick(interaction, upd);
    if (s.game === 'dice')     return showDiceModeSelect(interaction, upd);
    return expired(interaction);
  }

  // Open game → bet selection screen
  if (type === 'game') {
    const s = guardSession(interaction);
    if (!s) return expired(interaction);
    const game = parts[2];
    updateSession(s.userId, { game });
    if (game === 'horse' || game === 'turtle') {
      await interaction.deferUpdate();
      return showRacePick(interaction, getSession(s.userId));
    }
    if (game === 'roulette') {
      updateSession(s.userId, { rouletteState: null });
      await interaction.deferUpdate();
      return showRoulettePick(interaction, getSession(s.userId));
    }
    await interaction.deferUpdate();
    return showBetSelection(interaction, game);
  }

  // Race pick
  if (type === 'racepick') {
    const s = guardSession(interaction);
    if (!s) return expired(interaction);
    const pick = parseInt(parts[2]);
    updateSession(s.userId, { racePick: pick });
    await interaction.deferUpdate();
    return showBetSelection(interaction, s.game);
  }

  // Coinflip
  if (type === 'cf') {
    const s = guardSession(interaction);
    if (!s || s.game !== 'coinflip') return expired(interaction);
    if (!tryLock(s.userId)) return interaction.reply({ content: '⏳ Processing…', flags: 64 });
    await interaction.deferUpdate();
    return resolveCoinflip(interaction, s, parts[2]);
  }

  // Blackjack
  if (type === 'bj') {
    const s = guardSession(interaction);
    if (!s || s.game !== 'blackjack') return expired(interaction);
    if (!tryLock(s.userId)) return interaction.reply({ content: '⏳ Processing…', flags: 64 });
    await interaction.deferUpdate();
    return handleBJ(interaction, s, parts[2]);
  }

  // Trading
  if (type === 'tr') {
    const s = guardSession(interaction);
    if (!s || s.game !== 'trading') return expired(interaction);
    if (!tryLock(s.userId)) return interaction.reply({ content: '⏳ Processing…', flags: 64 });
    if (parts[2] === 'rr') {
      await interaction.deferUpdate();
      return resolveTrading(interaction, s, s.tradeState.direction, `${parts[3]}:${parts[4]}`);
    }
    if (parts[2] === 'buy' || parts[2] === 'sell') {
      updateSession(s.userId, { tradeState: { ...s.tradeState, direction: parts[2] } });
      await interaction.deferUpdate();
      return showRRChoice(interaction, s);
    }
    unlock(s.userId);
    return expired(interaction);
  }

  // Crash cash-out
  if (type === 'crash_cashout') {
    return handleCrashCashOut(interaction);
  }

  // Roulette bet-type pick
  if (type === 'rl') {
    const s = guardSession(interaction);
    if (!s || s.game !== 'roulette') return expired(interaction);
    const betType = parts[2];
    if (betType === 'straight') {
      const modal = new ModalBuilder()
        .setCustomId('cs:rl:straight')
        .setTitle('🎡 Roulette — Straight Up Bet')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('number').setLabel('Number (0–36)').setStyle(TextInputStyle.Short).setPlaceholder('e.g. 17').setRequired(true).setMinLength(1).setMaxLength(2),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('amount').setLabel('Bet Amount').setStyle(TextInputStyle.Short).setPlaceholder('e.g. 500').setRequired(true),
          ),
        );
      updateSession(s.userId, { rouletteState: { betType: 'straight' } });
      return interaction.showModal(modal);
    }
    updateSession(s.userId, { rouletteState: { betType } });
    await interaction.deferUpdate();
    return showBetSelection(interaction, 'roulette');
  }

  // ── Preset bet amount ────────────────────────────────────────────────────
  if (type === 'betamt') {
    const s = guardSession(interaction);
    if (!s) return expired(interaction);
    const game     = parts[2];
    const amtRaw   = parts[3];
    const settings = getSettings(s.guildId);
    const bal      = getBalance(s.userId);
    const bet      = amtRaw === 'all' ? Math.min(bal, settings.maxBet) : parseInt(amtRaw, 10);
    if (isNaN(bet) || bet < 1)     return interaction.reply({ content: '❌ Invalid amount.', flags: 64 });
    if (bet < settings.minBet)     return interaction.reply({ content: `❌ Min bet is **${fmt(settings.minBet)}** coins.`, flags: 64 });
    if (bet > settings.maxBet)     return interaction.reply({ content: `❌ Max bet is **${fmt(settings.maxBet)}** coins.`, flags: 64 });
    if (!hasEnough(s.userId, bet)) return interaction.reply({ content: `❌ Not enough coins. Balance: **${fmt(bal)}**.`, flags: 64 });
    const cd = checkCooldown(s.userId, 'casino');
    if (cd > 0)                    return interaction.reply({ content: `⏳ Cooldown: **${cd}s** remaining.`, flags: 64 });
    removeCoins(s.userId, bet);
    updateSession(s.userId, { bet, game, bjState: null, tradeState: null, raceState: null });
    const upd = getSession(s.userId);
    await interaction.deferUpdate();
    if (game === 'coinflip')  return showCoinflipChoice(interaction, upd);
    if (game === 'blackjack') return startBlackjack(interaction, upd);
    if (game === 'trading')   return startTrading(interaction, upd);
    if (game === 'slots')     return startSlots(interaction, upd);
    if (game === 'crash')     return startCrash(interaction, upd);
    if (game === 'horse' || game === 'turtle') return runRaceGame(interaction, upd);
    if (game === 'wheel')     return resolveWheel(interaction, upd);
    if (game === 'roulette')  return resolveRoulette(interaction, upd);
    if (game === 'dice')      return showDiceModeSelect(interaction, upd);
    return expired(interaction);
  }

  // ── Custom bet → open modal ──────────────────────────────────────────────
  if (type === 'betcustom') {
    return showBetModal(interaction, parts[2]);
  }

  // ── Dice mode selection ──────────────────────────────────────────────────
  if (type === 'dicemode') {
    const s = guardSession(interaction);
    if (!s || s.game !== 'dice') return expired(interaction);
    if (!tryLock(s.userId)) return interaction.reply({ content: '⏳ Processing…', flags: 64 });
    await interaction.deferUpdate();
    if (parts[2] === 'bot') return resolveDiceVsBot(interaction, s);
    if (parts[2] === 'pvp') return showDicePvpChallenge(interaction, s);
    unlock(s.userId);
    return expired(interaction);
  }

  // ── Dice PvP — accept challenge ──────────────────────────────────────────
  if (type === 'diceaccept') {
    const challengerId = parts[2];
    const bet          = parseInt(parts[3], 10);
    const accepterId   = interaction.user.id;
    if (accepterId === challengerId)
      return interaction.reply({ content: '❌ You cannot accept your own challenge!', flags: 64 });
    const challenge = global.diceChallenges.get(challengerId);
    if (!challenge)
      return interaction.reply({ content: '⚠️ This challenge has already been taken or expired.', flags: 64 });
    if (!hasEnough(accepterId, bet))
      return interaction.reply({ content: `❌ You need **${fmt(bet)}** coins to accept.`, flags: 64 });
    global.diceChallenges.delete(challengerId);
    removeCoins(accepterId, bet);
    const pRoll = engine.rollDie(), aRoll = engine.rollDie();
    const tie   = pRoll === aRoll, cWon = pRoll > aRoll;
    if (tie) { addCoins(challengerId, bet); addCoins(accepterId, bet); }
    else if (cWon) addCoins(challengerId, bet * 2);
    else           addCoins(accepterId, bet * 2);
    const cBal = getBalance(challengerId), aBal = getBalance(accepterId);
    const pvpEmbed = new EmbedBuilder()
      .setColor(tie ? 0x95a5a6 : cWon ? 0x2ecc71 : 0xe74c3c)
      .setTitle('🎲 Dice — PvP Result')
      .setDescription(
        `<@${challengerId}> rolled ${engine.DICE_FACES[pRoll]} **${pRoll}**\n` +
        `<@${accepterId}> rolled ${engine.DICE_FACES[aRoll]} **${aRoll}**\n\n` +
        (tie ? '⚖️ **Tie!** Both players get their coins back.'
             : `🏆 **<@${cWon ? challengerId : accepterId}>** wins **${fmt(bet * 2)}** coins!`),
      )
      .addFields(
        { name: `<@${challengerId}>`, value: `**${fmt(cBal)}** coins`, inline: true },
        { name: `<@${accepterId}>`,   value: `**${fmt(aBal)}** coins`, inline: true },
      )
      .setFooter({ text: 'YSER Flow Casino' });
    return interaction.update({ embeds: [pvpEmbed], components: [] });
  }

  // ── Dice PvP — cancel / refund ───────────────────────────────────────────
  if (type === 'dicepvpcancel') {
    const s = getSession(interaction.user.id);
    if (s && s.bet) { addCoins(s.userId, s.bet); global.diceChallenges.delete(s.userId); unlock(s.userId); }
    try { await interaction.message.delete(); } catch {}
    return;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bet modal
// ─────────────────────────────────────────────────────────────────────────────

async function showBetModal(interaction, game) {
  const gameNames = {
    coinflip: 'Coinflip', blackjack: 'Blackjack', trading: 'Trading',
    slots: 'Slots', crash: 'Crash', horse: 'Horse Race', turtle: 'Turtle Race',
    wheel: 'Wheel of Fortune', roulette: 'Roulette', dice: 'Dice',
  };
  const modal = new ModalBuilder()
    .setCustomId(`cs:bet:${game}`)
    .setTitle(`💸 Place Your Bet — ${gameNames[game] || game}`)
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('amount').setLabel('Bet Amount').setStyle(TextInputStyle.Short).setPlaceholder('e.g. 500').setRequired(true),
    ));
  await interaction.showModal(modal);
}

async function showBetSelection(interaction, game) {
  const s = getSession(interaction.user.id);
  if (!s) return expired(interaction);
  const settings = getSettings(s.guildId);
  const bal      = getBalance(s.userId);

  const gameLabels = {
    coinflip: '🎲 Coinflip', blackjack: '🃏 Blackjack', trading: '📈 Trading',
    slots: '🎰 Slots', crash: '🛩️ Crash', horse: '🐎 Horse Race',
    turtle: '🐢 Turtle Race', wheel: '🎰 Wheel', roulette: '🎡 Roulette', dice: '🎲 Dice',
  };

  const embed = new EmbedBuilder()
    .setColor(0x1a1a2e)
    .setTitle(gameLabels[game] || game)
    .setDescription(`**Balance: ${fmt(bal)}** coins\nPick your bet, then play.`)
    .setFooter({ text: `YSER Flow Casino  •  Min: ${fmt(settings.minBet)}  ·  Max: ${fmt(settings.maxBet)}` });

  const PRESETS = [25, 100, 250, 500];
  const allIn   = Math.min(bal, settings.maxBet);

  const presetBtns = PRESETS.map(amt => {
    const disabled = amt < settings.minBet || amt > settings.maxBet || amt > bal;
    return new ButtonBuilder()
      .setCustomId(`cs:betamt:${game}:${amt}`)
      .setLabel(String(amt))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled);
  });
  presetBtns.push(
    new ButtonBuilder()
      .setCustomId(`cs:betamt:${game}:all`)
      .setLabel('All In 🔥')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(allIn < settings.minBet),
  );

  const row1 = new ActionRowBuilder().addComponents(...presetBtns);
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cs:betcustom:${game}`).setLabel('Custom ✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cs:menu').setLabel('< Games').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cs:close').setLabel('Close').setStyle(ButtonStyle.Danger),
  );

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

async function handleModal(interaction) {
  const parts = interaction.customId.split(':');

  // Straight-up roulette modal (number + amount in one modal)
  if (parts[1] === 'rl' && parts[2] === 'straight') {
    const s = guardSession(interaction);
    if (!s) return expired(interaction);
    const numRaw = interaction.fields.getTextInputValue('number');
    const amtRaw = interaction.fields.getTextInputValue('amount');
    const num    = parseInt(numRaw, 10);
    const bet    = parseInt(amtRaw, 10);
    if (isNaN(num) || num < 0 || num > 36) return interaction.reply({ content: '❌ Invalid number. Must be **0–36**.', flags: 64 });
    if (isNaN(bet) || bet < 1)             return interaction.reply({ content: '❌ Invalid bet amount.', flags: 64 });
    const settings = getSettings(s.guildId);
    if (bet < settings.minBet) return interaction.reply({ content: `❌ Min bet is **${fmt(settings.minBet)}** coins.`, flags: 64 });
    if (bet > settings.maxBet) return interaction.reply({ content: `❌ Max bet is **${fmt(settings.maxBet)}** coins.`, flags: 64 });
    if (!hasEnough(s.userId, bet)) return interaction.reply({ content: `❌ Not enough coins. Balance: **${fmt(getBalance(s.userId))}**.`, flags: 64 });
    const cd = checkCooldown(s.userId, 'casino');
    if (cd > 0) return interaction.reply({ content: `⏳ Cooldown: **${cd}s** remaining.`, flags: 64 });
    removeCoins(s.userId, bet);
    updateSession(s.userId, { bet, game: 'roulette', rouletteState: { betType: 'straight', betValue: num } });
    await interaction.deferUpdate();
    return resolveRoulette(interaction, getSession(s.userId));
  }

  if (parts[1] !== 'bet') return;
  const s = guardSession(interaction);
  if (!s) return expired(interaction);

  const raw = interaction.fields.getTextInputValue('amount');
  const bet = parseInt(raw);
  if (isNaN(bet) || bet < 1) return interaction.reply({ content: '❌ Invalid bet amount.', flags: 64 });

  const settings = getSettings(s.guildId);
  if (bet < settings.minBet) return interaction.reply({ content: `❌ Min bet is **${fmt(settings.minBet)}** coins.`, flags: 64 });
  if (bet > settings.maxBet) return interaction.reply({ content: `❌ Max bet is **${fmt(settings.maxBet)}** coins.`, flags: 64 });
  if (!hasEnough(s.userId, bet)) return interaction.reply({ content: `❌ Not enough coins. Balance: **${fmt(getBalance(s.userId))}**.`, flags: 64 });

  const cd = checkCooldown(s.userId, 'casino');
  if (cd > 0) return interaction.reply({ content: `⏳ Cooldown: **${cd}s** remaining.`, flags: 64 });

  removeCoins(s.userId, bet);
  const game = parts[2];
  updateSession(s.userId, { bet, game, bjState: null, tradeState: null, raceState: null });
  const upd = getSession(s.userId);

  await interaction.deferUpdate();
  if (game === 'coinflip')  return showCoinflipChoice(interaction, upd);
  if (game === 'blackjack') return startBlackjack(interaction, upd);
  if (game === 'trading')   return startTrading(interaction, upd);
  if (game === 'slots')     return startSlots(interaction, upd);
  if (game === 'crash')     return startCrash(interaction, upd);
  if (game === 'horse' || game === 'turtle') return runRaceGame(interaction, upd);
  if (game === 'wheel')    return resolveWheel(interaction, upd);
  if (game === 'roulette') return resolveRoulette(interaction, upd);
  if (game === 'dice')     return showDiceModeSelect(interaction, upd);
}

// ─────────────────────────────────────────────────────────────────────────────
// COINFLIP — true 50/50
// ─────────────────────────────────────────────────────────────────────────────

async function showCoinflipChoice(interaction, s) {
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🎲 Coinflip')
    .setDescription('The coin spins in the air… pick your side!')
    .addFields({ name: '💸 Bet', value: `**${fmt(s.bet)}** coins`, inline: true })
    .setFooter({ text: 'YSER Flow Casino  •  50 / 50' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cs:cf:heads').setLabel('🪙 Heads').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cs:cf:tails').setLabel('🪙 Tails').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cs:menu').setLabel('← Back').setStyle(ButtonStyle.Secondary),
  );
  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function resolveCoinflip(interaction, s, choice) {
  const result = engine.coinflip(choice);
  const payout = result.won ? s.bet * 2 : 0;
  if (payout > 0) addCoins(s.userId, payout);
  const delta = payout - s.bet, newBal = getBalance(s.userId);
  setCooldown(s.userId, 'casino');
  updateSession(s.userId, { lastResult: { label: result.won ? '🟢 WIN' : '🔴 LOSS', delta } });
  const embed = new EmbedBuilder()
    .setColor(result.won ? 0x2ecc71 : 0xe74c3c)
    .setTitle(`🎲 Coinflip — ${result.won ? 'You Win! 🎉' : 'You Lose!'}`)
    .setDescription(
      `> The coin landed on **${result.result.toUpperCase()}**\n> You chose **${choice.toUpperCase()}**`,
    )
    .addFields(
      { name: result.won ? '🏆 Won' : '💸 Lost', value: `**${fmt(s.bet)}** coins`, inline: true },
      { name: '💰 Balance', value: `**${fmt(newBal)}** coins`, inline: true },
    )
    .setFooter({ text: 'YSER Flow Casino' });
  unlock(s.userId);
  await interaction.editReply({ embeds: [embed], components: [afterRow()] });
}

// ─────────────────────────────────────────────────────────────────────────────
// SLOTS — 3-reel slot machine with animated reveal
// ─────────────────────────────────────────────────────────────────────────────

async function startSlots(interaction, s) {
  const result = engine.spinSlots();

  // ── Animated spin ───────────────────────────────────────────────────────
  const spinEmbed = () => new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🎰 Slots — Spinning…')
    .setDescription(engine.renderSlotsDisplay(result.reels, [true, true, true]))
    .addFields({ name: '💸 Bet', value: `**${fmt(s.bet)}** coins`, inline: true })
    .setFooter({ text: 'YSER Flow Casino' });

  await interaction.editReply({ embeds: [spinEmbed()], components: [] });

  // Reveal reel 1
  await wait(900);
  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle('🎰 Slots — Spinning…')
      .setDescription(engine.renderSlotsDisplay(result.reels, [false, true, true]))
      .addFields({ name: '💸 Bet', value: `**${fmt(s.bet)}** coins`, inline: true })
      .setFooter({ text: 'YSER Flow Casino' })],
    components: [],
  });

  // Reveal reel 2
  await wait(900);
  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle('🎰 Slots — Spinning…')
      .setDescription(engine.renderSlotsDisplay(result.reels, [false, false, true]))
      .addFields({ name: '💸 Bet', value: `**${fmt(s.bet)}** coins`, inline: true })
      .setFooter({ text: 'YSER Flow Casino' })],
    components: [],
  });

  // Reveal reel 3 + result
  await wait(900);

  const payout = result.won ? Math.floor(s.bet * result.mult) : 0;
  if (payout > 0) addCoins(s.userId, payout);
  const delta = payout - s.bet, newBal = getBalance(s.userId);
  setCooldown(s.userId, 'casino');
  updateSession(s.userId, { lastResult: { label: result.won ? `🟢 ×${result.mult}` : '🔴 LOSS', delta } });

  const typeLabels = { jackpot: '🎊 JACKPOT!!!', triple: '🎉 Triple Match!', pair: '✨ Pair!', lose: 'No Match' };
  const typeColors = { jackpot: 0xf1c40f, triple: 0x2ecc71, pair: 0x3498db, lose: 0xe74c3c };

  const symbolInfo = result.reels.map(r => r.name).join(' · ');

  const embed = new EmbedBuilder()
    .setColor(typeColors[result.resultType] || 0xe74c3c)
    .setTitle(`🎰 Slots — ${typeLabels[result.resultType] || 'No Match'}`)
    .setDescription(engine.renderSlotsDisplay(result.reels, [false, false, false]))
    .addFields(
      { name: '🎯 Result',    value: symbolInfo,                                               inline: false },
      { name: '💸 Bet',       value: `**${fmt(s.bet)}** coins`,                               inline: true  },
      { name: '💵 Payout',    value: payout > 0 ? `**${fmt(payout)}** coins (×${result.mult})` : '—', inline: true },
      { name: '💰 Balance',   value: `**${fmt(newBal)}** coins`,                              inline: true  },
    )
    .setFooter({ text: 'YSER Flow Casino' });

  if (result.resultType === 'jackpot') embed.setDescription(engine.renderSlotsDisplay(result.reels, [false, false, false]) + '\n🎊 **JACKPOT! You hit the big one!** 🎊');

  await interaction.editReply({ embeds: [embed], components: [afterRow()] });
}

// ─────────────────────────────────────────────────────────────────────────────
// CRASH — real-time multiplier with live embed updates
// ─────────────────────────────────────────────────────────────────────────────

async function startCrash(interaction, s) {
  const crashPoint = engine.generateCrashPoint();
  let tick = 0;

  const buildEmbed = (mult, crashed = false, cashedOut = false, cashOutMult = null) => {
    const color = crashed ? 0xe74c3c : cashedOut ? 0x2ecc71 : 0x3498db;
    const title = crashed    ? `🛩️ Crash — CRASHED at ${mult}x! 💥`
                : cashedOut  ? `🛩️ Crash — Cashed Out at ${cashOutMult}x! 🎉`
                :              `🛩️ Crash — Flying at ${mult}x…`;
    const chart = engine.renderCrashChart(tick, crashed, null, null);
    return new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(chart)
      .addFields({ name: '💸 Bet', value: `**${fmt(s.bet)}** coins`, inline: true })
      .setFooter({ text: crashed ? '💥 The plane crashed!' : cashedOut ? '✈️ You jumped out in time!' : '✈️ Click Cash Out before it crashes!' });
  };

  const cashOutRow = () => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cs:crash_cashout').setLabel(`💰 Cash Out`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cs:close').setLabel('🔒 Close').setStyle(ButtonStyle.Danger),
  );

  // Initial render
  const initialMult = engine.tickMultiplier(0);
  await interaction.editReply({ embeds: [buildEmbed(initialMult)], components: [cashOutRow()] });

  // Store crash session
  const crashState = {
    userId:     s.userId,
    bet:        s.bet,
    guildId:    s.guildId,
    crashPoint,
    tick:       0,
    cashedOut:  false,
    crashed:    false,
    interaction,
  };

  const interval = setInterval(async () => {
    const cs = global.crashSessions.get(s.userId);
    if (!cs || cs.cashedOut || cs.crashed) {
      clearInterval(interval);
      global.crashSessions.delete(s.userId);
      return;
    }

    cs.tick++;
    const currentMult = engine.tickMultiplier(cs.tick);
    tick = cs.tick;

    // Check crash
    if (currentMult >= cs.crashPoint) {
      cs.crashed = true;
      clearInterval(interval);
      global.crashSessions.delete(cs.userId);

      // Lose — no payout
      const newBal = getBalance(cs.userId);
      setCooldown(cs.userId, 'casino');
      updateSession(cs.userId, { lastResult: { label: `💥 CRASH ${cs.crashPoint}x`, delta: -cs.bet } });

      try {
        await cs.interaction.editReply({
          embeds: [buildEmbed(cs.crashPoint, true)],
          components: [afterRow()],
        });
      } catch {}
      return;
    }

    // Still flying — update embed
    try {
      await cs.interaction.editReply({
        embeds: [buildEmbed(currentMult)],
        components: [cashOutRow()],
      });
    } catch { clearInterval(interval); global.crashSessions.delete(cs.userId); }
  }, engine.TICK_MS);

  crashState.interval = interval;
  global.crashSessions.set(s.userId, crashState);
}

async function handleCrashCashOut(interaction) {
  const cs = global.crashSessions.get(interaction.user.id);
  if (!cs) {
    return interaction.reply({ content: '⚠️ No active crash session.', flags: 64 });
  }
  if (cs.cashedOut || cs.crashed) {
    return interaction.reply({ content: '⚠️ Game already ended.', flags: 64 });
  }

  cs.cashedOut = true;
  clearInterval(cs.interval);
  global.crashSessions.delete(cs.userId);

  const cashOutMult = engine.tickMultiplier(cs.tick);
  const payout      = Math.floor(cs.bet * cashOutMult);
  addCoins(cs.userId, payout);
  const delta  = payout - cs.bet;
  const newBal = getBalance(cs.userId);
  setCooldown(cs.userId, 'casino');
  updateSession(cs.userId, { lastResult: { label: `✅ CASH OUT ×${cashOutMult}`, delta } });

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`🛩️ Crash — Cashed Out! 🎉`)
    .setDescription(engine.renderCrashChart(cs.tick, false, cs.tick, null))
    .addFields(
      { name: '⚡ Multiplier', value: `**${cashOutMult}x**`,           inline: true },
      { name: '💸 Bet',        value: `**${fmt(cs.bet)}** coins`,       inline: true },
      { name: '💵 Payout',     value: `**${fmt(payout)}** coins`,       inline: true },
      { name: '💰 Balance',    value: `**${fmt(newBal)}** coins`,       inline: true },
      { name: '💥 Would have crashed at', value: `**${cs.crashPoint}x**`, inline: true },
    )
    .setFooter({ text: 'YSER Flow Casino' });

  await interaction.update({ embeds: [embed], components: [afterRow()] });
}

// ─────────────────────────────────────────────────────────────────────────────
// RACE — pick competitor → bet → race
// ─────────────────────────────────────────────────────────────────────────────

async function showRacePick(interaction, s) {
  const isHorse  = s.game === 'horse';
  const racers   = isHorse ? engine.HORSES : engine.TURTLES;
  const emoji    = isHorse ? '🐎' : '🐢';
  const gameName = isHorse ? 'Horse Race' : 'Turtle Race';
  const mult     = isHorse ? '4.5' : '2.8';

  const embed = new EmbedBuilder()
    .setColor(isHorse ? 0xe67e22 : 0x27ae60)
    .setTitle(`${emoji} ${gameName} — Pick Your Racer`)
    .setDescription(
      racers.map(r => `**#${r.id} ${r.emoji} ${r.name}**`).join('\n') +
      `\n\n> Pick one and place your bet. Win = **${mult}×** your bet.\n> All racers have an equal random chance to win.`,
    )
    .setFooter({ text: 'YSER Flow Casino  •  Purely random — no predictable odds' });

  const btns = racers.map(r =>
    new ButtonBuilder()
      .setCustomId(`cs:racepick:${r.id}`)
      .setLabel(`#${r.id} ${r.name}`)
      .setStyle(ButtonStyle.Primary),
  );
  const rows = [new ActionRowBuilder().addComponents(...btns.slice(0, 5))];
  if (btns.length > 5) rows.push(new ActionRowBuilder().addComponents(...btns.slice(5)));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cs:menu').setLabel('← Back').setStyle(ButtonStyle.Secondary),
  ));

  await interaction.editReply({ embeds: [embed], components: rows });
}

async function runRaceGame(interaction, s) {
  const isHorse = s.game === 'horse';
  const racers  = isHorse ? engine.HORSES : engine.TURTLES;
  const picked  = (s.racePick ?? 1) - 1; // 0-indexed
  const mult    = isHorse ? 4.5 : 2.8;

  // Animate: show all at start line
  const startEmbed = new EmbedBuilder()
    .setColor(isHorse ? 0xe67e22 : 0x27ae60)
    .setTitle(`${isHorse ? '🐎' : '🐢'} ${isHorse ? 'Horse' : 'Turtle'} Race — On your marks…`)
    .setDescription(engine.renderRaceTrack(
      racers,
      racers.map(() => 0),
      -1, picked,
    ))
    .setFooter({ text: 'YSER Flow Casino' });
  await interaction.editReply({ embeds: [startEmbed], components: [] });

  await wait(1200);

  // Run the race
  const { winnerIdx, progress } = engine.runRace(racers);
  const won = winnerIdx === picked;

  const payout = won ? Math.floor(s.bet * mult) : 0;
  if (payout > 0) addCoins(s.userId, payout);
  const delta = payout - s.bet, newBal = getBalance(s.userId);
  setCooldown(s.userId, 'casino');
  updateSession(s.userId, {
    lastResult: { label: won ? `🟢 WIN ×${mult}` : '🔴 LOSS', delta },
  });

  const winner     = racers[winnerIdx];
  const pickedRacer = racers[picked];

  const embed = new EmbedBuilder()
    .setColor(won ? 0x2ecc71 : 0xe74c3c)
    .setTitle(`${isHorse ? '🐎' : '🐢'} ${isHorse ? 'Horse' : 'Turtle'} Race — ${won ? `${pickedRacer.name} Wins! 🎉` : `${winner.name} Wins!`}`)
    .setDescription(engine.renderRaceTrack(racers, progress, winnerIdx, picked))
    .addFields(
      { name: '🏆 Winner',   value: `#${winner.id} ${winner.emoji} **${winner.name}**`,          inline: true },
      { name: '🎯 Your Pick', value: `#${pickedRacer.id} ${pickedRacer.emoji} **${pickedRacer.name}**`, inline: true },
      { name: '💸 Bet',      value: `**${fmt(s.bet)}** coins`,                                   inline: true },
      { name: '💵 Payout',   value: payout > 0 ? `**${fmt(payout)}** coins` : '—',               inline: true },
      { name: '💰 Balance',  value: `**${fmt(newBal)}** coins`,                                  inline: true },
    )
    .setFooter({ text: 'YSER Flow Casino' });

  await interaction.editReply({ embeds: [embed], components: [afterRow()] });
}

// ─────────────────────────────────────────────────────────────────────────────
// BLACKJACK (full real-rules implementation)
// ─────────────────────────────────────────────────────────────────────────────

async function startBlackjack(interaction, s) {
  const state = engine.dealBJ();
  updateSession(s.userId, { bjState: state });
  if (engine.handVal(state.player) === 21 && state.player.length === 2)
    return finishBJ(interaction, s, state);
  if (engine.canInsure(state)) return renderInsurance(interaction, s, state);
  return renderBJ(interaction, s, state, true);
}

async function renderInsurance(interaction, s, state) {
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('🛡️ Blackjack — Insurance?')
    .setDescription(
      `\`\`\`\nDEALER — ${state.dealer[0].r} + ?\n${engine.renderHandArt(state.dealer, [1])}\n\nYOU — ${engine.handVal(state.player)}\n${engine.renderHandArt(state.player)}\n\`\`\`` +
      `\nDealer may have Blackjack. Take **insurance** for half your bet (**${fmt(Math.floor(s.bet / 2))}** coins)?\n` +
      `Insurance pays **2:1** if dealer has Blackjack.`,
    )
    .addFields(
      { name: '💸 Bet', value: `**${fmt(s.bet)}** coins`, inline: true },
    )
    .setFooter({ text: 'YSER Flow Casino' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cs:bj:insurance_yes').setLabel('🛡️ Take Insurance').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cs:bj:insurance_no').setLabel('❌ No Thanks').setStyle(ButtonStyle.Secondary),
  );
  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function renderBJ(interaction, s, state, initial = false) {
  const pv     = engine.handVal(state.player);
  const splitPv = state.splitHand ? engine.handVal(state.splitHand) : null;

  if (!initial && !state.playingSplit && (pv > 21 || pv === 21)) {
    if (state.splitHand && !state.splitDone) {
      const ns = engine.bjFirstHandDone(state);
      updateSession(s.userId, { bjState: ns });
      return renderBJ(interaction, s, ns, true);
    }
    unlock(s.userId);
    return finishBJ(interaction, s, state);
  }
  if (state.playingSplit && splitPv !== null && (splitPv > 21 || splitPv === 21)) {
    unlock(s.userId);
    return finishBJ(interaction, s, state);
  }

  const activeHand   = state.playingSplit ? state.splitHand : state.player;
  const activeVal    = engine.handVal(activeHand);
  const canDouble    = activeHand.length === 2 && hasEnough(s.userId, s.bet);
  const canSplitNow  = engine.canSplit(state) && initial && hasEnough(s.userId, s.bet);
  const canSurrender = !state.playingSplit && state.player.length === 2 && !state.splitHand;

  const dealerArt = engine.renderHandArt(state.dealer, [1]);
  let desc;
  if (state.splitHand) {
    const h1Art = engine.renderHandArt(state.player);
    const h2Art = engine.renderHandArt(state.splitHand);
    const h1Tag = !state.playingSplit ? '▶ HAND 1' : 'HAND 1';
    const h2Tag =  state.playingSplit ? '▶ HAND 2' : 'HAND 2';
    desc = `\`\`\`\nDEALER — ${state.dealer[0].r} + ?\n${dealerArt}\n\n${h1Tag} — ${engine.handVal(state.player)}\n${h1Art}\n\n${h2Tag} — ${engine.handVal(state.splitHand)}\n${h2Art}\n\`\`\``;
  } else {
    const playerArt = engine.renderHandArt(state.player);
    desc = `\`\`\`\nDEALER — ${state.dealer[0].r} + ?\n${dealerArt}\n\nYOU — ${activeVal}\n${playerArt}\n\`\`\``;
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🃏 Blackjack')
    .setDescription(desc)
    .addFields({ name: '💸 Bet', value: `**${fmt(s.bet)}** coins`, inline: true })
    .setFooter({ text: 'YSER Flow Casino  •  Dealer hits soft 17  •  BJ pays 3:2' });

  const btns = [
    new ButtonBuilder().setCustomId('cs:bj:hit').setLabel('👆 Hit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cs:bj:stand').setLabel('✋ Stand').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cs:bj:double').setLabel('⬆️ Double').setStyle(ButtonStyle.Secondary).setDisabled(!canDouble),
  ];
  if (canSplitNow)  btns.push(new ButtonBuilder().setCustomId('cs:bj:split').setLabel('✂️ Split').setStyle(ButtonStyle.Primary));
  if (canSurrender) btns.push(new ButtonBuilder().setCustomId('cs:bj:surrender').setLabel('🏳️ Surrender').setStyle(ButtonStyle.Secondary));

  await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btns.slice(0, 5))] });
}

async function handleBJ(interaction, s, action) {
  let state = s.bjState;
  if (!state) { unlock(s.userId); return expired(interaction); }

  if (action === 'insurance_yes') {
    const ib = Math.floor(s.bet / 2);
    if (!hasEnough(s.userId, ib)) { unlock(s.userId); return interaction.followUp({ content: '❌ Not enough coins for insurance.', flags: 64 }); }
    removeCoins(s.userId, ib);
    state = engine.bjInsure(state);
    updateSession(s.userId, { bjState: state, insuranceBet: ib });
    unlock(s.userId);
    return renderBJ(interaction, s, state, true);
  }
  if (action === 'insurance_no') {
    state = engine.bjDeclineInsure(state);
    updateSession(s.userId, { bjState: state });
    unlock(s.userId);
    return renderBJ(interaction, s, state, true);
  }
  if (action === 'surrender') {
    const refund = Math.floor(s.bet / 2);
    addCoins(s.userId, refund);
    setCooldown(s.userId, 'casino');
    updateSession(s.userId, { lastResult: { label: '🏳️ Surrender', delta: -refund }, bjState: null });
    const embed = new EmbedBuilder()
      .setColor(0x95a5a6).setTitle('🃏 Blackjack — Surrendered')
      .setDescription(`You surrendered and received **${fmt(refund)}** coins back (half your bet).`)
      .addFields({ name: '💰 Balance', value: `**${fmt(getBalance(s.userId))}** coins`, inline: true })
      .setFooter({ text: 'YSER Flow Casino' });
    unlock(s.userId);
    return interaction.editReply({ embeds: [embed], components: [afterRow()] });
  }
  if (action === 'split') {
    if (!engine.canSplit(state) || !hasEnough(s.userId, s.bet)) { unlock(s.userId); return interaction.followUp({ content: '❌ Cannot split.', flags: 64 }); }
    removeCoins(s.userId, s.bet);
    state = engine.bjSplit(state);
    updateSession(s.userId, { bjState: state, splitBet: s.bet });
    unlock(s.userId);
    return renderBJ(interaction, s, state, true);
  }
  if (action === 'double') {
    if (!hasEnough(s.userId, s.bet)) { unlock(s.userId); return interaction.followUp({ content: '❌ Not enough coins to double.', flags: 64 }); }
    removeCoins(s.userId, s.bet);
    updateSession(s.userId, { bet: s.bet * 2 });
    s = getSession(s.userId);
    state = engine.bjDouble(state);
    updateSession(s.userId, { bjState: state });
    unlock(s.userId);
    return finishBJ(interaction, s, state);
  }
  if (action === 'hit') {
    state = engine.bjHit(state);
    updateSession(s.userId, { bjState: state });
    const val = engine.handVal(state.playingSplit ? state.splitHand : state.player);
    unlock(s.userId);
    if (val >= 21) {
      if (!state.playingSplit && state.splitHand) {
        const ns = engine.bjFirstHandDone(state);
        updateSession(s.userId, { bjState: ns });
        return renderBJ(interaction, s, ns, true);
      }
      return finishBJ(interaction, s, state);
    }
    return renderBJ(interaction, s, state);
  }
  if (action === 'stand') {
    if (state.splitHand && !state.playingSplit) {
      const ns = engine.bjFirstHandDone(state);
      updateSession(s.userId, { bjState: ns });
      unlock(s.userId);
      return renderBJ(interaction, s, ns, true);
    }
    unlock(s.userId);
    return finishBJ(interaction, s, state);
  }
  unlock(s.userId);
}

async function finishBJ(interaction, s, state) {
  const final   = engine.dealerPlay(state);
  const results = engine.bjResult(final);
  const dv = engine.handVal(final.dealer), pv = engine.handVal(final.player);

  const LABELS = { blackjack: '🃏 Natural Blackjack! 🎉', win: '🃏 You Win!', push: '🃏 Push', bust: '🃏 Bust', loss: '🃏 Dealer Wins', dealer_bust: '🃏 Dealer Busts!' };
  const COLORS  = { blackjack: 0xf1c40f, win: 0x2ecc71, push: 0x95a5a6, bust: 0xe74c3c, loss: 0xe74c3c, dealer_bust: 0x2ecc71 };
  const RLABELS = { blackjack: '🟡 BJ', win: '🟢 WIN', push: '⚪ Push', bust: '🔴 Bust', loss: '🔴 Loss', dealer_bust: '🟢 D.Bust' };

  let payout = 0;
  const main = results.main;
  if (main === 'blackjack') payout += Math.floor(s.bet * 2.5);
  else if (main === 'win' || main === 'dealer_bust') payout += s.bet * 2;
  else if (main === 'push') payout += s.bet;

  let splitPayout = 0;
  const splitBet = s.splitBet || 0;
  if (results.split) {
    const sp = results.split;
    if (sp === 'blackjack' || sp === 'win' || sp === 'dealer_bust') splitPayout += splitBet * 2;
    else if (sp === 'push') splitPayout += splitBet;
  }

  let insurancePayout = 0;
  const insuranceBet  = s.insuranceBet || 0;
  if (state.insuranceTaken && insuranceBet > 0) {
    if (engine.handVal(final.dealer) === 21 && final.dealer.length === 2)
      insurancePayout = insuranceBet * 3;
  }

  if (payout > 0)          addCoins(s.userId, payout);
  if (splitPayout > 0)     addCoins(s.userId, splitPayout);
  if (insurancePayout > 0) addCoins(s.userId, insurancePayout);

  const totalOut = payout + splitPayout + insurancePayout;
  const totalIn  = s.bet + splitBet + insuranceBet;
  const delta    = totalOut - totalIn;
  const newBal   = getBalance(s.userId);
  setCooldown(s.userId, 'casino');
  updateSession(s.userId, { lastResult: { label: RLABELS[main] || main, delta }, bjState: null, splitBet: null, insuranceBet: null });

  const dealerFinalArt = engine.renderHandArt(final.dealer);
  const playerFinalArt = engine.renderHandArt(final.player);
  let desc = `\`\`\`\nDEALER — ${dv}\n${dealerFinalArt}\n\nYOU — ${pv}\n${playerFinalArt}`;
  if (final.splitHand) {
    const splitArt = engine.renderHandArt(final.splitHand);
    desc += `\n\nSPLIT — ${engine.handVal(final.splitHand)}\n${splitArt}`;
  }
  desc += '\n\`\`\`';

  const embed = new EmbedBuilder()
    .setColor(COLORS[main] ?? 0x95a5a6)
    .setTitle(`🃏 Blackjack — ${LABELS[main] ?? main}`)
    .setDescription(desc)
    .addFields(
      { name: '💸 Bet',     value: `**${fmt(s.bet)}** coins`,                  inline: true },
      { name: '💵 Payout',  value: payout > 0 ? `**${fmt(payout)}** coins` : '—', inline: true },
      { name: '💰 Balance', value: `**${fmt(newBal)}** coins`,                 inline: true },
    )
    .setFooter({ text: 'YSER Flow Casino' });

  if (results.split) embed.addFields(
    { name: '✂️ Split', value: RLABELS[results.split] || results.split, inline: true },
    { name: '✂️ Split Payout', value: splitPayout > 0 ? `**${fmt(splitPayout)}**` : '—', inline: true },
  );
  if (insuranceBet > 0) embed.addFields({ name: '🛡️ Insurance', value: insurancePayout > 0 ? `Won **${fmt(insurancePayout)}**` : 'Lost', inline: true });

  unlock(s.userId);
  await interaction.editReply({ embeds: [embed], components: [afterRow()] });
}

// ─────────────────────────────────────────────────────────────────────────────
// TRADING
// ─────────────────────────────────────────────────────────────────────────────

async function startTrading(interaction, s) {
  const trade = engine.generateChart({ bet: s.bet, userId: s.userId });
  const { setupChartPng, ...tradeState } = trade;
  updateSession(s.userId, { tradeState });
  const chartName = `trading-setup-${s.userId}.png`;
  const setupChart = new AttachmentBuilder(setupChartPng, { name: chartName });
  const embed = new EmbedBuilder()
    .setColor(0x2c3e50).setTitle('📈 Trading — Setup')
    .setDescription('Generated market path for this round. Choose direction, then pick RR.')
    .setImage(`attachment://${chartName}`)
    .addFields(
      { name: '💸 Bet', value: `**${fmt(s.bet)}** coins`, inline: true },
      { name: '🎯 Entry', value: `\`${tradeState.entryPrice.toFixed(2)}\``, inline: true },
      { name: '📏 1R (Risk Unit)', value: `\`${tradeState.riskUnit.toFixed(2)}\``, inline: true },
      { name: '📦 Position Size', value: `\`${tradeState.positionSize.toFixed(2)}\``, inline: true },
    )
    .setFooter({ text: 'YSER Flow Casino  •  Pick direction' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cs:tr:buy').setLabel('📈 BUY (Long)').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cs:tr:sell').setLabel('📉 SELL (Short)').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cs:menu').setLabel('← Back').setStyle(ButtonStyle.Secondary),
  );
  unlock(s.userId);
  await interaction.editReply({ embeds: [embed], components: [row], files: [setupChart] });
}

async function showRRChoice(interaction, s) {
  const embed = new EmbedBuilder()
    .setColor(0x2c3e50).setTitle('📈 Trading — Risk/Reward')
    .setDescription('Pick your **Risk:Reward** ratio. Outcome is resolved from this round’s generated price path.')
    .addFields(
      { name: '1:1', value: 'Payout: **2×**', inline: true },
      { name: '1:2', value: 'Payout: **3×**', inline: true },
      { name: '1:3', value: 'Payout: **4×**', inline: true },
    )
    .setFooter({ text: 'YSER Flow Casino' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cs:tr:rr:1:1').setLabel('1:1').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cs:tr:rr:1:2').setLabel('1:2').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cs:tr:rr:1:3').setLabel('1:3').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cs:menu').setLabel('← Back').setStyle(ButtonStyle.Secondary),
  );
  unlock(s.userId);
  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ─────────────────────────────────────────────────────────────────────────────
// DICE — vs bot or PvP
// ─────────────────────────────────────────────────────────────────────────────

async function showDiceModeSelect(interaction, s) {
  const odds = engine.randomDiceOdds();
  updateSession(s.userId, { diceOdds: odds });
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🎲 Dice')
    .setDescription(
      `Roll a die — whoever gets the higher number wins!\n\n` +
      `**Odds this round:** \`${odds}×\`  ·  Tie → push`,
    )
    .addFields(
      { name: '💸 Bet',     value: `**${fmt(s.bet)}** coins`,               inline: true },
      { name: '💰 Balance', value: `**${fmt(getBalance(s.userId))}** coins`, inline: true },
    )
    .setFooter({ text: 'YSER Flow Casino  •  Odds are randomised each game' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cs:dicemode:bot').setLabel('🤖 vs Bot').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cs:dicemode:pvp').setLabel('👥 vs Player').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cs:menu').setLabel('← Back').setStyle(ButtonStyle.Secondary),
  );
  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function resolveDiceVsBot(interaction, s) {
  const odds   = s.diceOdds ?? 2.0;
  const result = engine.playDiceVsBot(odds);
  let payout = 0;
  if (result.push)     payout = s.bet;
  else if (result.won) payout = Math.floor(s.bet * odds);
  if (payout > 0) addCoins(s.userId, payout);
  const delta  = payout - s.bet, newBal = getBalance(s.userId);
  setCooldown(s.userId, 'casino');
  updateSession(s.userId, {
    lastResult: { label: result.push ? '⚪ Push' : result.won ? `🟢 ×${odds}` : '🔴 LOSS', delta },
    diceOdds: null,
  });
  const title = result.push ? '⚖️ Tie — Push!' : result.won ? '🏆 You Win!' : '💀 Bot Wins!';
  const embed = new EmbedBuilder()
    .setColor(result.push ? 0x95a5a6 : result.won ? 0x2ecc71 : 0xe74c3c)
    .setTitle(`🎲 Dice — ${title}`)
    .setDescription(
      `You rolled ${engine.DICE_FACES[result.playerRoll]} **${result.playerRoll}**\n` +
      `Bot rolled ${engine.DICE_FACES[result.botRoll]} **${result.botRoll}**`,
    )
    .addFields(
      { name: '🎯 Odds',    value: `**${odds}×**`,                                                              inline: true },
      { name: '💸 Bet',     value: `**${fmt(s.bet)}** coins`,                                                   inline: true },
      { name: result.won ? '💵 Won' : result.push ? '↩️ Returned' : '💸 Lost',
        value: `**${fmt(result.push ? s.bet : result.won ? payout : s.bet)}** coins`,                           inline: true },
      { name: '💰 Balance', value: `**${fmt(newBal)}** coins`,                                                  inline: true },
    )
    .setFooter({ text: 'YSER Flow Casino' });
  unlock(s.userId);
  await interaction.editReply({ embeds: [embed], components: [afterRow()] });
}

async function showDicePvpChallenge(interaction, s) {
  global.diceChallenges.set(s.userId, { bet: s.bet, timestamp: Date.now() });
  setTimeout(() => { global.diceChallenges.delete(s.userId); }, 5 * 60 * 1000);
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🎲 Dice — Challenge Open!')
    .setDescription(
      `<@${s.userId}> challenges anyone to a dice duel!\n\n` +
      `**Bet:** \`${fmt(s.bet)}\` coins each — winner takes **${fmt(s.bet * 2)}** coins!\n\n` +
      `*Expires in 5 minutes*`,
    )
    .setFooter({ text: 'YSER Flow Casino  •  First to accept wins the duel slot' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cs:diceaccept:${s.userId}:${s.bet}`)
      .setLabel(`Accept ⚔️  (${fmt(s.bet)} coins)`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('cs:dicepvpcancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger),
  );
  unlock(s.userId);
  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ─────────────────────────────────────────────────────────────────────────────
// ROULETTE — bet type pick → amount → spin
// ─────────────────────────────────────────────────────────────────────────────

async function showRoulettePick(interaction, s) {
  const embed = new EmbedBuilder()
    .setColor(0xC0392B)
    .setTitle('🎡  Roulette — Pick Your Bet Type')
    .setDescription(
      '**Outside Bets** (1:1) — Red, Black, Odd, Even\n' +
      '**Dozens** (2:1) — 1–12, 13–24, 25–36\n' +
      '**Straight Up** (35:1) — Pick any single number 0–36\n\u200b',
    )
    .setFooter({ text: 'YSER Flow Casino  •  European Roulette (single zero)' });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cs:rl:red').setLabel('🔴 Red').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cs:rl:black').setLabel('⚫ Black').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cs:rl:odd').setLabel('🔢 Odd').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cs:rl:even').setLabel('🔢 Even').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cs:menu').setLabel('← Back').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cs:rl:1-12').setLabel('1–12').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cs:rl:13-24').setLabel('13–24').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cs:rl:25-36').setLabel('25–36').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cs:rl:straight').setLabel('🎯 Straight (35:1)').setStyle(ButtonStyle.Primary),
  );
  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

async function resolveRoulette(interaction, s) {
  if (!s.rouletteState?.betType) { unlock(s.userId); return expired(interaction); }
  const { betType, betValue } = s.rouletteState;
  const spin    = engine.spinRoulette();
  const result  = engine.rouletteResult(spin, betType, betValue);
  const payout  = result.won ? Math.floor(s.bet * result.mult) : 0;
  if (payout > 0) addCoins(s.userId, payout);
  const delta   = payout - s.bet;
  const newBal  = getBalance(s.userId);
  setCooldown(s.userId, 'casino');

  const betLabel = betType === 'straight' ? `Straight #${betValue}` : betType.replace(/-/g, '–').replace(/^./, c => c.toUpperCase());
  const colorEmoji = spin.color === 'red' ? '🔴' : spin.color === 'black' ? '⚫' : '🟢';

  updateSession(s.userId, {
    lastResult: { label: result.won ? `🟢 WIN ×${result.mult}` : '🔴 LOSS', delta },
    rouletteState: null,
  });

  const embed = new EmbedBuilder()
    .setColor(result.won ? 0x2ECC71 : 0xE74C3C)
    .setTitle(`🎡  Roulette — ${result.won ? 'Winner! 🎉' : 'No Luck'}`)
    .setDescription(engine.renderRouletteWheel(spin.num, spin.color))
    .addFields(
      { name: '🎯 Result',   value: `${colorEmoji} **${spin.num}** (${spin.color})`,              inline: true },
      { name: '📋 Your Bet', value: `**${betLabel}** — ${result.won ? `×${result.mult}` : 'miss'}`, inline: true },
      { name: '💸 Bet',      value: `**${fmt(s.bet)}** coins`,                                     inline: true },
      { name: '💵 Payout',   value: payout > 0 ? `**${fmt(payout)}** coins` : '—',                 inline: true },
      { name: '💰 Balance',  value: `**${fmt(newBal)}** coins`,                                    inline: true },
    )
    .setFooter({ text: 'YSER Flow Casino  •  European Roulette' });

  unlock(s.userId);
  await interaction.editReply({ embeds: [embed], components: [afterRow()] });
}

// ─────────────────────────────────────────────────────────────────────────────
// WHEEL OF FORTUNE — spin for a random multiplier
// ─────────────────────────────────────────────────────────────────────────────

async function resolveWheel(interaction, s) {
  // ── Daily spin limit ───────────────────────────────────────────────────────
  const { spinsLeft, used } = checkWheelLimit(s.userId);
  if (spinsLeft <= 0) {
    // Refund the bet since we're blocking after coins were already removed
    addCoins(s.userId, s.bet);
    return interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle('🎰  Wheel of Fortune — Daily Limit Reached')
      .setDescription(`You've used all **${WHEEL_DAILY_LIMIT} spins** for today.\nCome back tomorrow for more!`)
      .addFields({ name: '♻️ Refunded', value: `**${fmt(s.bet)}** coins returned to your balance`, inline: true })
      .setFooter({ text: 'Limit resets at midnight UTC' })], components: [] });
  }

  // Spin animation
  const spinEmbed = new EmbedBuilder()
    .setColor(0xFF6B35)
    .setTitle('🎰  Wheel of Fortune — Spinning…')
    .setDescription(engine.renderWheelDisplay(null, true))
    .addFields(
      { name: '💸 Bet',        value: `**${fmt(s.bet)}** coins`,                          inline: true },
      { name: '🎡 Spins Left', value: `**${spinsLeft - 1}** remaining today`, inline: true },
    )
    .setFooter({ text: 'YSER Flow Casino' });
  await interaction.editReply({ embeds: [spinEmbed], components: [] });
  await wait(1500);

  const segment = engine.spinWheel();
  const payout  = segment.mult > 0 ? Math.floor(s.bet * segment.mult) : 0;
  if (payout > 0) addCoins(s.userId, payout);
  const delta   = payout - s.bet;
  const newBal  = getBalance(s.userId);
  recordWheelSpin(s.userId);
  setCooldown(s.userId, 'casino');
  updateSession(s.userId, {
    lastResult: { label: segment.mult > 1 ? `🟢 ×${segment.mult}` : segment.mult === 1 ? '⚪ Push' : '🔴 Bankrupt', delta },
  });

  const spinsAfter  = WHEEL_DAILY_LIMIT - (used + 1);
  const colorMap = { jackpot: 0xFFD700, bigwin: 0x27AE60, win: 0x2ECC71, push: 0x95A5A6, lose: 0xE74C3C };
  const embed = new EmbedBuilder()
    .setColor(colorMap[segment.color] || 0xE74C3C)
    .setTitle(`🎰  Wheel of Fortune — ${segment.label}${segment.mult >= 10 ? ' 🎊' : ''}`)
    .setDescription(engine.renderWheelDisplay(segment))
    .addFields(
      { name: '💸 Bet',        value: `**${fmt(s.bet)}** coins`,                                        inline: true },
      { name: '💵 Payout',     value: payout > 0 ? `**${fmt(payout)}** coins (${segment.label})` : '—', inline: true },
      { name: '💰 Balance',    value: `**${fmt(newBal)}** coins`,                                       inline: true },
      { name: '🎡 Spins Left', value: spinsAfter > 0 ? `**${spinsAfter}** remaining today` : '**0** — come back tomorrow!', inline: true },
    )
    .setFooter({ text: 'YSER Flow Casino  •  Wheel of Fortune  •  5 spins/day' });

  await interaction.editReply({ embeds: [embed], components: [afterRow()] });
}

async function resolveTrading(interaction, s, direction, rr) {
  if (!s.tradeState) { unlock(s.userId); return expired(interaction); }
  const res  = engine.resolveTradeWithChart(s.tradeState, direction, rr, s.bet);
  if (!res.validation?.ok || res.tradeId !== s.tradeState.tradeId) {
    addCoins(s.userId, s.bet);
    updateSession(s.userId, { tradeState: null, lastResult: { label: '⚠️ Trade Invalid', delta: 0 } });
    unlock(s.userId);
    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle('📈 Trading — Round Invalidated')
        .setDescription('Trade state validation failed. Your bet was fully refunded.')
        .addFields({ name: '♻️ Refunded', value: `**${fmt(s.bet)}** coins`, inline: true })],
      components: [afterRow()],
    });
  }
  const payout = res.won ? s.bet * res.multiplier : 0;
  if (payout > 0) addCoins(s.userId, payout);
  const delta = payout - s.bet, newBal = getBalance(s.userId);
  setCooldown(s.userId, 'casino');
  updateSession(s.userId, { lastResult: { label: res.won ? `🟢 +${res.rrReward}R` : '🔴 LOSS', delta }, tradeState: null });
  const chartName = `trading-result-${s.userId}.png`;
  const chartAttachment = new AttachmentBuilder(res.chartPng, { name: chartName });
  const embed = new EmbedBuilder()
    .setColor(res.won ? 0x2ecc71 : 0xe74c3c)
    .setTitle(`📈 Trading — ${res.won ? `WIN  +${res.rrReward}R 🎉` : 'LOSS  -1R'}`)
    .setDescription(`**Direction:** ${direction.toUpperCase()}  |  **RR:** ${rr}  |  **Hit:** ${res.hitType.toUpperCase()}`)
    .setImage(`attachment://${chartName}`)
    .addFields(
      { name: '💸 Bet',     value: `**${fmt(s.bet)}** coins`,                  inline: true },
      { name: '💵 Payout',  value: payout > 0 ? `**${fmt(payout)}** coins` : '—', inline: true },
      { name: '💰 Balance', value: `**${fmt(newBal)}** coins`,                 inline: true },
      { name: '🎯 Entry',   value: `\`${res.entryPrice.toFixed(2)}\``,         inline: true },
      { name: '🛑 Stop',    value: `\`${res.sl.toFixed(2)}\``,                 inline: true },
      { name: '✅ Target',  value: `\`${res.tp.toFixed(2)}\``,                 inline: true },
    )
    .setFooter({ text: 'YSER Flow Casino' });
  unlock(s.userId);
  await interaction.editReply({ embeds: [embed], components: [afterRow()], files: [chartAttachment] });
}
