require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials, Events } = require('discord.js');
const { connect: connectMongo } = require('./utils/mongoStorage');

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

// ── Connection resilience ────────────────────────────────
// discord.js retries dropped gateway connections on its own, but without
// these listeners a drop/resume is invisible and, if something inside a
// handler throws unexpectedly, an unhandled error/rejection would otherwise
// kill the whole process (looking "offline" until the workflow is restarted
// by hand). Logging here plus process-level safety nets below keep the bot
// alive and give us a trail to diagnose the next time it happens.
client.on('error', (err) => console.error('[CLIENT ERROR]', err));
client.on('shardError', (err, shardId) => console.error(`[SHARD ${shardId} ERROR]`, err));
client.on('warn', (info) => console.warn('[CLIENT WARN]', info));
client.on('shardDisconnect', (event, shardId) => console.warn(`[SHARD ${shardId} DISCONNECTED]`, event?.code));
client.on('shardReconnecting', (shardId) => console.warn(`[SHARD ${shardId} RECONNECTING]`));
client.on('shardResume', (shardId, replayed) => console.log(`[SHARD ${shardId} RESUMED] replayed ${replayed} events`));

process.on('unhandledRejection', (err) => console.error('[UNHANDLED REJECTION]', err));
process.on('uncaughtException', (err) => console.error('[UNCAUGHT EXCEPTION]', err));

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
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

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}

// Connect to MongoDB (warm the cache) before logging into Discord so every
// command handler has storage available from the very first interaction.
(async () => {
  await connectMongo(process.env.MONGODB_URI);
  client.login(process.env.TOKEN);
})();
