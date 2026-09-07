const { Events, REST, Routes, ApplicationCommandType } = require('discord.js');
const { startScheduleRunner } = require('../utils/scheduleRunner');
const { startEconCalRunner } = require('../utils/econCalRunner');
const { startLotteryRunner } = require('../utils/lotteryRunner');
const { startSocialRunner } = require('../utils/socialRunner');
const { startWhopRunner } = require('../utils/whopRunner');
const { seedDefaultContent } = require('../utils/contentSeed');
const { restoreGiveaways } = require('../commands/utility/giveaway');
const { restoreCoinsGiveaways } = require('../commands/economy/coinsgiveaway');
const botProfile = require('../web/botProfile');

/**
 * Bulk PUT of global commands must keep Discord's Primary Entry Point
 * command (type 4) or Discord returns 50240.
 */
async function syncSlashCommands(client) {
    if (!process.env.CLIENT_ID) {
        console.warn('[DEPLOY] CLIENT_ID not set — skipping automatic slash command sync.');
        return;
    }
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        const clientId = process.env.CLIENT_ID;
        const body = client.commands.map(cmd => cmd.data.toJSON());

        try {
            const existing = await rest.get(Routes.applicationCommands(clientId));
            const entryPoints = (Array.isArray(existing) ? existing : []).filter(
                c => c.type === ApplicationCommandType.PrimaryEntryPoint || c.type === 4,
            );
            for (const ep of entryPoints) {
                body.push({
                    id: ep.id,
                    name: ep.name,
                    type: ep.type,
                    description: ep.description || undefined,
                    ...(ep.integration_types ? { integration_types: ep.integration_types } : {}),
                    ...(ep.contexts != null ? { contexts: ep.contexts } : {}),
                    ...(ep.handler != null ? { handler: ep.handler } : {}),
                });
            }
            if (entryPoints.length) {
                console.log(`[DEPLOY] Preserving ${entryPoints.length} Entry Point command(s).`);
            }
        } catch (fetchErr) {
            console.warn('[DEPLOY] Could not fetch existing commands:', fetchErr.message);
        }

        const data = await rest.put(Routes.applicationCommands(clientId), { body });
        console.log(`[DEPLOY] Synced ${data.length} global application (/) commands.`);
    } catch (err) {
        console.error('[DEPLOY] Failed to sync slash commands on startup:', err.message || err);
    }
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);

        try {
            await botProfile.applyStoredPresence(client);
            const p = botProfile.flags().presence;
            if (!p.activityText) {
                await botProfile.applyPresence({
                    status: 'online',
                    activityType: 'watching',
                    activityText: 'QuantLab | /help',
                }, client);
            }
        } catch (err) {
            console.warn('[Panel] presence restore failed, using fallback:', err.message || err);
            client.user.setActivity('QuantLab | /help', { type: 3 });
        }

        await syncSlashCommands(client);
        startScheduleRunner(client);
        // News feed runner removed (Financial Juice retired)
        startEconCalRunner(client);
        startLotteryRunner(client);
        startSocialRunner(client);
        startWhopRunner(client);
        seedDefaultContent(client);
        await restoreGiveaways(client).catch(err => console.error('[GIVEAWAY RESTORE]', err));
        await restoreCoinsGiveaways(client).catch(err => console.error('[COINS GIVEAWAY RESTORE]', err));
    },
};
