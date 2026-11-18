# Neo Centra — Turia Cookie Sync (Chrome extension)

Keeps the LMS's Neo Centra **Incentives** module authenticated to Turia. Turia has
no API, and its `accessToken` cookie is HttpOnly (a web page can't read it), so this
extension reads that one cookie via the `chrome.cookies` API and pushes it to the
LMS every 5 minutes — and immediately whenever Turia rotates the token.

## One-time server setup (admin)

Set these on the LMS host (Railway → Variables):

```
NEO_TURIA_RELAY_TOKEN=<a long random string, e.g. openssl rand -hex 32>
NEO_TURIA_COOKIE_KEY=<64 hex characters: openssl rand -hex 32>
```

The extension sends the relay token as a `Bearer` token so it can push the cookie without an
LMS login session. The cookie key encrypts the stored token; without it the LMS refuses to
store anything. Redeploy after setting them.

## Install (each director, one-time)

1. Chrome/Edge → `chrome://extensions` (or `edge://extensions`)
2. Turn on **Developer mode** (top-right)
3. **Load unpacked** → select this `neo-centra-extension` folder
4. Pin it to the toolbar
5. Click the icon → enter the **Relay token** (the `NEO_TURIA_RELAY_TOKEN` value) → **Save**

The LMS address is **fixed in the build** (`config.js`: `https://lms.indefine.in`) and shown
read-only in the popup; it is not a setting, so nobody can point the Turia token elsewhere.
For staging or a local dev server, build a copy:

```
node neo-centra-extension/build.mjs --origin=https://staging.example.in
```

and load the `dist/` folder it writes (git-ignored). The build accepts only `https://<host>`
(or `http://localhost:<port>`) with no path, and rewrites `config.js`, the LMS entry in
`host_permissions` and the manifest's `connect-src` together. The service worker checks the
address again at run time.

## Use

1. Keep a logged-in `https://practice.turia.in` tab open in that browser.
2. That's it — the token pushes automatically. Click **Sync now** to force a push.
3. Badge: **✓** green = pushed · **⚠** amber = not logged in / no relay token · **!** red = LMS rejected/unreachable, or a bad build.
4. In the LMS, open **Neo Centra → Incentives → Sync** to compute the buckets from the freshest token.

## How it works

- `chrome.cookies.getAll({ domain: "practice.turia.in", name: "accessToken" })` → sends `accessToken=<value>` only. No other Turia cookie leaves the browser.
- POSTs `{ cookie }` to `<pinned LMS>/api/tools/neo-centra/turia-cookie` with `Authorization: Bearer <relay token>` (no redirect followed, no browser cookies attached).
- The LMS keeps only the `accessToken` (anything else in a pasted header is dropped), encrypted, in one row, and uses it server-side for `task/list`, `invoice/list`, `leads/list`, `timesheet/list`, `task/get`.
- Re-pushes on `accessToken` rotation and every 5 min; nudges Turia (reading the `activeOrganizationId` cookie locally) so the token stays fresh.

## Permissions

- `cookies` — read the Turia `accessToken` cookie (HttpOnly) and the organisation id for the keep-alive
- `alarms` — the 5-minute push
- `storage` — remember the relay token and last status
- host access to `https://practice.turia.in` (read) and the pinned LMS host (write); the extension CSP allows connections to those two origins only

Nothing leaves the machine except the POST to the pinned LMS.
