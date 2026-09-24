const { Events, REST, Routes, ApplicationCommandType } = require('discord.js');
const { startScheduleRunner } = require('../utils/scheduleRunner');
const { startEconCalRunner } = require('../utils/econCalRunner');
const { startLotteryRunner } = require('../utils/lotteryRunner');
const { restoreCoinsGiveaways } = require('../commands/economy/coinsgiveaway');
const { startWhopRunner } = require('../utils/whopRunner');
const { seedDefaultContent } = require('../utils/contentSeed');
const { restoreGiveaways } = require('../commands/utility/giveaway');
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

        // Remove guild-scoped copies so /rank, /leaderboard, etc. do not appear twice
        // (Discord shows both global and per-guild commands in the same picker).
        for (const guild of client.guilds.cache.values()) {
            try {
                await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: [] });
            } catch (gErr) {
                console.warn(`[DEPLOY] Could not clear guild commands for ${guild.id}:`, gErr.message || gErr);
            }
        }
        console.log(`[DEPLOY] Cleared guild-scoped slash commands for ${client.guilds.cache.size} guild(s).`);
    } catch (err) {
        console.error('[DEPLOY] Failed to sync slash commands on startup:', err.message || err);
    }
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);

        // Leveling: re-apply rank roles after restart
        try {
            const leveling = require('../utils/levelingEngine');
            if (typeof leveling.syncAllRolesOnStartup === 'function') {
                setTimeout(() => {
                    leveling.syncAllRolesOnStartup(client).catch(err =>
                        console.warn('[leveling] startup role sync:', err.message || err)
                    );
                }, 5000);
            }
        } catch (err) {
            console.warn('[leveling] could not schedule role sync:', err.message || err);
        }

        try {
            await new Promise(res => setTimeout(res, 2000));
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
            try {
                await client.user.setActivity('QuantLab | /help', { type: 3 });
            } catch (e2) {
                console.warn('[Panel] fallback activity failed:', e2.message || e2);
            }
        }

        await syncSlashCommands(client);
        startScheduleRunner(client);
        startEconCalRunner(client);
        startLotteryRunner(client);
        startWhopRunner(client);
        seedDefaultContent(client);
        await restoreGiveaways(client).catch(err => console.error('[GIVEAWAY RESTORE]', err));
        await restoreCoinsGiveaways(client).catch(err => console.error('[COINS GIVEAWAY RESTORE]', err));
    },
};
