# Neo Centra — Turia Cookie Sync (Chrome extension)

Keeps the LMS's Neo Centra **Incentives** module authenticated to Turia. Turia has
no API, and its `accessToken` cookie is HttpOnly (a web page can't read it), so this
extension reads it via the `chrome.cookies` API and pushes the session cookie to the
LMS every 5 minutes — and immediately whenever Turia rotates the token.

## One-time server setup (admin)

Set a shared secret on the LMS host (Railway → Variables):

```
NEO_TURIA_RELAY_TOKEN=<a long random string, e.g. openssl rand -hex 32>
```

The extension sends this as a `Bearer` token so it can push the cookie without an
LMS login session. Redeploy after setting it.

## Install (each director, one-time)

1. Chrome/Edge → `chrome://extensions` (or `edge://extensions`)
2. Turn on **Developer mode** (top-right)
3. **Load unpacked** → select this `neo-centra-extension` folder
4. Pin it to the toolbar
5. Click the icon → set **LMS URL** (`https://lms.indefine.in`) and **Relay token**
   (the `NEO_TURIA_RELAY_TOKEN` value) → **Save**

## Use

1. Keep a logged-in `https://practice.turia.in` tab open in that browser.
2. That's it — the cookie pushes automatically. Click **Sync now** to force a push.
3. Badge: **✓** green = pushed · **⚠** amber = not logged in / not configured · **!** red = LMS rejected/unreachable.
4. In the LMS, open **Neo Centra → Incentives → Sync** to compute the buckets from the freshest cookie.

## How it works

- `chrome.cookies.getAll({ domain: "practice.turia.in" })` → builds the `Cookie` header (incl. HttpOnly `accessToken`).
- POSTs `{ cookie }` to `LMS/api/tools/neo-centra/turia-cookie` with `Authorization: Bearer <relay token>`.
- The LMS stores it (single row) and uses it server-side for `task/list`, `invoice/list`, `leads/list`, `timesheet/list`, `task/get`.
- Re-pushes on `accessToken` rotation and every 5 min; nudges Turia so the token stays fresh.

## Permissions

- `cookies` — read the Turia session cookie (incl. HttpOnly token)
- `alarms` — the 5-minute push
- `storage` — remember the LMS URL, relay token, last status
- host access to `practice.turia.in` (read) and the LMS host (write)

Nothing leaves the machine except the POST to your LMS.
