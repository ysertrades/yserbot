# Journal feed: sending trades to Quant Bot

Your journal sends each trade it saves to Quant Bot, and Quant Bot posts it as a card in a Discord channel. When you edit the trade, the same card updates. When you delete it, the card is crossed out.

The server owner sets this up in the Quant Bot panel (Feeds → Journal feed) and sends you two things privately:

- **the feed link**, for example `https://yser.apps.bot-hosting.cloud/hooks/journal/AbC…`
- **the secret**, starting with `jf_…`

Keep the secret in your server's config, such as an environment variable like `QUANTBOT_FEED_SECRET`. Never put it in code, a repository or a browser. If it leaks, the owner rotates it and the old secret stops working at once.

## The request

Send one `POST` to the feed link for each event, from your **server** (never from the browser):

| | |
|---|---|
| Method | `POST` |
| `Content-Type` | `application/json` |
| `X-Timestamp` | Unix time in **seconds**, when you sent it |
| `X-Signature` | `sha256=` plus the hex HMAC-SHA256 of `"<X-Timestamp>.<raw body>"`, keyed with the secret |

Sign the **exact bytes** you send: serialise the JSON once, sign that string, and send that same string. A request with a missing, wrong or more than 5-minute-old signature gets `401`.

## The body

```json
{
  "event": "trade.created",
  "id": "t_8f2a91",
  "trader": "Ali",
  "symbol": "NQ",
  "side": "Long",
  "pnl": 840.5,
  "r": 2.1,
  "qty": 2,
  "entry": 21480.25,
  "exit": 21501.25,
  "setup": "Opening range",
  "session": "NY AM",
  "notes": "Swept the Asia high, then displacement.",
  "image": "https://your-journal.com/charts/t_8f2a91.png",
  "url": "https://your-journal.com/trades/t_8f2a91",
  "at": "2026-10-22T14:31:00Z"
}
```

- `event` is one of `trade.created`, `trade.updated`, `trade.deleted` or `ping`.
- `id` is required, and must be **stable**: the same trade always has the same id. It's how an edit or delete finds its card, and how a retry is spotted.
- Everything else is optional. Numbers can be numbers or strings (`"1,240.50"` works).
- `side`: `Long`, `Short`, `buy` or `sell`.
- `outcome` (`win`, `loss`, `be`, `missed`) can be sent. Otherwise it's taken from the sign of `pnl`.
- `image` and `url` must be `https://`. The image appears on the card, and the URL becomes an "Open in the journal" button.
- `@everyone` and other mentions in notes never ping anyone.
- The body can be up to 64 KB.

## The answers

| Status | Meaning | What to do |
|---|---|---|
| `200` | Posted, updated, or already posted (a retry) | Done |
| `400` | The body is wrong (no `id`, unknown `event`, bad JSON) | Fix the request |
| `401` | Bad, missing or old signature | Check the secret and the clock |
| `404` | Unknown feed link | The feed was deleted |
| `409` | The feed is paused, or this trade is posting right now | Retry later |
| `410` | The feed's channel is gone | Ask the owner to pick a channel |
| `429` | More than 120 requests a minute | Back off, then retry |
| `5xx` | Discord or the bot had a problem | Retry with the same body |

Retrying is always safe: the same `trade.created` sent twice posts one card.

## Examples

**Node.js**

```js
const crypto = require('crypto');

async function sendToQuantBot(event, trade) {
  const body = JSON.stringify({ event, ...trade });
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = 'sha256=' + crypto.createHmac('sha256', process.env.QUANTBOT_FEED_SECRET).update(`${ts}.${body}`).digest('hex');
  const res = await fetch(process.env.QUANTBOT_FEED_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': sig },
    body,
  });
  if (res.status >= 500 || res.status === 429) { /* queue it and retry later */ }
  return res.json();
}

// when a trade is saved:   await sendToQuantBot('trade.created', trade)
// when it is edited:       await sendToQuantBot('trade.updated', trade)
// when it is deleted:      await sendToQuantBot('trade.deleted', { id: trade.id })
```

**Python**

```python
import hashlib, hmac, json, os, time, requests

def send_to_quantbot(event, trade):
    body = json.dumps({"event": event, **trade}, separators=(",", ":"))
    ts = str(int(time.time()))
    sig = "sha256=" + hmac.new(os.environ["QUANTBOT_FEED_SECRET"].encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
    return requests.post(os.environ["QUANTBOT_FEED_URL"], data=body,
                         headers={"content-type": "application/json", "x-timestamp": ts, "x-signature": sig}, timeout=10)
```

**PHP**

```php
$body = json_encode(['event' => 'trade.created'] + $trade);
$ts = (string) time();
$sig = 'sha256=' . hash_hmac('sha256', "$ts.$body", getenv('QUANTBOT_FEED_SECRET'));
$ch = curl_init(getenv('QUANTBOT_FEED_URL'));
curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => ['Content-Type: application/json', "X-Timestamp: $ts", "X-Signature: $sig"]]);
$response = curl_exec($ch);
```

## Testing the connection

1. Send `{"event":"ping"}`, signed. A `200` with `"pong": true` means the link and the secret are right. The panel shows the feed as live, with the time of the last delivery.
2. Send one `trade.created`. A card appears in the channel within a second or two.
3. Send a `trade.updated` with the same `id`, and the card changes. Send a `trade.deleted`, and the card is crossed out.

The panel's **Send test card** button shows the owner what a trade looks like in the channel, without involving your site at all.
