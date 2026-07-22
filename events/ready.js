const { Events } = require('discord.js');
const { startScheduleRunner } = require('../utils/scheduleRunner');
const { restoreGiveaways } = require('../commands/utility/giveaway');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);
        client.user.setActivity('YSER Flow | /help', { type: 3 });
        startScheduleRunner(client);
        await restoreGiveaways(client).catch(err => console.error('[GIVEAWAY RESTORE]', err));
    },
};
