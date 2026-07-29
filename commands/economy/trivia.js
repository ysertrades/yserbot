'use strict';

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { addCoins, getBalance, checkCooldown, setCooldown } = require('../../utils/economyManager');
const { getEffect } = require('../../utils/effectsManager');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { generateTriviaImage, CATEGORY_META } = require('../../utils/triviaVisual');
const { QUESTIONS, CATEGORIES } = require('../../utils/triviaQuestions');

const COOLDOWN_MS           = 2 * 60 * 60 * 1000;
const QUESTIONS_PER_SESSION = 6;
const QUESTION_TIME_MS      = 15 * 1000;
const REVEAL_DELAY_MS       = 2000;
const REWARD_MIN            = 50;
const REWARD_MAX            = 120;
const REWARD_SCALE_STEP     = 0.2; // each correct answer so far bumps the next reward range up 20%
const HISTORY_LIMIT         = 40; // how many recently-asked questions per user we avoid repeating — scaled up alongside the larger question bank
const LETTERS = ['A', 'B', 'C', 'D'];
const fmt = n => Number(n).toLocaleString();

// One active multi-question session per user — the initial slash-command
// interaction is kept around and reused for every editReply() in the
// session (question reveals, next question, timeouts), while each button
// click just needs to ack via deferUpdate(). Session state is in-memory —
// if the bot restarts mid-session, that session is lost, an accepted
// trade-off matching other short-lived flows in this bot (no cooldown
// will have been charged yet, since it's only set once a session finishes).
const activeSessions = new Map();

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

function computeReward(correctSoFar) {
  const mult = 1 + correctSoFar * REWARD_SCALE_STEP;
  const min = Math.round(REWARD_MIN * mult);
  const max = Math.round(REWARD_MAX * mult);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildRows(userId, disabledIndex = null, correctIndex = null) {
  const answerRow = new ActionRowBuilder();
  for (let i = 0; i < 4; i++) {
    const btn = new ButtonBuilder().setCustomId(`trivia_answer:${userId}:${i}`).setLabel(LETTERS[i]).setStyle(ButtonStyle.Secondary);
    if (correctIndex !== null) {
      btn.setDisabled(true);
      if (i === correctIndex) btn.setStyle(ButtonStyle.Success);
      else if (i === disabledIndex) btn.setStyle(ButtonStyle.Danger);
    }
    answerRow.addComponents(btn);
  }
  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`trivia_close:${userId}`).setLabel('Close').setStyle(ButtonStyle.Secondary).setDisabled(correctIndex !== null),
  );
  return [answerRow, closeRow];
}

async function postQuestion(session) {
  const picked = pickQuestionForUser(session.userId);
  session.current = picked;

  const imageName = `trivia_${Date.now()}.png`;
  const attachment = new AttachmentBuilder(generateTriviaImage({ category: picked.cat, question: picked.q, choices: picked.choices }), { name: imageName });

  const meta = CATEGORY_META[picked.cat];
  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(`🧠 Trivia — Question ${session.index + 1}/${QUESTIONS_PER_SESSION}`)
    .setDescription('Pick the correct answer below — you have 15 seconds.')
    .setImage(`attachment://${imageName}`)
    .setFooter({ text: `Correct so far: ${session.correctCount} • Coins earned: ${fmt(session.totalCoins)}` });

  // attachments: [] clears the previous question's image (Discord keeps old
  // attachments on a PATCH unless told otherwise), so it doesn't linger as a
  // stray image stacked above this question's.
  await session.interaction.editReply({ embeds: [embed], files: [attachment], components: buildRows(session.userId), attachments: [] });
  session.timer = setTimeout(() => {
    resolveAnswer(session, null).catch(err => {
      console.error('[TRIVIA TIMEOUT]', err);
      activeSessions.delete(session.userId);
    });
  }, QUESTION_TIME_MS);
}

