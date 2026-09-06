# Whop course tracker

## What it does
- Stores your Whop API key once (no re-login)
- Scans every course, you pick which to track
- Polls for new video lessons
- Posts a calm QuantLab-style embed + optional Link button
- Embed wording/colour editable in **Appearance → Whop lesson**
- Button label/URL editable in **Feeds → Whop**

## Files already on main
- `utils/whopFeed.js` — API, scan, known lessons
- `utils/whopRunner.js` — poller + Link button
- `web/whop.js` — panel read/save/scan
- `events/ready.js` — starts `startWhopRunner`

## Still to wire (next commit)
1. `web/writes.js` — `whop` + `whopscan` ops
2. `web/api.js` — include `whop` in guild overview
3. `utils/messageStyle.js` — catalogue entry `whop.lesson`
4. Feeds tab UI in `index.html` + `app.js`

## Dialkit cleanup
Run: `bash scripts/remove-dialkit.sh`
Then commit and push.
