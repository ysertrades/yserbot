require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials, Events } = require('discord.js');
const { connect: connectMongo } = require('./utils/mongoStorage');
const { warm: warmRenderCache } = require('./utils/dynamicEmbedImages');
const { start: startPanel } = require('./web/server');
const { configure: configureErrorReporter, reportAndLog } = require('./utils/errorReporter');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.commands = new Collection();
client.cooldowns = new Collection();
configureErrorReporter(client);

// ── Connection resilience ────────────────────────────────
// discord.js retries dropped gateway connections on its own, but without
// these listeners a drop/resume is invisible and, if something inside a
// handler throws unexpectedly, an unhandled error/rejection would otherwise
// kill the whole process (looking "offline" until the workflow is restarted
// by hand). Logging here plus process-level safety nets below keep the bot
// alive and give us a trail to diagnose the next time it happens.
client.on('error', (err) => reportAndLog(err, { area: 'Discord client' }));
client.on('shardError', (err, shardId) => reportAndLog(err, { area: 'Discord shard', shardId }));
client.on('warn', (info) => console.warn('[CLIENT WARN]', info));
client.on('shardDisconnect', (event, shardId) => console.warn(`[SHARD ${shardId} DISCONNECTED]`, event?.code));
client.on('shardReconnecting', (shardId) => console.warn(`[SHARD ${shardId} RECONNECTING]`));
client.on('shardResume', (shardId, replayed) => console.log(`[SHARD ${shardId} RESUMED] replayed ${replayed} events`));

process.on('unhandledRejection', (err) => reportAndLog(err, { area: 'Unhandled promise rejection' }));
process.on('uncaughtException', (err) => {
  reportAndLog(err, { area: 'Uncaught exception' });
  // Stay alive only long enough to flush logs, then exit so the host restarts
  // a clean process instead of running in an unknown half-broken state.
  setTimeout(() => process.exit(1), 1000).unref?.();
});

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

const SKIP_COMMAND_FOLDERS = new Set(); // economy restored
for (const folder of commandFolders) {
    if (SKIP_COMMAND_FOLDERS.has(folder)) continue;
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        }
    }
}

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

const SKIP_EVENT_FILES = new Set(); // casino + jobs restored
for (const file of eventFiles) {
    if (SKIP_EVENT_FILES.has(file)) continue;
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}

// Open panel HTTP as soon as Mongo is up so Loading is never blocked on Discord.
(async () => {
  await connectMongo(process.env.MONGODB_URI);

  try {
    startPanel(client);
  } catch (err) {
    console.error('[Panel] failed to start (bot keeps running):', err);
  }

  client.once(Events.ClientReady, () => {
    console.log(`[Panel] Discord ready — guilds: ${client.guilds.cache.size}`);
    warmRenderCache().catch(err =>
      console.warn('[RenderCache] warm failed:', err.message || err));
  });

  client.login(process.env.TOKEN).catch(err => {
    console.error('[Discord] login failed:', err.message || err);
  });
})();
