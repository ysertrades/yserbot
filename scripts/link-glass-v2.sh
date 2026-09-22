#!/bin/bash
set -e
cd /workspaces/yserbot 2>/dev/null || cd "$(dirname "$0")/.."
git pull origin main
if ! grep -q 'glass-v2.css' web/public/index.html; then
  sed -i 's|<link rel="stylesheet" href="/app.css">|<link rel="stylesheet" href="/app.css">\n<link rel="stylesheet" href="/glass-v2.css">|' web/public/index.html
  echo "linked glass-v2.css"
else
  echo "already linked"
fi
git add web/public/index.html web/public/glass-v2.css 2>/dev/null || true
git status
git commit -m "Link dark glass v2 — quieter cards matching insets" || echo "nothing to commit"
git push origin main
