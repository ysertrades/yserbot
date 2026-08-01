'use strict';

/**
 * gatherCommand.js
 *
 * Shared session/cooldown mechanics for /fish and /mine: 10 uses per
 * session (persisted across restarts so a "Close" doesn't forfeit unused
 * uses), a 2-hour cooldown that only starts once the session is fully
 * used up, and a "play again" + "Close" button pair. fish.js/mine.js each
 * just supply their reward table, visual generator, and copy.
 */

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { addCoins, getBalance, checkCooldown, setCooldown } = require('./economyManager');
const { getEffect } = require('./effectsManager');
const { readJson, writeJson } = require('./jsonStorage');
const { activity, scalePayout, boostNote } = require('./economySettings');
const { refuseIfOff } = require('./economyGate');
const { formatDuration } = require('./duration');

const SESSIONS_FILE = 'gatherSessions.json';
const fmt = n => Number(n).toLocaleString();

function getRemaining(userId, action, sessionUses) {
  const sessions = readJson(SESSIONS_FILE, {});
  const val = sessions[`${userId}_${action}`];
  if (val === undefined) return sessionUses;
  // A session that was opened when the limit was higher must not outlive a
  // server lowering it — otherwise the old allowance quietly persists for
  // everyone who was mid-session when the setting changed.
  return Math.min(val, sessionUses);
}

function setRemaining(userId, action, remaining) {
  const sessions = readJson(SESSIONS_FILE, {});
  sessions[`${userId}_${action}`] = remaining;
  writeJson(SESSIONS_FILE, sessions);
}

function clearRemaining(userId, action) {
  const sessions = readJson(SESSIONS_FILE, {});
  delete sessions[`${userId}_${action}`];
  writeJson(SESSIONS_FILE, sessions);
}

function rollFromTable(table) {
  const total = table.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  for (const entry of table) {
    r -= entry.weight;
    if (r <= 0) return entry;
  }
  return table[table.length - 1];
}

function buildGatherCommand(cfg) {
  const {
    action, commandName, description, table, generateImage, imagePrefix,
    embedTitle, embedColor, cooldownTitle, buttonLabel, buttonEmoji, sessionNoun, cooldownVerb,
  } = cfg;

  async function runGather(interaction, userId, isButton) {
    const guildId = interaction.guild?.id;
    // Named econ rather than cfg: the enclosing buildGatherCommand(cfg) has a
    // parameter by that name and shadowing it here would be a trap.
    const econ = activity(guildId, action);
    const cd = checkCooldown(userId, action, econ.cooldownMs, guildId);

    if (cd > 0) {
      const hours   = Math.floor(cd / 3600000);
      const minutes = Math.floor((cd % 3600000) / 60000);
      const cooldownEmbed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle(cooldownTitle)
        .setDescription(`You've used all your ${sessionNoun} for this session.\nYou need to wait **${hours}h ${minutes}m** before ${cooldownVerb} again.`);
      if (isButton) return interaction.update({ embeds: [cooldownEmbed], components: [], attachments: [] });
      return interaction.reply({ embeds: [cooldownEmbed], flags: MessageFlags.Ephemeral });
    }

    let remaining = getRemaining(userId, action, econ.sessionUses);
    const item = rollFromTable(table);
    let reward = Math.floor(Math.random() * (item.max - item.min + 1)) + item.min;
    const boost = getEffect(userId, guildId, 'coin_boost');
    if (boost) reward = Math.floor(reward * (boost.multiplier || 1.5));
    reward = scalePayout(guildId, reward, econ.payScale);
    addCoins(userId, reward);

    remaining -= 1;

    const imageName = `${imagePrefix}_${Date.now()}.png`;
    const attachment = new AttachmentBuilder(generateImage({ name: item.name, rarity: item.rarity, reward }), { name: imageName });

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(embedTitle)
      .setDescription(`**Balance:** ${fmt(getBalance(userId))} coins${boost ? `\n💰 *Coin Boost active — ${boost.multiplier || 1.5}× earnings!*` : ''}${boostNote(guildId) ? `\n${boostNote(guildId)}` : ''}`)
      .setImage(`attachment://${imageName}`);

    const continueRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`gather_again:${action}:${userId}`).setLabel(buttonLabel).setEmoji(buttonEmoji).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`gather_close:${action}:${userId}`).setLabel('Close').setStyle(ButtonStyle.Secondary),
    );

    let components = [];
    if (remaining > 0) {
      setRemaining(userId, action, remaining);
      embed.setFooter({ text: `${remaining}/${econ.sessionUses} ${sessionNoun} left this session` });
      components = [continueRow];
    } else {
      const skip = getEffect(userId, guildId, 'cooldown_skip');
      if (skip) {
        // Cooldown Skip's whole point is unlimited play while it's active —
        // refill instead of ending the session so Continue keeps working
        // without forcing a manual /fish or /mine relaunch. setCooldown is
        // deliberately NOT called here: if a real cooldown was already
        // ticking before the skip started, it stays untouched in storage
        // and silently re-applies the instant the skip effect expires.
        setRemaining(userId, action, econ.sessionUses);
        embed.setFooter({ text: `⏩ Cooldown Skip active — unlimited ${sessionNoun}!` });
        components = [continueRow];
      } else {
        clearRemaining(userId, action);
        setCooldown(userId, action);
        embed.setFooter({ text: `Session complete — come back in ${formatDuration(econ.cooldownMs) || '2h'}` });
      }
    }

    // attachments: [] clears whatever image was on the message before this
    // edit (Discord keeps old attachments on a PATCH unless told otherwise),
    // so the new catch/find image replaces it instead of stacking above it.
    const payload = { embeds: [embed], files: [attachment], components, attachments: [] };
    if (isButton) return interaction.update(payload);
    return interaction.reply(payload);
  }

  return {
    data: new SlashCommandBuilder().setName(commandName).setDescription(description),

    async execute(interaction) {
      if (await refuseIfOff(interaction, action)) return;
      return runGather(interaction, interaction.user.id, false);
    },

    async handleButton(interaction) {
      const [prefix, act, userId] = interaction.customId.split(':');

      if (interaction.user.id !== userId) {
        return interaction.reply({ content: "❌ This isn't your session.", flags: MessageFlags.Ephemeral });
      }

      if (prefix === 'gather_close') {
        // Progress is stored server-side (gatherSessions.json), so deleting
        // the message doesn't lose it — matches every other Close button in
        // the bot (casino, shop, jobs), which all fully dismiss instead of
        // leaving an edited husk of the message behind.
        try { await interaction.message.delete(); } catch {}
        return;
      }

      if (prefix === 'gather_again') {
        // Checked again here, not just on the slash command: a session left
        // open in a channel outlives the setting being switched off.
        if (await refuseIfOff(interaction, action)) return;
        return runGather(interaction, userId, true);
      }
    },
  };
}

module.exports = { buildGatherCommand };
