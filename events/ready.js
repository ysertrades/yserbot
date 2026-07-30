const { Events, REST, Routes } = require('discord.js');
const { startScheduleRunner } = require('../utils/scheduleRunner');
const { startNewsFeedRunner } = require('../utils/newsFeed');
const { startEconCalRunner } = require('../utils/econCalRunner');
const { startLotteryRunner } = require('../utils/lotteryRunner');
const { seedDefaultContent } = require('../utils/contentSeed');
const { restoreGiveaways } = require('../commands/utility/giveaway');
const { restoreCoinsGiveaways } = require('../commands/economy/coinsgiveaway');

// Registers every command in client.commands with Discord on every boot, so
// a newly added or edited command is live the moment the bot restarts —
// nobody has to remember to run `npm run deploy` by hand.
async function syncSlashCommands(client) {
    if (!process.env.CLIENT_ID) {
        console.warn('[DEPLOY] CLIENT_ID not set — skipping automatic slash command sync.');
        return;
    }
    try {
        const body = client.commands.map(cmd => cmd.data.toJSON());
        const rest = new REST().setToken(process.env.TOKEN);
        const data = await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body });
        console.log(`[DEPLOY] Synced ${data.length} global application (/) commands.`);
    } catch (err) {
        console.error('[DEPLOY] Failed to sync slash commands on startup:', err);
    }
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);
        client.user.setActivity('YSER Flow | /help', { type: 3 });
        await syncSlashCommands(client);
        startScheduleRunner(client);
        startNewsFeedRunner(client);
        startEconCalRunner(client);
        startLotteryRunner(client);
        seedDefaultContent(client);
        await restoreGiveaways(client).catch(err => console.error('[GIVEAWAY RESTORE]', err));
        await restoreCoinsGiveaways(client).catch(err => console.error('[COINS GIVEAWAY RESTORE]', err));
    },
};
