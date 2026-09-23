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

client.on('error', (err) => reportAndLog(err, { area: 'Discord client' }));
client.on('shardError', (err, shardId) => reportAndLog(err, { area: 'Discord shard', shardId }));
client.on('warn', (info) => console.warn('[CLIENT WARN]', info));
client.on('shardDisconnect', (event, shardId) => console.warn(`[SHARD ${shardId} DISCONNECTED]`, event?.code));
client.on('shardReconnecting', (shardId) => console.warn(`[SHARD ${shardId} RECONNECTING]`));
client.on('shardResume', (shardId, replayed) => console.log(`[SHARD ${shardId} RESUMED] replayed ${replayed} events`));

process.on('unhandledRejection', (err) => reportAndLog(err, { area: 'Unhandled promise rejection' }));
process.on('uncaughtException', (err) => {
  reportAndLog(err, { area: 'Uncaught exception' });
  setTimeout(() => process.exit(1), 1000).unref?.();
});

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

const SKIP_COMMAND_FOLDERS = new Set(['_disabled']); // shelved mid-rewrite — not loaded
for (const folder of commandFolders) {
    if (SKIP_COMMAND_FOLDERS.has(folder)) continue;
    const commandsPath = path.join(foldersPath, folder);
    if (!fs.statSync(commandsPath).isDirectory()) continue;
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

(async () => {
  await connectMongo(process.env.MONGODB_URI);
  await warmRenderCache();

  client.once(Events.ClientReady, () => {
    try {
      startPanel(client);
    } catch (err) {
      console.error('[Panel] failed to start (bot keeps running):', err);
    }
  });

  client.login(process.env.TOKEN);
})();
