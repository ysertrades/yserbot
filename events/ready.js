const { Events } = require('discord.js');
const { startScheduleRunner } = require('../utils/scheduleRunner');

module.exports = {
    name: Events.ClientReady,
    once: true,
    execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);
        client.user.setActivity('YSER Flow | /help', { type: 3 });
        startScheduleRunner(client);
    },
};
