require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials, Events, Options} = require('discord.js');
const { connect: connectMongo } = require('./utils/mongoStorage');
const { warm: warmRenderCache } = require('./utils/dynamicEmbedImages');
const { start: startPanel } = require('./web/server');
const { configure: configureErrorReporter, reportAndLog, report } = require('./utils/errorReporter');

const client = new Client({
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 100,
    ThreadManager: 50,
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 300, lifetime: 600 },
    threads: { interval: 3600, lifetime: 3600 },
  },

    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
    ],
    // GuildMember: without it discord.js silently drops guildMemberRemove for
    // anyone not in the member cache, so their leave message and leave log
    // never appeared. The remove payload still carries the full user.
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember],
});

client.commands = new Collection();
client.cooldowns = new Collection();
configureErrorReporter(client);

client.on('error', (err) => reportAndLog(err, { area: 'Discord client' }));
client.on('shardError', (err, shardId) => reportAndLog(err, { area: 'Discord shard', shardId }));
client.on('warn', (info) => {
  console.warn('[CLIENT WARN]', info);
  report(String(info), { area: 'Discord client warning', severity: 'low' }).catch(() => {});
});
client.on('shardDisconnect', (event, shardId) => {
  console.warn(`[SHARD ${shardId} DISCONNECTED]`, event?.code);
  // 4004: the token was rejected; 4014: an intent isn't enabled in the
  // developer portal. Neither recovers by itself.
  const fatal = { 4004: 'The bot token was rejected', 4013: 'Invalid gateway intents', 4014: 'A privileged intent is not enabled in the Developer Portal' }[event?.code];
  if (fatal) report(`${fatal} (close code ${event.code})`, { area: 'Discord gateway', severity: 'critical', shardId }).catch(() => {});
  else if (event?.code && event.code !== 1000) report(`Gateway disconnected (close code ${event.code})`, { area: 'Discord gateway', severity: 'low', shardId, dedupeMs: 60 * 60 * 1000 }).catch(() => {});
});
client.on('shardReconnecting', (shardId) => console.warn(`[SHARD ${shardId} RECONNECTING]`));
client.on('shardResume', (shardId, replayed) => console.log(`[SHARD ${shardId} RESUMED] replayed ${replayed} events`));

process.on('unhandledRejection', (err) => reportAndLog(err, { area: 'Unhandled promise rejection' }));
process.on('uncaughtException', (err) => {
  reportAndLog(err, { area: 'Uncaught exception' });
  setTimeout(() => process.exit(1), 1000).unref?.();
});

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

// Shared with deploy-commands.js so the two cannot drift apart again.
const { SKIP_COMMAND_FOLDERS, SKIP_COMMAND_FILES } = require('./utils/commandSkips');
for (const folder of commandFolders) {
    if (SKIP_COMMAND_FOLDERS.has(folder)) continue;
    const commandsPath = path.join(foldersPath, folder);
    if (!fs.statSync(commandsPath).isDirectory()) continue;
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        if (SKIP_COMMAND_FILES.has(file)) continue;
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        }
    }
}

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

// Each event runs inside its server's brand context (utils/brand.js), so the
// cards and footers it produces carry that server's name and logo.
const brand = require('./utils/brand');
const inBrand = (event) => (...args) => brand.run(brand.guildIdOf(args[0]) || brand.guildIdOf(args[1]),
    () => event.execute(...args, client));

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) {
        client.once(event.name, inBrand(event));
    } else {
        client.on(event.name, inBrand(event));
    }
}

(async () => {
  await connectMongo(process.env.MONGODB_URI);
  await warmRenderCache();

  client.once(Events.ClientReady, () => {
    brand.warmAll().catch(() => {});
    try {
      startPanel(client);
    } catch (err) {
      console.error('[Panel] failed to start (bot keeps running):', err);
    }
  });

  client.login(process.env.TOKEN);
})();
