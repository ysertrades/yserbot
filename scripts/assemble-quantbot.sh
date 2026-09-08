#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
python3 - << 'PY'
from pathlib import Path
import base64
b64 = (
    Path('scripts/quantbot.b64.0').read_text().strip()
    + Path('scripts/quantbot.b64.1').read_text().strip()
    + Path('scripts/quantbot.b64.2').read_text().strip()
)
raw = base64.b64decode(b64)
Path('web/public/quantbot.png').write_bytes(raw)
Path('utils/quantbotLogo.js').write_text(
    "'use strict';\n"
    "/** Quantbot mascot (embedded PNG). */\n"
    "const BUF = Buffer.from('" + b64 + "', 'base64');\n"
    "module.exports = { png64: BUF, png256: BUF, dataUri64: 'data:image/png;base64," + b64 + "' };\n"
)
print('assembled', len(raw), 'bytes png + logo module')
PY
