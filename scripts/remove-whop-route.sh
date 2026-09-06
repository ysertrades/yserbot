#!/usr/bin/env bash
set -euo pipefail
python3 << 'PY'
from pathlib import Path
p = Path('web/public/app.js')
t = p.read_text()
# drop draft field
t = t.replace('    companyRoute: d.companyRoute || "",\n', '')
# drop form field + hint if any
import re
t = re.sub(
    r'\s*children\.push\(textField\("Whop (?:page slug|route)[^\n]+\n',
    '\n',
    t,
)
t = t.replace('      companyRoute: draft.companyRoute || null,\n', '')
p.write_text(t)
assert 'Whop page slug' not in t and 'Whop route' not in t
print('Whop route UI removed')
PY
