#!/usr/bin/env bash
# Run from repo root to finish dialkit removal.
set -euo pipefail

echo "Restoring app.css from last good commit and stripping dialkit..."
git show d5074d4135ee37650aba1b4483a3939d3cadbb36:web/public/app.css > web/public/app.css
python3 - <<'PY'
from pathlib import Path
import re
css = Path('web/public/app.css').read_text()
css = re.sub(
    r'/\* ── dialkit lock[^*]*\*/\s*\.dialkit-lock \{.*?\n\.dialkit-lock\.ok \{[^}]+\}\n',
    '', css, count=1, flags=re.S)
css = re.sub(r'\n@keyframes lockShake \{[^}]+\}\n', '\n', css, count=1)
css = re.sub(r'\n@keyframes unlockPulse \{[^}]+\}\n', '\n', css, count=1)
Path('web/public/app.css').write_text(css)
assert 'dialkit' not in css.lower()
print('app.css OK', len(css))
PY

echo "Stripping dialkit from app.js..."
python3 - <<'PY'
from pathlib import Path
import re
js = Path('web/public/app.js').read_text()
js = re.sub(r"\nconst DIALKIT_PASSCODE = '4050';\n", "\n", js)
js = re.sub(r"\nconst DIALKIT_PASSCODE_KEY = 'yserflow\.dialkit\.passcode\.ok';\n", "\n", js)
js = re.sub(r"\nconst dialKitPasscodeRemembered = \(\) => \{[\s\S]*?\};\n\nconst rememberDialKitPasscode = ok => \{[\s\S]*?\};\n", "\n", js, count=1)
js = re.sub(r"\nlet layoutDialMounted = false;\n\nfunction applyLayoutDialKitStyles\(values\) \{[\s\S]*?\n\}\n\nfunction mountLayoutDialKit\(\) \{[\s\S]*?\n\}\n", "\n", js, count=1)
js = re.sub(r"\nfunction openDialKitPasscodeSheet\(\) \{[\s\S]*?\n\}\n\nfunction launchDialKit\(\) \{[\s\S]*?\n\}\n", "\n", js, count=1)
js = js.replace("    rememberDialKitPasscode(false);\n", "")
js = re.sub(r"\n  const dial = el\('button', 'btn small', 'DialKit'\);\n  dial\.type = 'button';\n  dial\.addEventListener\('click', launchDialKit\);\n  wrap\.append\(dial\);\n", "\n", js, count=1)
left = [l for l in js.splitlines() if 'dialkit' in l.lower() or 'DialKit' in l or 'DIALKIT' in l]
if left:
    raise SystemExit('still has dialkit: ' + repr(left[:5]))
Path('web/public/app.js').write_text(js)
print('app.js OK', len(js))
PY

echo "Done. Review, then: git add -A && git commit -m 'Remove dialkit from app.js and app.css' && git push"
