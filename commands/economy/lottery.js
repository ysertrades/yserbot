'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { getBalance, removeCoins } = require('../../utils/economyManager');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { todaysSlotUTC, REWARD, drawStatus } = require('../../utils/lotteryRunner');

const TICKET_PRICE        = 500;
const MAX_TICKETS_PER_DAY = 20;
const LOTTERY_FILE        = 'lottery.json';
const DAY_MS              = 24 * 60 * 60 * 1000;
const fmt = n => Number(n).toLocaleString();

function getState(guildId) {
  const data = readJson(LOTTERY_FILE, {});
  return data[guildId] || { pool: {}, lastDrawAt: 0, history: [] };
}

function saveState(guildId, state) {
  const data = readJson(LOTTERY_FILE, {});
  data[guildId] = state;
  writeJson(LOTTERY_FILE, data);
}

function nextDrawTs(now = Date.now()) {
  const slot = todaysSlotUTC(now);
  return slot > now ? slot : slot + DAY_MS;
}

/**
 * What to tell a member when there is no draw coming.
 *
 * Both cases have to say what happens to tickets they already hold, because
 * that is the only question anyone actually has — pausing keeps the pool, so
 * their entries are not lost, and saying so is the difference between a
 * closed shop and a robbery.
 */
const CLOSED_MESSAGE = {
  paused: {
    title: '⏸️ The Lottery Is Paused',
    body: 'An admin has switched the daily draw off, so tickets are not on sale right now.\n\n'
      + 'Any tickets you already hold are safe — the pool is kept exactly as it is and goes into the next draw when the lottery resumes.',
  },
  no_channel: {
    title: '🚧 The Lottery Is Not Set Up',
    body: 'This server has no lottery results channel, so no draw can take place — selling you a ticket for it would be taking your coins for nothing.\n\n'
      + 'An admin can set one with `/lottery channel`, or from the Economy screen in the panel.',
  },
};

