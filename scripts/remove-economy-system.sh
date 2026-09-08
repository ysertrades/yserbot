#!/usr/bin/env bash
# Professionally retire the coin economy + casino from runtime, panel, and help.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "== 1. index.js: skip economy commands + casino/jobs events =="
python3 << 'PY'
from pathlib import Path

p = Path('index.js')
t = p.read_text()

if 'SKIP_COMMAND_FOLDERS' not in t:
    old = '''for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        }
    }
}'''
    new = '''// Coin economy + casino commands retired (folder kept on disk for history only).
const SKIP_COMMAND_FOLDERS = new Set(['economy']);
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
}'''
    if old not in t:
        raise SystemExit('command load loop not found')
    t = t.replace(old, new, 1)
    print('command folders skip OK')
else:
    print('index already skips economy folders')

old_ev = '''for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}'''
new_ev = '''const SKIP_EVENT_FILES = new Set(['casinoInteraction.js', 'jobsInteraction.js']);
for (const file of eventFiles) {
    if (SKIP_EVENT_FILES.has(file)) continue;
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}'''

if 'SKIP_EVENT_FILES' in t:
    print('index already skips casino/jobs events')
elif old_ev in t:
    t = t.replace(old_ev, new_ev, 1)
    print('event skip OK')
else:
    print('WARN: event loop pattern not found')

p.write_text(t)
print('index.js saved')
PY

echo "== 2. ready.js: no lottery / coins giveaways =="
python3 << 'PY'
from pathlib import Path
p = Path('events/ready.js')
t = p.read_text()
t = t.replace("const { startLotteryRunner } = require('../utils/lotteryRunner');\n", '')
t = t.replace("const { restoreCoinsGiveaways } = require('../commands/economy/coinsgiveaway');\n", '')
t = t.replace('        startLotteryRunner(client);\n', '        // Lottery retired with economy system\n')
t = t.replace(
    "        await restoreCoinsGiveaways(client).catch(err => console.error('[COINS GIVEAWAY RESTORE]', err));\n",
    '        // Coins giveaways retired with economy system\n',
)
p.write_text(t)
print('ready.js OK')
PY

echo "== 3. help.js: catalogues without economy =="
python3 << 'PY'
from pathlib import Path
import re

p = Path('commands/system/help.js')
t = p.read_text()

admin_new = '''const ADMIN_CATALOGUE = [
  ['automod',        'Toggle bad-word & link-approval auto-mod filters'],
  ['autoreply',      'Set automatic keyword replies'],
  ['button',         'Create & manage button link panels'],
  ['cardsettings',   'Set how many messages between card drops (server-wide)'],
  ['cmd',            'Set which roles can use mod/admin commands'],
  ['config',         'Server-wide settings (prefix, channels, roles…)'],
  ['econcal',        'Economic calendar with release reminders'],
  ['embed',          'Create & manage embed templates'],
  ['giveaway',       'Create, end, reroll & list giveaways'],
  ['levelsettings',  'Configure XP & leveling system'],
  ['modlog',         'Toggle which events get logged to the mod-log channel'],
  ['schedule',       'Schedule embed templates to send automatically'],
  ['ticket',         'Configure the support ticket system'],
  ['verify',         'Set up member verification (memory challenge + role)'],
];'''

m = re.search(r'const ADMIN_CATALOGUE = \[[\s\S]*?\];', t)
if m:
    t = t[:m.start()] + admin_new + t[m.end():]
    print('ADMIN_CATALOGUE updated')
else:
    print('WARN admin catalogue')

m = re.search(r'const ECONOMY_CMDS = \[[\s\S]*?\];', t)
if m:
    t = t[:m.start()] + 'const ECONOMY_CMDS = []; // retired — coin economy removed\n' + t[m.end():]
    print('ECONOMY_CMDS cleared')
else:
    print('ECONOMY_CMDS already cleared or missing')

p.write_text(t)
print('help.js patched')
PY

echo "== 4. featureToggles: drop economy groups =="
python3 << 'PY'
from pathlib import Path
import re

p = Path('utils/featureToggles.js')
t = p.read_text()
for key in ['economy', 'casino', 'fishing_mining', 'trivia', 'shop']:
    t2, n = re.subn(rf"\s*\{{\s*key: '{key}'[\s\S]*?\}},", '', t, count=1)
    if n:
        t = t2
        print(f'removed toggle {key}')
    else:
        print(f'skip toggle {key}')
p.write_text(t)
PY

echo "== 5. index.html: remove Economy + Casino nav and sections =="
python3 << 'PY'
from pathlib import Path
import re

p = Path('web/public/index.html')
t = p.read_text()

for btn in ['economy', 'casino']:
    t2, n = re.subn(
        rf'\s*<button type="button" data-goto="{btn}"[^>]*>[^<]*</button>\n',
        '',
        t,
    )
    t = t2
    print(f'nav {btn}: removed {n}')

for sec in ['economy', 'casino']:
    start = t.find(f'data-section="{sec}"')
    if start < 0:
        print(f'section {sec} already gone')
        continue
    open_div = t.rfind('<div class="section"', 0, start)
    nxt = t.find('<div class="section" data-section="', start + 10)
    if open_div < 0 or nxt < 0:
        print(f'WARN section {sec} bounds')
        continue
    cut_start = open_div
    comment = t.rfind('<!--', 0, open_div)
    if comment >= 0 and open_div - comment < 200:
        cut_start = comment
    t = t[:cut_start] + t[nxt:]
    print(f'section {sec} cut')

p.write_text(t)
has_econ = 'data-section="economy"' in t
has_casino = 'data-section="casino"' in t
print(f'html done, economy present? {has_econ} casino? {has_casino}')
if has_econ or has_casino:
    raise SystemExit('panel sections still present')
PY

echo "== 6. app.js: overview cleanup =="
python3 << 'PY'
from pathlib import Path
import re

p = Path('web/public/app.js')
t = p.read_text()
t = t.replace(
    "{ value: num(d.counts.shopItems), label: 'Shop items', kind: '' },",
    "{ value: num(d.counts.embedTemplates), label: 'Templates', kind: '' },",
)
t = re.sub(r"\s*row\('Shop items'[^\n]*\n", '\n', t)
for fn in ['renderEconomy', 'renderCasino', 'renderShop']:
    t = t.replace(f'{fn}();', f'/* {fn} retired */')
p.write_text(t)
print('app.js touched')
PY

echo ""
echo "=== SUCCESS ==="
echo "If you see economy present? False and casino? False above, you are good."
echo ""
echo "Next:"
echo "  git add index.js events/ready.js commands/system/help.js utils/featureToggles.js web/public/index.html web/public/app.js"
echo "  git commit -m 'Remove coin economy and casino; update panel and help'"
echo "  git push origin main"
echo "Then restart the bot."
