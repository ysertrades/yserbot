#!/usr/bin/env bash
set -euo pipefail
python3 << 'PY'
from pathlib import Path
p = Path('utils/econCalRunner.js')
t = p.read_text()
# Remove title/footer options from buildSingleEventEmbed calls
import re
t2 = re.sub(
    r"econEmbed\.buildSingleEventEmbed\(\s*guild\.id,\s*e,\s*\{\s*title:[^}]+\}\s*\)",
    'econEmbed.buildSingleEventEmbed(guild.id, e)',
    t,
)
# Also simpler patterns
t2 = t2.replace(
    "econEmbed.buildSingleEventEmbed(guild.id, e, {\n      title: 'News Update',\n      footer: 'quantlab · economic calendar',\n    })",
    'econEmbed.buildSingleEventEmbed(guild.id, e)',
)
t2 = t2.replace(
    "econEmbed.buildSingleEventEmbed(guild.id, e, {\n      title,\n      footer: 'quantlab · economic calendar',\n    })",
    'econEmbed.buildSingleEventEmbed(guild.id, e)',
)
# Remove unused title variable block if leftover
t2 = t2.replace(
    """    const title = key === 'econ.reminder'\n      ? ('Reminder · in ' + tokens.minutes + 'm')\n      : 'News Update';\n    const embed = econEmbed.buildSingleEventEmbed(guild.id, e);""",
    "    const embed = econEmbed.buildSingleEventEmbed(guild.id, e);",
)
if t2 == t:
    print('WARN: no replacements — checking content')
    for i, line in enumerate(t.splitlines(), 1):
        if 'buildSingleEventEmbed' in line or 'News Update' in line:
            print(i, line)
else:
    p.write_text(t2)
    print('econ call sites cleaned')
assert 'News Update' not in p.read_text()
print('OK')
PY
