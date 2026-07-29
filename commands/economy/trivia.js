'use strict';

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { addCoins, getBalance, checkCooldown, setCooldown } = require('../../utils/economyManager');
const { getEffect } = require('../../utils/effectsManager');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { generateTriviaImage, CATEGORY_META } = require('../../utils/triviaVisual');
const { QUESTIONS, CATEGORIES } = require('../../utils/triviaQuestions');

const COOLDOWN_MS   = 2 * 60 * 60 * 1000;
const REWARD_MIN    = 75;
const REWARD_MAX    = 200;
const HISTORY_LIMIT = 20; // how many recently-asked questions per user we avoid repeating
const SESSION_TTL_MS = 5 * 60 * 1000;
const LETTERS = ['A', 'B', 'C', 'D'];
const fmt = n => Number(n).toLocaleString();

// In-memory answer sessions — short-lived (one question, one answer), so no
// need to persist these like the longer-running setup flows elsewhere.
const sessions = new Map();

function questionKey(cat, idx) {
  return `${cat}:${idx}`;
}

function pickQuestionForUser(userId) {
  const history = readJson('trivia_history.json', {});
  const recent  = new Set(history[userId] || []);

  const flat = [];
  for (const cat of CATEGORIES) QUESTIONS[cat].forEach((q, idx) => flat.push({ cat, idx, ...q }));

  let candidates = flat.filter(q => !recent.has(questionKey(q.cat, q.idx)));
  if (candidates.length === 0) candidates = flat; // exhausted the pool — allow repeats again

  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  const updated = [...(history[userId] || []), questionKey(picked.cat, picked.idx)].slice(-HISTORY_LIMIT);
  history[userId] = updated;
  writeJson('trivia_history.json', history);

  return picked;
}

function buildAnswerRow(sessionId, disabledIndex = null, correctIndex = null) {
  const row = new ActionRowBuilder();
  for (let i = 0; i < 4; i++) {
    const btn = new ButtonBuilder().setCustomId(`trivia_answer:${sessionId}:${i}`).setLabel(LETTERS[i]).setStyle(ButtonStyle.Secondary);
    if (correctIndex !== null) {
      btn.setDisabled(true);
      if (i === correctIndex) btn.setStyle(ButtonStyle.Success);
      else if (i === disabledIndex) btn.setStyle(ButtonStyle.Danger);
    }
    row.addComponents(btn);
  }
  return row;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trivia')
    .setDescription('Answer a random trivia question for coins (2 hour cooldown)'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const cd = checkCooldown(userId, 'trivia', COOLDOWN_MS);

    if (cd > 0) {
      const hours   = Math.floor(cd / 3600000);
      const minutes = Math.floor((cd % 3600000) / 60000);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('🧠 Still Cooling Down')
          .setDescription(`You need to wait **${hours}h ${minutes}m** before another trivia question.`)],
        ephemeral: true,
      });
    }

    setCooldown(userId, 'trivia');

    const picked = pickQuestionForUser(userId);
    const sessionId = `${userId}-${Date.now()}`;
    sessions.set(sessionId, { userId, cat: picked.cat, correct: picked.correct, resolved: false });
    setTimeout(() => sessions.delete(sessionId), SESSION_TTL_MS);

    const imageName = `trivia_${Date.now()}.png`;
    const attachment = new AttachmentBuilder(generateTriviaImage({ category: picked.cat, question: picked.q, choices: picked.choices }), { name: imageName });

    const meta = CATEGORY_META[picked.cat];
    const embed = new EmbedBuilder()
      .setColor(meta.color)
      .setTitle('🧠 Trivia')
      .setDescription('Pick the correct answer below — you have 5 minutes.')
      .setImage(`attachment://${imageName}`);

    await interaction.reply({ embeds: [embed], files: [attachment], components: [buildAnswerRow(sessionId)] });
  },

  async handleAnswer(interaction) {
    const [, sessionId, choiceStr] = interaction.customId.split(':');
    const choice = parseInt(choiceStr, 10);
    const session = sessions.get(sessionId);

    if (!session || session.resolved) {
      return interaction.reply({ content: '⌛ This trivia question has expired.', ephemeral: true });
    }
    if (session.userId !== interaction.user.id) {
      return interaction.reply({ content: "❌ This isn't your trivia question.", ephemeral: true });
    }

    session.resolved = true;
    const correct = choice === session.correct;
    let reward = 0;

    if (correct) {
      reward = Math.floor(Math.random() * (REWARD_MAX - REWARD_MIN + 1)) + REWARD_MIN;
      const boost = getEffect(interaction.user.id, interaction.guild?.id, 'coin_boost');
      if (boost) reward = Math.floor(reward * 1.5);
      addCoins(interaction.user.id, reward);
    }

    const resultEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(correct ? 0x2ecc71 : 0xe74c3c)
      .setDescription(
        correct
          ? `✅ **Correct!** You earned **${fmt(reward)}** coins.\n💰 Balance: **${fmt(getBalance(interaction.user.id))}** coins`
          : `❌ **Wrong** — the correct answer was **${LETTERS[session.correct]}**.\n💰 Balance: **${fmt(getBalance(interaction.user.id))}** coins`,
      );

    return interaction.update({ embeds: [resultEmbed], components: [buildAnswerRow(sessionId, choice, session.correct)] });
  },
};
