'use strict';

const {
  SlashCommandBuilder, EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  MessageFlags,
} = require('discord.js');
const { getBalance, addCoins, removeCoins, getLeaderboard } = require('../../utils/economyManager');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { filterNonBotIds } = require('../../utils/discordHelpers');
const { fetchAvatarPng } = require('../../utils/avatarUtil');
const { generateBankCardImage, generateLeaderboardImage } = require('../../utils/bankVisual');
const { activity } = require('../../utils/economySettings');
const { refuseIfOff } = require('../../utils/economyGate');

const BANK_FILE = 'bank.json';

const fmt = n => Number(n).toLocaleString();

function getBank(userId) {
  const data = readJson(BANK_FILE, {});
  return data[userId] || { balance: 0, lastInterest: Date.now() };
}

function saveBank(userId, bankData) {
  const data = readJson(BANK_FILE, {});
  data[userId] = bankData;
  writeJson(BANK_FILE, data);
}

/**
 * Interest owed, and how many whole periods it covers.
 *
 * The period length is returned alongside because callers advance
 * lastInterest by it — reading the setting twice would let a change between
 * the two reads move the clock by a different amount than it paid for.
 */
function calcInterest(bankData, guildId) {
  const cfg = activity(guildId, 'bank');
  const periodMs = Math.max(1, cfg.periodHours) * 3600000;
  if (bankData.balance <= 0) return { interest: 0, periods: 0, periodMs };
  const periods  = Math.floor((Date.now() - bankData.lastInterest) / periodMs);
  const interest = Math.floor(bankData.balance * (cfg.interestPercent / 100) * periods);
  return { interest, periods, periodMs };
}

function errorEmbed(title, desc) {
  return new EmbedBuilder().setColor(0xFF4757).setTitle(`❌ ${title}`).setDescription(desc);
}

function avatarUrlFor(userOrMember) {
  return userOrMember.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true });
}

// ── Panel builders ───────────────────────────────────────────────────────────

async function buildBankPanel(member, ownerId) {
  const userId    = member.id;
  const bankData  = getBank(userId);
  const wallet    = getBalance(userId);
  const guildId   = member.guild?.id;
  const { interest } = calcInterest(bankData, guildId);
  const bankCfg   = activity(guildId, 'bank');
  const avatarPng = await fetchAvatarPng(avatarUrlFor(member));

  const imageName  = `bank_${Date.now()}.png`;
  const attachment = new AttachmentBuilder(generateBankCardImage({
    avatarPng, username: member.displayName, wallet, bank: bankData.balance, interestReady: interest,
    interestPercent: bankCfg.interestPercent, periodHours: bankCfg.periodHours,
  }), { name: imageName });
  const embed = new EmbedBuilder().setImage(`attachment://${imageName}`);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bank_panel:deposit:${ownerId}`).setLabel('Deposit').setEmoji('💵').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bank_panel:withdraw:${ownerId}`).setLabel('Withdraw').setEmoji('🏦').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bank_panel:collect:${ownerId}`).setLabel('Collect Interest').setEmoji('💹').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bank_panel:checkbalance:${ownerId}`).setLabel('Check Balance').setEmoji('🔍').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bank_panel:leaderboard:${ownerId}`).setLabel('Leaderboard').setEmoji('🏆').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bank_close:${ownerId}`).setLabel('Close').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], files: [attachment], components: [row1, row2] };
}

function buildAmountModal(action, ownerId) {
  return new ModalBuilder()
    .setCustomId(`bank_amount_modal:${action}:${ownerId}`)
    .setTitle(action === 'deposit' ? 'Deposit Coins' : 'Withdraw Coins')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('amount').setLabel('Amount').setStyle(TextInputStyle.Short)
        .setRequired(true).setPlaceholder('e.g. 500'),
    ));
}

async function buildLeaderboardPayload(interaction) {
  const candidates = getLeaderboard(30);
  const humanIds   = new Set(await filterNonBotIds(interaction.client, candidates.map(e => e.userId)));
  const ranked     = candidates.filter(e => humanIds.has(e.userId)).slice(0, 10);

  const entries = [];
  for (const e of ranked) {
    const member = interaction.guild.members.cache.get(e.userId)
      ?? await interaction.guild.members.fetch(e.userId).catch(() => null);
    if (!member) continue;
    entries.push({
      avatarPng: await fetchAvatarPng(avatarUrlFor(member)),
      username: member.displayName,
      balance: e.balance,
    });
  }

  const imageName  = `bank_leaderboard_${Date.now()}.png`;
  const attachment = new AttachmentBuilder(generateLeaderboardImage({ entries, guildName: interaction.guild.name }), { name: imageName });
  return { content: null, embeds: [new EmbedBuilder().setImage(`attachment://${imageName}`)], files: [attachment], components: [] };
}

