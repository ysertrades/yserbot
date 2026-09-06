#!/usr/bin/env bash
set -euo pipefail
python3 << 'PY'
from pathlib import Path
import re
js = Path('web/public/app.js').read_text()

# Ensure companyId is in draft and form has company field
if 'Company ID (biz_' in js and 'draft.companyId' in js:
    print('company field already present')
else:
    # Patch draft object inside renderWhop
    old_draft = '''  const draft = {
    enabled: !!d.enabled,
    apiKey: "",
    unlockKey: false,
    channelId: d.channelId || null,
    mentionRoleId: d.mentionRoleId || null,
    pollMinutes: d.pollMinutes || 10,
    onlyVideos: d.onlyVideos !== false,
    maxPerCheck: d.maxPerCheck || 5,
    buttonLabel: d.buttonLabel || "open course",
    selectedCourseIds: (d.courses || []).filter(c => c.selected).map(c => c.id),
  };'''
    new_draft = '''  const draft = {
    enabled: !!d.enabled,
    apiKey: "",
    unlockKey: false,
    companyId: d.companyId || "",
    companyRoute: d.companyRoute || "",
    channelId: d.channelId || null,
    mentionRoleId: d.mentionRoleId || null,
    pollMinutes: d.pollMinutes || 10,
    onlyVideos: d.onlyVideos !== false,
    maxPerCheck: d.maxPerCheck || 5,
    buttonLabel: d.buttonLabel || "open course",
    selectedCourseIds: (d.courses || []).filter(c => c.selected).map(c => c.id),
  };'''
    if old_draft not in js:
        raise SystemExit('draft block not found — run simplify-whop-ui.sh first')
    js = js.replace(old_draft, new_draft, 1)

    needle = 'children.push(pickOne("Post channel"'
    insert = '''children.push(textField("Company ID (biz_…)", draft.companyId, v => { draft.companyId = v; }, { placeholder: "biz_xxxxxxxxxxxxxx" }));
  children.push(el("p", "hint", "Required for Scan. Find it in Whop Developer dashboard or your company URL."));
  children.push(textField("Whop route (optional)", draft.companyRoute, v => { draft.companyRoute = v; }, { placeholder: "your-whop-slug" }));
  children.push(pickOne("Post channel"'''
    if 'Company ID (biz_' not in js:
        if needle not in js:
            raise SystemExit('post channel line not found')
        js = js.replace(needle, insert, 1)

    # Include companyId in save body
    old_body = '''    const body = {
      enabled: draft.enabled,
      channelId: draft.channelId,
      mentionRoleId: draft.mentionRoleId,
      pollMinutes: draft.pollMinutes,
      onlyVideos: draft.onlyVideos,
      maxPerCheck: draft.maxPerCheck,
      buttonLabel: draft.buttonLabel,
    };'''
    new_body = '''    const body = {
      enabled: draft.enabled,
      companyId: draft.companyId || null,
      companyRoute: draft.companyRoute || null,
      channelId: draft.channelId,
      mentionRoleId: draft.mentionRoleId,
      pollMinutes: draft.pollMinutes,
      onlyVideos: draft.onlyVideos,
      maxPerCheck: draft.maxPerCheck,
      buttonLabel: draft.buttonLabel,
    };'''
    if old_body in js:
        js = js.replace(old_body, new_body, 1)
    else:
        print('WARN: save body not patched')

    Path('web/public/app.js').write_text(js)
    print('app.js company fields OK')

# writes await
t = Path('web/writes.js').read_text()
if 'await whopPanel.saveSettings' not in t:
    t = t.replace('const r = whopPanel.saveSettings(guildId, body, ctx);',
                  'const r = await whopPanel.saveSettings(guildId, body, ctx);', 1)
    Path('web/writes.js').write_text(t)
    print('writes.js await OK')
else:
    print('writes.js already awaits')
PY
echo Done.