async function resolveAnswer(session, choice) {
  clearTimeout(session.timer);
  session.timer = null;

  const correct = choice === session.current.correct;
  let reward = 0;

  if (correct) {
    reward = computeReward(session.correctCount);
    const boost = getEffect(session.userId, session.guildId, 'coin_boost');
    if (boost) reward = Math.floor(reward * (boost.multiplier || 1.5));
    addCoins(session.userId, reward);
    session.correctCount++;
  }
  session.totalCoins += reward;

  const resultEmbed = new EmbedBuilder()
    .setColor(correct ? 0x2ecc71 : 0xe74c3c)
    .setTitle(`🧠 Trivia — Question ${session.index + 1}/${QUESTIONS_PER_SESSION}`)
    .setDescription(
      correct
        ? `✅ **Correct!** +**${fmt(reward)}** coins`
        : choice === null
          ? `⌛ **Time's up!** The correct answer was **${LETTERS[session.current.correct]}**.`
          : `❌ **Wrong** — the correct answer was **${LETTERS[session.current.correct]}**.`,
    );

  session.index++;
  const isLast = session.index >= QUESTIONS_PER_SESSION;

  if (isLast) {
    setCooldown(session.userId, 'trivia');
    activeSessions.delete(session.userId);
    resultEmbed.addFields({
      name: 'Session Summary',
      value: `${session.correctCount}/${QUESTIONS_PER_SESSION} correct • **${fmt(session.totalCoins)}** coins earned\n💰 Balance: **${fmt(getBalance(session.userId))}** coins`,
    });
    resultEmbed.setFooter({ text: 'Session complete — come back in 2 hours' });
    return session.interaction.editReply({ embeds: [resultEmbed], components: [], attachments: [] });
  }

  await session.interaction.editReply({ embeds: [resultEmbed], components: buildRows(session.userId, choice, session.current.correct), attachments: [] });

  session.awaitTimer = setTimeout(() => {
    postQuestion(session).catch(err => {
      console.error('[TRIVIA NEXT]', err);
      activeSessions.delete(session.userId);
    });
  }, REVEAL_DELAY_MS);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trivia')
    .setDescription('Answer 6 trivia questions for coins (2 hour cooldown)'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const cd = checkCooldown(userId, 'trivia', COOLDOWN_MS, interaction.guild?.id);

    if (cd > 0) {
      const hours   = Math.floor(cd / 3600000);
      const minutes = Math.floor((cd % 3600000) / 60000);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('🧠 Still Cooling Down')
          .setDescription(`You need to wait **${hours}h ${minutes}m** before another trivia session.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (activeSessions.has(userId)) {
      return interaction.reply({ content: '⚠️ You already have a trivia session in progress! Finish it or hit Close first.', flags: MessageFlags.Ephemeral });
    }

    const session = {
      userId, guildId: interaction.guild?.id, interaction,
      index: 0, correctCount: 0, totalCoins: 0, current: null, timer: null, awaitTimer: null,
    };
    activeSessions.set(userId, session);

    await interaction.deferReply();
    return postQuestion(session);
  },

  async handleAnswer(interaction) {
    const [, userId, choiceStr] = interaction.customId.split(':');

    if (interaction.user.id !== userId) {
      return interaction.reply({ content: "❌ This isn't your trivia session.", flags: MessageFlags.Ephemeral });
    }

    const session = activeSessions.get(userId);
    if (!session || !session.timer) {
      return interaction.reply({ content: '⌛ This trivia session has expired.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate();
    return resolveAnswer(session, parseInt(choiceStr, 10));
  },

  async handleClose(interaction) {
    const [, userId] = interaction.customId.split(':');

    if (interaction.user.id !== userId) {
      return interaction.reply({ content: "❌ This isn't your trivia session.", flags: MessageFlags.Ephemeral });
    }

    const session = activeSessions.get(userId);
    if (!session) {
      return interaction.reply({ content: '⌛ This trivia session has already ended.', flags: MessageFlags.Ephemeral });
    }

    clearTimeout(session.timer);
    clearTimeout(session.awaitTimer);
    activeSessions.delete(userId);

    // Matches every other Close button in the bot (casino, shop, jobs,
    // fish/mine) — fully dismiss the message instead of leaving an edited
    // husk of it behind.
    try { await interaction.message.delete(); } catch {}
  },
};