function closedEmbed(reason) {
  const copy = CLOSED_MESSAGE[reason] || CLOSED_MESSAGE.no_channel;
  return new EmbedBuilder().setColor(0xE67E22).setTitle(copy.title).setDescription(copy.body);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lottery')
    .setDescription('Buy tickets for the daily lottery draw')
    .addSubcommand(sub => sub.setName('buy').setDescription(`Buy lottery tickets (${TICKET_PRICE} coins each, max ${MAX_TICKETS_PER_DAY}/day)`)
      .addIntegerOption(o => o.setName('quantity').setDescription('How many tickets').setMinValue(1).setMaxValue(MAX_TICKETS_PER_DAY).setRequired(false)))
    .addSubcommand(sub => sub.setName('pool').setDescription("View today's ticket pool and time until the draw"))
    .addSubcommand(sub => sub.setName('channel').setDescription('Set the draw-announcement channel (admin only)')
      .addChannelOption(o => o.setName('channel').setDescription('Announcement channel').addChannelTypes(ChannelType.GuildText).setRequired(true))),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const userId  = interaction.user.id;
    const guildId = interaction.guild.id;

    if (sub === 'channel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild))
        return interaction.reply({ content: '❌ You need the **Manage Server** permission to set the lottery channel.', flags: MessageFlags.Ephemeral });

      const channel = interaction.options.getChannel('channel');
      const config  = readJson('config.json', {});
      if (!config[guildId]) config[guildId] = {};
      // Merged, not replaced. This assigned a fresh object, so setting the
      // channel here silently cleared `paused` — an admin who paused the
      // lottery in the panel and later pointed it at a channel from Discord
      // restarted the draw without ever asking to. Every other settings
      // writer in the bot merges; this was the one that did not.
      config[guildId].lotterySettings = { ...(config[guildId].lotterySettings || {}), channelId: channel.id };
      writeJson('config.json', config);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ Lottery Channel Set')
        .setDescription(`Draw results will be announced in ${channel}.`)], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'buy') {
      // Checked before anything is charged. A ticket is only worth buying if
      // a draw is going to happen, and until now neither of the two things
      // that stop a draw stopped the sale.
      const status = drawStatus(guildId);
      if (!status.open) {
        return interaction.reply({ embeds: [closedEmbed(status.reason)], flags: MessageFlags.Ephemeral });
      }

      const qty   = interaction.options.getInteger('quantity') || 1;
      const state = getState(guildId);
      const owned = state.pool[userId] || 0;
      if (owned + qty > MAX_TICKETS_PER_DAY)
        return interaction.reply({ content: `❌ You can only hold **${MAX_TICKETS_PER_DAY}** tickets per day — you already have **${owned}**.`, flags: MessageFlags.Ephemeral });

      const cost    = qty * TICKET_PRICE;
      const balance = getBalance(userId);
      if (balance < cost)
        return interaction.reply({ content: `❌ You need **${fmt(cost)}** coins but only have **${fmt(balance)}**.`, flags: MessageFlags.Ephemeral });

      removeCoins(userId, cost);
      state.pool[userId] = owned + qty;
      saveState(guildId, state);

      const totalTickets = Object.values(state.pool).reduce((s, c) => s + c, 0);
      const drawTs = Math.floor(nextDrawTs() / 1000);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('🎟️ Tickets Purchased!')
        .setDescription(`You bought **${qty}** ticket${qty !== 1 ? 's' : ''} for **${fmt(cost)}** coins.\nYou now hold **${state.pool[userId]}/${MAX_TICKETS_PER_DAY}** tickets today.`)
        .addFields(
          { name: '💰 Balance',    value: `**${fmt(getBalance(userId))}** coins`, inline: true },
          { name: '🎫 Pool Total', value: `**${totalTickets}** tickets`,          inline: true },
          { name: '⏰ Next Draw',  value: `<t:${drawTs}:R>`,                      inline: true },
        )
        .setFooter({ text: `Prize: ${fmt(REWARD)} coins to one winner, weighted by ticket count` })
        .setTimestamp()] });
    }

    if (sub === 'pool') {
      const state   = getState(guildId);
      const entries = Object.entries(state.pool).sort((a, b) => b[1] - a[1]);
      const totalTickets = entries.reduce((s, [, c]) => s + c, 0);
      const drawTs  = Math.floor(nextDrawTs() / 1000);
      const lastWin = state.history?.[0];

      const lines = entries.slice(0, 15).map(([uid, count]) => `<@${uid}> — **${count}** ticket${count !== 1 ? 's' : ''}`);

      // A countdown to a draw that cannot happen is worse than no countdown
      // — it is the screen telling somebody their tickets are about to pay
      // out. When the lottery is closed the slot says so instead.
      const status = drawStatus(guildId);
      const fields = [
        { name: '🎫 Total Tickets', value: `**${totalTickets}**`, inline: true },
        { name: '👥 Participants',  value: `**${entries.length}**`, inline: true },
        status.open
          ? { name: '⏰ Next Draw', value: `<t:${drawTs}:R>`, inline: true }
          : { name: '⏸️ Next Draw', value: status.reason === 'paused' ? '**Paused**' : '**Not set up**', inline: true },
      ];
      if (lastWin) {
        fields.push({
          name: '🏆 Last Winner',
          value: `<@${lastWin.winnerId}> won **${fmt(REWARD)}** coins (${lastWin.ticketsInPool} tickets in the pool)`,
          inline: false,
        });
      }

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(status.open ? 0xF1C40F : 0xE67E22)
        .setTitle('🎟️ Daily Lottery Pool')
        .setDescription([
          status.open ? null : CLOSED_MESSAGE[status.reason].body,
          entries.length ? lines.join('\n') : (status.open ? "No tickets bought yet today — be the first with `/lottery buy`!" : null),
        ].filter(Boolean).join('\n\n') || 'Nothing in the pool.')
        .addFields(fields)
        .setFooter({ text: `Prize: ${fmt(REWARD)} coins • Ticket price: ${fmt(TICKET_PRICE)} coins` })
        .setTimestamp()] });
    }
  },
};