// ── Command ──────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bank')
    .setDescription('View your bank account, deposit, withdraw, and earn interest'),

  async execute(interaction) {
    if (await refuseIfOff(interaction, 'bank')) return;
    const payload = await buildBankPanel(interaction.member, interaction.user.id);
    await interaction.reply(payload);
  },

  async handleButton(interaction) {
    const [, action, ownerId] = interaction.customId.split(':');
    if (interaction.user.id !== ownerId) {
      return interaction.reply({ content: "❌ This isn't your bank panel.", flags: MessageFlags.Ephemeral });
    }
    const userId = interaction.user.id;

    if (action === 'deposit' || action === 'withdraw') {
      return interaction.showModal(buildAmountModal(action, ownerId));
    }

    if (action === 'collect') {
      const bankData = getBank(userId);
      const { interest, periods, periodMs } = calcInterest(bankData, interaction.guild?.id);
      if (interest <= 0) {
        const nextTs = Math.floor((bankData.lastInterest + periodMs) / 1000);
        return interaction.reply({ embeds: [errorEmbed('No Interest Yet', `Next interest period: <t:${nextTs}:R>`)], flags: MessageFlags.Ephemeral });
      }
      bankData.lastInterest += periods * periodMs;
      bankData.balance      += interest;
      saveBank(userId, bankData);

      const payload = await buildBankPanel(interaction.member, ownerId);
      // attachments: [] — the panel this replaces already carries a bank
      // card, and Discord keeps old attachments on an edit unless told not to.
      return interaction.update({ ...payload, attachments: [] });
    }

    if (action === 'checkbalance') {
      const select = new UserSelectMenuBuilder().setCustomId(`bank_checkbalance_select:${ownerId}`).setPlaceholder('Select a user…').setMinValues(1).setMaxValues(1);
      return interaction.reply({ content: 'Pick a user to check their balance:', components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
    }

    if (action === 'leaderboard') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const payload = await buildLeaderboardPayload(interaction);
      return interaction.editReply(payload);
    }
  },

  async handleClose(interaction) {
    const ownerId = interaction.customId.split(':')[1];
    if (interaction.user.id !== ownerId) {
      return interaction.reply({ content: "❌ Only the person who opened this bank panel can close it.", flags: MessageFlags.Ephemeral });
    }
    try { await interaction.message.delete(); } catch {}
  },

  async handleModal(interaction) {
    const [, action, ownerId] = interaction.customId.split(':');
    if (interaction.user.id !== ownerId) {
      return interaction.reply({ content: "❌ This isn't your bank panel.", flags: MessageFlags.Ephemeral });
    }
    const userId    = interaction.user.id;
    const amountRaw = interaction.fields.getTextInputValue('amount').trim().replace(/,/g, '');
    const amount    = parseInt(amountRaw, 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      return interaction.reply({ embeds: [errorEmbed('Invalid Amount', 'Enter a positive whole number.')], flags: MessageFlags.Ephemeral });
    }

    if (action === 'deposit') {
      const wallet = getBalance(userId);
      if (wallet < amount) {
        return interaction.reply({ embeds: [errorEmbed('Insufficient Wallet', `You only have **${fmt(wallet)}** coins in your wallet.`)], flags: MessageFlags.Ephemeral });
      }
      removeCoins(userId, amount);
      const bankData = getBank(userId);
      bankData.balance += amount;
      saveBank(userId, bankData);
    } else if (action === 'withdraw') {
      const bankData = getBank(userId);
      if (bankData.balance < amount) {
        return interaction.reply({ embeds: [errorEmbed('Insufficient Bank Balance', `Your bank holds **${fmt(bankData.balance)}** coins.`)], flags: MessageFlags.Ephemeral });
      }
      bankData.balance -= amount;
      saveBank(userId, bankData);
      addCoins(userId, amount);
    }

    const payload = await buildBankPanel(interaction.member, ownerId);
    return interaction.update({ ...payload, attachments: [] });
  },

  async handleUserSelect(interaction) {
    const ownerId = interaction.customId.split(':')[1];
    if (interaction.user.id !== ownerId) {
      return interaction.reply({ content: "❌ This isn't your bank panel.", flags: MessageFlags.Ephemeral });
    }
    await interaction.deferUpdate();

    const target = interaction.users.first();
    const member = interaction.guild.members.cache.get(target.id) ?? await interaction.guild.members.fetch(target.id).catch(() => null);
    const bankData  = getBank(target.id);
    const wallet    = getBalance(target.id);
    const avatarPng = await fetchAvatarPng(avatarUrlFor(member ?? target));

    const imageName  = `bank_check_${Date.now()}.png`;
    const attachment = new AttachmentBuilder(generateBankCardImage({
      avatarPng, username: member?.displayName ?? target.username, wallet, bank: bankData.balance, viewingOther: true,
    }), { name: imageName });

    return interaction.editReply({ content: null, embeds: [new EmbedBuilder().setImage(`attachment://${imageName}`)], files: [attachment], components: [], attachments: [] });
  },
};
