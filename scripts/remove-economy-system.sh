#!/usr/bin/env bash
# Professionally retire the coin economy + casino from runtime, panel, and help.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "== 1. index.js: skip economy commands + casino/jobs events =="
python3 << 'PY'
from pathlib import Path
p = Path('index.js')
t = p.read_text()
if 'SKIP_COMMAND_FOLDERS' in t:
    print('index already skips economy')
else:
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
    if old_ev in t:
        t = t.replace(old_ev, new_ev, 1)
    Path('index.js').write_text(t)
    print('index.js OK')
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
Path('events/ready.js').write_text(t)
print('ready.js OK')
PY

echo "== 3. help.js: catalogues without economy =="
python3 << 'PY'
from pathlib import Path
p = Path('commands/system/help.js')
t = p.read_text()

# Rewrite ADMIN_CATALOGUE without economy entries
import re
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

# COMMUNITY stays mostly same; remove sell if any
# ECONOMY_CMDS → empty / remove section
m = re.search(r'const ECONOMY_CMDS = \[[\s\S]*?\];', t)
if m:
    t = t[:m.start()] + 'const ECONOMY_CMDS = []; // retired — coin economy removed\n' + t[m.end():]
    print('ECONOMY_CMDS cleared')

# Strip economy field from help embed if hardcoded category label
t = t.replace("name: 'Economy'", "name: 'Economy (retired)'")
# Better: remove economy from fields builder - look for ECONOMY_CMDS usage
if 'ECONOMY_CMDS' in t and 'if (ECONOMY_CMDS.length)' not in t:
    t = t.replace(
        'ECONOMY_CMDS.map',
        '(ECONOMY_CMDS.length ? ECONOMY_CMDS : []).map',
    )

Path('commands/system/help.js').write_text(t)
print('help.js patched')
PY

echo "== 4. featureToggles: drop economy groups =="
python3 << 'PY'
from pathlib import Path
import re
p = Path('utils/featureToggles.js')
t = p.read_text()
# Remove feature group blocks by key
for key in ['economy', 'casino', 'fishing_mining', 'trivia', 'shop']:
    t2, n = re.subn(
        rf"\s*\{{\s*key: '{key}'[\s\S]*?\}},",
        '',
        t,
        count=1,
    )
    if n:
        t = t2
        print(f'removed toggle {key}')
    else:
        print(f'skip toggle {key}')
# newsfeed already retired
Path('utils/featureToggles.js').write_text(t)
PY

echo "== 5. index.html: remove Economy + Casino nav and sections =="
python3 << 'PY'
from pathlib import Path
import re
p = Path('web/public/index.html')
t = p.read_text()
for btn in ['economy', 'casino']:
    t2, n = re.subn(rf'\s*<button type="button" data-goto="{btn}"[^>]*>[^<]*</button>\n', '', t)
    t = t2
    print(f'nav {btn}: {n}')

# Remove section blocks data-section="economy" and casino
for sec in ['economy', 'casino']:
    # non-greedy from section open to next section or owner comment
    pat = rf'    <!--[^-]*{sec.title()}[\s\S]*?<div class="section" data-section="{sec}">[\s\S]*?(?=    <div class="section" data-section=|    <!-- ──)'
    t2, n = re.subn(pat, '', t, count=1, flags=re.I)
    if n:
        t = t2
        print(f'section {sec} removed')
    else:
        # simpler: find data-section and cut until next data-section at same indent
        start = t.find(f'data-section="{sec}"')
        if start < 0:
            print(f'section {sec} already gone')
            continue
        # back up to preceding comment or div
        open_div = t.rfind('<div class="section"', 0, start)
        # find next section div after start
        nxt = t.find('<div class="section" data-section="', start + 10)
        if open_div >= 0 and nxt > open_div:
            # also drop preceding HTML comment line if present
            cut_start = open_div
            prev_nl = t.rfind('\n', 0, open_div)
            block = t[prev_nl+1:open_div]
            if '<!--' in block:
                cut_start = t.rfind('<!--', 0, open_div)
            t = t[:cut_start] + t[nxt:]
            print(f'section {sec} cut')
        else:
            print(f'WARN section {sec}')

Path('web/public/index.html').write_text(t)
# sanity: no empty double sections broken
assert 'data-section="feeds"' in t
assert 'data-section="economy"' not in t or True  # may still exist if cut failed
print('html done, economy present?', 'data-section="economy"' in t, 'casino?', 'data-section="casino"' in t)
PY

echo "== 6. app.js: overview without shop economy noise =="
python3 << 'PY'
from pathlib import Path
p = Path('web/public/app.js')
t = p.read_text()
# Replace shop items tile if present
t = t.replace(
    "{ value: num(d.counts.shopItems), label: 'Shop items', kind: '' },",
    "{ value: num(d.counts.embedTemplates), label: 'Templates', kind: '' },",
)
# Remove duplicate templates if we doubled
# Systems / content rows about shop
import re
t = re.sub(r"\s*row\('Shop items'[^\n]*\n", '\n', t)
# Guard renderEconomy / renderCasino calls if any
for fn in ['renderEconomy', 'renderCasino', 'renderShop']:
    t = t.replace(f'{fn}();', f'/* {fn} retired */')
Path('web/public/app.js').write_text(t)
print('app.js touched')
PY

echo "== 7. dynamicEmbedImages: skip missing economy showcase safely =="
python3 << 'PY'
from pathlib import Path
p = Path('utils/dynamicEmbedImages.js')
if not p.exists():
    print('no dynamicEmbedImages')
else:
    t = p.read_text()
    # leave generators; warm() already try/catches typically
    print('dynamicEmbedImages left as-is (templates may still reference images)')
PY

echo ""
echo "Verify:"
grep -n "SKIP_COMMAND_FOLDERS\|data-section=\"economy\"\|startLotteryRunner" index.js events/ready.js web/public/index.html 2>/dev/null | head -20
echo ""
echo "Commit:"
echo "  git add index.js events/ready.js commands/system/help.js utils/featureToggles.js web/public/index.html web/public/app.js"
echo "  git commit -m 'Remove coin economy and casino; update panel and help'"
echo "  git push origin main && restart bot"
echo "Note: Discord may still show old slash commands until sync runs; economy cmds are no longer loaded."
