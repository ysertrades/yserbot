'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getBalance, removeCoins } = require('../../utils/economyManager');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { todaysSlotUTC, REWARD } = require('../../utils/lotteryRunner');

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
        return interaction.reply({ content: '❌ You need the **Manage Server** permission to set the lottery channel.', ephemeral: true });

      const channel = interaction.options.getChannel('channel');
      const config  = readJson('config.json', {});
      if (!config[guildId]) config[guildId] = {};
      config[guildId].lotterySettings = { channelId: channel.id };
      writeJson('config.json', config);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ Lottery Channel Set')
        .setDescription(`Draw results will be announced in ${channel}.`)], ephemeral: true });
    }

    if (sub === 'buy') {
      const qty   = interaction.options.getInteger('quantity') || 1;
      const state = getState(guildId);
      const owned = state.pool[userId] || 0;
      if (owned + qty > MAX_TICKETS_PER_DAY)
        return interaction.reply({ content: `❌ You can only hold **${MAX_TICKETS_PER_DAY}** tickets per day — you already have **${owned}**.`, ephemeral: true });

      const cost    = qty * TICKET_PRICE;
      const balance = getBalance(userId);
      if (balance < cost)
        return interaction.reply({ content: `❌ You need **${fmt(cost)}** coins but only have **${fmt(balance)}**.`, ephemeral: true });

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

      const fields = [
        { name: '🎫 Total Tickets', value: `**${totalTickets}**`, inline: true },
        { name: '👥 Participants',  value: `**${entries.length}**`, inline: true },
        { name: '⏰ Next Draw',     value: `<t:${drawTs}:R>`,        inline: true },
      ];
      if (lastWin) {
        fields.push({
          name: '🏆 Last Winner',
          value: `<@${lastWin.winnerId}> won **${fmt(REWARD)}** coins (${lastWin.ticketsInPool} tickets in the pool)`,
          inline: false,
        });
      }

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('🎟️ Daily Lottery Pool')
        .setDescription(entries.length ? lines.join('\n') : "No tickets bought yet today — be the first with `/lottery buy`!")
        .addFields(fields)
        .setFooter({ text: `Prize: ${fmt(REWARD)} coins • Ticket price: ${fmt(TICKET_PRICE)} coins` })
        .setTimestamp()] });
    }
  },
};
