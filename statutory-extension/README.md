# Statutory Updates Collector (Chrome extension)

Feeds the LMS **Statutory updates** tool (`/tools/statutory-updates`) with the six
portals that refuse non-Indian IPs — Income Tax (CBDT), CBIC tax-information, GSTN,
MCA, EPFO and ESIC. The LMS server (Railway) collects the other six itself.

Once a day, the first time Chrome is open after 07:00 IST, it opens each portal in a
background tab, runs the statutory-updates skill's collector in the page
(`collectors.js`), reads each post's document, and pushes everything to
`https://lms.indefine.in/api/tools/statutory/ingest`. It covers the last 7 days, so a
day the PC was off is caught up the next day.

## One-time server setup (admin)

Railway → Variables:

```
STATUTORY_RELAY_TOKEN=<openssl rand -hex 32>
```

`GEMINI_API_KEY` and `CRON_SECRET` are already set. Redeploy.

## Install (one office PC in India)

1. Chrome → `chrome://extensions` → turn on **Developer mode**
2. **Load unpacked** → select this `statutory-extension` folder → pin it
3. Click the icon → paste the relay token → **Save token**
4. **Run now** once and check each portal shows a count (not FAILED)

The PC must be on with Chrome open for at least one 30-minute check a day. The
extension's badge shows ✓ after a clean run and ! when a portal failed.

## When a portal shows FAILED or STALE on the LMS page

- **STALE** (no report for 36 h): the PC was off, Chrome closed, or the token is wrong.
- **FAILED** with a portal error: the site has probably changed. Open it, find the new
  listing/API call (DevTools → Network), fix that `collect_*` in `collectors.js`, and
  update the skill's Appendix C to match. Reload the extension in `chrome://extensions`.
