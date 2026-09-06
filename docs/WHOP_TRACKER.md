# Whop course tracker

## Quick start

```bash
bash scripts/fix-panel-and-whop.sh
git add -A && git commit -m 'Restore panel + Whop tracker' && git push
```

Then open the control panel → **Feeds → Whop courses**:

1. Paste your Whop API key (saved once, masked after)
2. Click **Scan courses**
3. Tick the courses to track
4. Set post channel (and optional ping role)
5. Optional: Link button label + URL (e.g. your education page)
6. Turn **enabled** on

## Appearance

**Appearance → Whop lesson** controls embed colour, title, body, footer.

Tokens: `{title}` `{course}` `{type}`

Default voice (QuantLab brand book):

```
new lesson
**{title}**

course · {course}
```

Footer: `whop · {type}`

## How it works

- Polls every ~60s; each guild respects its own interval (default 10 min)
- Only **new** lessons (known IDs stored in `whop.json`)
- First scan baselines selected courses so the library is not dumped
- Optional Link button on every post (label + URL in Feeds settings)

## Files

| Path | Role |
|------|------|
| `utils/whopFeed.js` | API, scan, settings |
| `utils/whopRunner.js` | Poller + embed + button |
| `web/whop.js` | Panel handlers |
| `events/ready.js` | `startWhopRunner` |
| `web/writes.js` | `whop` / `whopscan` ops |
| `web/api.js` | Overview payload |
| `utils/messageStyle.js` | `whop.lesson` catalogue |
