# Firm OS Companion (Chrome side panel)

Keeps your current Firm OS task beside whatever you are working on, including a government
portal in your own browser, so you work on one task at a time. The side panel shows:

- the current task (client, service, period, why it is first, what to do next) and an
  **Open in Firm OS** link back to the job;
- the SOP steps, numbered, with the step you are on highlighted, and an **I've done this step**
  tick for your own tracking (ticks stay in this browser and start again for the next job;
  they never change anything in Firm OS);
- a short checklist for the current step;
- values to paste yourself, each with a **Copy** button (client legal name, client code, period,
  and — where the SOP has you paste them — GSTIN for GST and CIN for ROC, plus amounts from the
  approved pack; PAN is only ever shown masked to the last four);
- the next few jobs, folded away under **Later**.

**It is read-only.** It has no content scripts and no access to the sites you visit. It never
reads, fills or submits any page, and never files, signs, pays, enters an OTP or sends anything.
You do all of that yourself.

## Install (each person, once)

1. Get this `firm-os-companion-extension` folder (your admin shares it).
2. Chrome → `chrome://extensions` → turn on **Developer mode** (top right).
3. **Load unpacked** → choose the `firm-os-companion-extension` folder → pin **Firm OS Companion**
   to the toolbar. The Options page opens by itself the first time.

The extension's ID is always `emjmdagolmalbajejchchjihgggcnkdb` (fixed by the public `key` in
`manifest.json`), wherever the folder is. Chrome 116 or later is required (side panel).

## Pair it with Firm OS

1. Sign in to Firm OS and open **Companion** (`https://lms.indefine.in/companion`). It is
   available to people whose admin has turned the Companion on for them (admins and partners for
   now).
2. Give the pairing a name (for example "Office desktop, Chrome") and choose
   **Create pairing code**. Copy the code — it is shown only once.
3. In the extension's **Options** page (right-click the toolbar icon → Options), paste the code
   and choose **Save and test connection**. You should see "Connected".
4. Click the toolbar icon to open the side panel. It refreshes every minute while it is open, and
   when you choose **Refresh**.

A pairing works for 90 days. To stop one early (lost laptop, new browser), choose **Revoke** next
to it on the Companion page; the panel using it stops at its next refresh. If the panel says
"Your pairing has expired", create a new pairing and paste it on the Options page.

## Server setup (admin)

Nothing is needed for this extension: the API allows its fixed ID
(`chrome-extension://emjmdagolmalbajejchchjihgggcnkdb`) by default and refuses every other
browser origin. Only if a differently keyed build must be allowed (a store or policy-installed
copy, a fork), set on Railway → Variables, comma-separated, and redeploy:

```
FIRM_OS_COMPANION_EXTENSION_ORIGIN=chrome-extension://<extension id>
```

Setting it replaces the default; include the fixed ID too if both builds are in use.

## Another Firm OS address (staging)

The extension talks to exactly one address, `https://lms.indefine.in`. For a staging server:

```
node firm-os-companion-extension/build.mjs --origin=https://<staging host>
```

This writes `firm-os-companion-extension/dist/` (not committed) with the address changed in
`config.js`, `host_permissions` and the content security policy. Load `dist/` unpacked instead.

## Privacy

- **Stored in this browser:** the pairing token (`chrome.storage.local`), and which steps you
  ticked for the current job (`chrome.storage.session`, cleared when the browser closes). No
  task, client details or amounts are written to storage; the panel keeps them in memory only.
- **Fetched:** your current task from Firm OS — one read-only request
  (`GET /api/firm-os/companion/next-task`) about once a minute while the panel is open. It sends
  the pairing token and, while a task is on screen, that answer's ETag (`If-None-Match`) so an
  unchanged task comes back as an empty "not modified" answer; nothing else, no cookies.
- **Firm OS keeps:** only a fingerprint (sha256) of the token, its name, when it was created and
  last used, and when it was revoked.
- **Never:** reads, fills or submits any web page; looks at the sites you visit; talks to any
  address other than Firm OS; files, signs, pays, enters an OTP or sends anything to anyone.

## Permissions

| Permission | Why |
|---|---|
| `sidePanel` | Show the panel beside the page you are working on |
| `storage` | Keep the pairing token and your step ticks in this browser |
| host `https://lms.indefine.in/*` | Read your current task from Firm OS — the only site it can reach |

No content scripts, no `tabs`, `scripting`, `cookies` or other permissions. A repo test
(`tests/unit/companion-extension-safety.test.ts`) fails if any of that changes.

## Files

| File | What it does |
|---|---|
| `manifest.json` | MV3 manifest: permissions, side panel, options page, content security policy |
| `background.js` | Opens the panel from the toolbar icon; opens Options on first install |
| `sidepanel.html` / `sidepanel.js` | The panel |
| `options.html` / `options.js` | Paste the token, test the connection, forget the pairing |
| `api.js` | The extension's only network request |
| `core.js` | Pure logic (states, messages, links, ticks), unit-tested in the LMS repo |
| `storage.js` | Everything the extension stores |
| `config.js` | The Firm OS address |
| `build.mjs` | Optional copy for another address |
