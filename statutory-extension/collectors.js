// Statutory Updates Collector — injected into each portal tab (MAIN world, so fetches
// carry the page's own origin and cookies, exactly as the statutory-updates skill ran them).
// The six collect_* adapters below are copied verbatim from the skill's Appendix C; keep
// them in step. Differences from the skill's COMMON block: no pdf.js — PDFs are sent to
// the LMS as base64 and read on the server (RU.docPayload), and RU.readTexts is replaced
// by window.__statutory.payloads.

window.RU = { items: [] };
RU.clean = s => (s || '').replace(/\s+/g, ' ').trim();
RU.MON = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
RU.pad = n => String(n).padStart(2, '0');
RU.iso = function (s, order) {                        // order: 'DMY' (default) | 'MDY' for all-numeric dates
  if (!s) return null; s = String(s);
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?[\s\-\/.,]+([A-Za-z]{3,9})[\s\-\/.,]+(\d{4})/);
  if (m && RU.MON[m[2].slice(0, 3).toLowerCase()]) return `${m[3]}-${RU.pad(RU.MON[m[2].slice(0, 3).toLowerCase()])}-${RU.pad(m[1])}`;
  m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (m && RU.MON[m[1].slice(0, 3).toLowerCase()]) return `${m[3]}-${RU.pad(RU.MON[m[1].slice(0, 3).toLowerCase()])}-${RU.pad(m[2])}`;
  m = s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
  if (m) { const a = +m[1], b = +m[2]; const d = order === 'MDY' ? b : a, mo = order === 'MDY' ? a : b;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${m[3]}-${RU.pad(mo)}-${RU.pad(d)}`; }
  return null;
};
RU.item = o => Object.assign({ portal: null, section: null, doc_type: 'Other', title: null, issue_date: null,
  upload_date: null, date_basis: 'upload', url: null, alt_url: null, text: null }, o);
RU.inRange = (x, from, to) => { const d = x.upload_date || x.issue_date; return !!d && d >= from && d <= to; };
RU.lastModified = async url => {                      // IST date of the file on the server (sites that show no dates)
  try { let r = await fetch(url, { method: 'HEAD', credentials: 'omit' }); let lm = r.headers.get('last-modified');
    if (!lm) { r = await fetch(url, { credentials: 'omit' }); lm = r.headers.get('last-modified'); }
    return lm ? new Date(new Date(lm).getTime() + 330 * 60000).toISOString().slice(0, 10) : null; } catch (e) { return null; } };
RU.meta = () => JSON.stringify(RU.items.map((x, i) => [i, x.upload_date, x.issue_date, x.section, (x.title || '').slice(0, 200), x.url]));
RU.MAX_PDF = 4 * 1024 * 1024;
RU.b64 = buf => { const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
// {pdfBase64} for PDFs (CBIC tax-info serves {data: base64-PDF} JSON), {text} for HTML pages.
RU.docPayload = async url => {
  try { const r = await fetch(url, { credentials: 'omit' }); if (!r.ok) return { text: `[fetch ${r.status}]` };
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('json')) { const j = await r.json(); return j.data ? { pdfBase64: j.data } : { text: '[no document in response]' }; }
    const buf = await r.arrayBuffer();
    if (String.fromCharCode(...new Uint8Array(buf.slice(0, 5))) === '%PDF-')
      return buf.byteLength > RU.MAX_PDF ? { text: '[PDF too large to read]' } : { pdfBase64: RU.b64(buf) };
    return { text: RU.clean(new DOMParser().parseFromString(new TextDecoder().decode(buf), 'text/html').body.textContent).slice(0, 1800) };
  } catch (e) { return { text: '[unreadable: ' + String(e).slice(0, 60) + ']' }; } };

// ===== INCOME TAX — on https://www.incometaxindia.gov.in/ (any page) =====
// What's New blueprint takes a from/to window; covers notifications, circulars, press releases, CBDT orders,
// misc communications, recruitment rules, others. Needs Accept-Language: en-US (else HTTP 406).
async function collect_incometax(from, to) {
  const attrs = { "search.empty.search": true, "search.experiences.blueprint.external.reference.code": "WHAT_NEW_ERC",
    "search.experiences.press_release": "PRESS_RELEASE", "search.experiences.recruitment_rules": "RECRUITMENT_RULES",
    "search.experiences.miscellaneous_communication": "MISCELLANEOUS_COMMUNICATION", "search.experiences.circular_key": "CIRCULAR_KEY",
    "search.experiences.notification_key": "NOTIFICATION_KEY", "search.experiences.others": "OTHERS",
    "search.experiences.number_of_days": from.replace(/-/g, '') + '000000', "search.experiences.today_date": to.replace(/-/g, '') + '000000' };
  const out = [];
  for (let p = 1; p < 20; p++) {
    const r = await fetch('/o/search/v1.0/search?nestedFields=embedded&page=' + p + '&pageSize=100&restrictFields=embedded.actions%2Cembedded.creator',
      { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en-US' }, body: JSON.stringify({ attributes: attrs }) });
    if (!r.ok) throw new Error('IT search HTTP ' + r.status);
    const j = await r.json();
    for (const i of j.items || []) {
      const e = i.embedded || {}, cf = e.contentFields || [];
      const val = f => f && f.contentFieldValue ? (f.contentFieldValue.data || (f.contentFieldValue.document && f.contentFieldValue.document.contentUrl) || '') : '';
      const get = n => val(cf.find(x => x.name === n));
      let file = get('reportFile');
      if (!file) { const dc = cf.find(x => x.name === 'downloadContent'); const nf = dc && (dc.nestedContentFields || []);
        file = nf ? (val(nf.find(x => x.name === 'reportFile')) || val(nf.find(x => x.name === 'webContentLink'))) : ''; }
      if (!file) file = get('linkToPage');                      // never use 'evidenceAttachment' (internal upload proof)
      const cats = (e.taxonomyCategoryBriefs || []).map(c => c.taxonomyCategoryName);
      const kind = cats.find(c => /Notification|Circular|Press|Order|Miscellaneous|Recruitment|Direct Taxes Data|Departmental News|FAQ/i.test(c)) || cats[0] || 'Other';
      out.push(RU.item({ portal: 'Income Tax (CBDT)', section: "What's New · " + kind,
        doc_type: /Notification/i.test(kind) ? 'Notification' : /Circular/i.test(kind) ? 'Circular' : /Press/i.test(kind) ? 'Press Release' : /Order/i.test(kind) ? 'Order' : 'Communication',
        title: RU.clean(i.title), issue_date: (get('circularNotificationDate') || '').slice(0, 10) || null,
        upload_date: (get('uploadDate') || e.datePublished || '').slice(0, 10) || null,
        url: file ? (file.startsWith('http') ? file : location.origin + file) : null }));
    }
    if (!j.items || j.items.length < 100) break;
  }
  RU.items = out.filter(x => RU.inRange(x, from, to)); return RU.meta();
}

// ===== GST — CBIC TAX INFORMATION — on https://taxinformation.cbic.gov.in/ =====
// Only the latest-updates feed is wired (latest few GST circulars/notifications). Document text: /content/pdf/<path>
// returns JSON {data: base64 PDF}; shareable link: /view-pdf/<id>/ENG/<Circulars|Notifications>.
async function collect_cbic(from, to) {
  const j = await (await fetch('/api/cbic-notification-msts/fetchUpdatesByTaxId/1000001')).json();
  RU.items = j.map(x => RU.item({ portal: 'GST – CBIC', section: x.updateCategory, doc_type: x.updateType,
    title: RU.clean((x.notificationNo || '') + ' – ' + (x.notificationName || '')), upload_date: RU.iso(x.updatedDate),
    url: `${location.origin}/view-pdf/${x.id}/ENG/${x.updateType === 'Circular' ? 'Circulars' : 'Notifications'}`,
    textUrl: `${location.origin}/content/pdf/${(x.docFilePath || '').replace(/\\/g, '/')}` })).filter(x => RU.inRange(x, from, to));
  return RU.meta();
}

// ===== GST — GSTN NEWS — on https://www.gst.gov.in/newsandupdates (wait ~4 s after load) =====
// Text: navigate to each /newsandupdates/read/<id> and use get_page_text (content is rendered client-side).
function collect_gstn(from, to) {
  const seen = new Set();
  RU.items = [...document.querySelectorAll('a[href*="/newsandupdates/read/"]')].map(a => {
    let b = a; for (let i = 0; i < 4 && b.parentElement && !/\d{2}\/\d{2}\/\d{4}/.test(b.textContent); i++) b = b.parentElement;
    return RU.item({ portal: 'GST – GSTN', section: 'News and Updates', doc_type: 'News', title: RU.clean(a.textContent),
      upload_date: RU.iso((RU.clean(b.textContent).match(/\d{2}\/\d{2}\/\d{4}/) || [''])[0]), url: a.href }); })
    .filter(x => x.title.length > 8 && !seen.has(x.url) && seen.add(x.url) && RU.inRange(x, from, to));
  return RU.meta();
}

// ===== MCA — on https://www.mca.gov.in/content/mca/global/en/home.html (wait ~4 s) =====
// Two sources: the acts/rules e-book API (dates are MM/DD/YYYY!) and the homepage tabs (/bin/dms/tablist, DD-MM-YYYY).
// Tab data loads only after the tabs are clicked. Document link: /bin/dms/getdocument?mds=<docID>&type=open.
// MCA's CSP blocks the PDF reader and its PDFs use embedded fonts: summarise from titles and mark ⚑.
async function collect_mca(from, to) {
  const clean = RU.clean, out = [];
  for (const c of ['Circulars', 'Notifications', 'Rules', 'Forms', 'Orders']) {
    try { const j = await (await fetch('/bin/ebook/service/documentMetadata?docCategory=' + c + '&flag=initial&status=Current', { credentials: 'omit' })).json();
      for (const x of (j.data || [])) out.push(RU.item({ portal: 'MCA', section: 'Acts & Rules · ' + c, doc_type: c.replace(/s$/, ''),
        title: clean(x.docName + ' – ' + x.shortDescription), issue_date: RU.iso(x.notificationdate, 'MDY'), upload_date: RU.iso(x.UploadDate, 'MDY'), url: null, ebook: x.link }));
    } catch (e) { }
  }
  for (const b of [...document.querySelectorAll('button, a, li')].filter(b => /^(Important Updates|What's New|Notices|Circulars|Press Release|Recent Reports)$/i.test(clean(b.textContent)))) {
    b.click(); await new Promise(r => setTimeout(r, 700)); }
  await new Promise(r => setTimeout(r, 1500));
  const names = ["What's New", 'Notices', 'Circulars', 'Recent Reports', 'Press Release'];
  const req = [...new Set(performance.getEntriesByType('resource').filter(e => e.name.includes('/bin/dms/tablist')).map(e => e.name))];
  for (const [k, u] of req.entries()) {
    const tx = await (await fetch(u, { credentials: 'omit' })).text(); if (!tx.startsWith('{')) continue;
    for (const d of JSON.parse(JSON.parse(tx).documentDetails || '[]'))
      out.push(RU.item({ portal: 'MCA', section: 'Homepage · ' + (names[k] || 'tab ' + k), doc_type: 'Notice', title: clean(d.column1),
        upload_date: RU.iso(d.column2), url: `${location.origin}/bin/dms/getdocument?mds=${d.docID}&type=open` }));
  }
  const inr = out.filter(x => RU.inRange(x, from, to));
  for (const x of inr.filter(x => !x.url)) {          // e-book items: borrow the homepage link when the same document is there
    const twin = inr.find(y => y.url && y.title.toLowerCase().includes((x.title.split(' – ')[0] || '').toLowerCase()));
    x.url = twin ? twin.url : `${location.origin}/content/mca/global/en/acts-rules/ebooks/${x.section.split(' · ')[1].toLowerCase()}.html`;
  }
  RU.items = inr; return RU.meta();
}

// ===== EPFO — on https://www.epfo.gov.in/ =====
// The site shows almost no posting dates. Homepage links to /wp-content/uploads/YYYY/MM/ files: posting date = file-server
// Last-Modified (IST); the date in the filename, if any, is the document date. Also: /tender-notices/ table and /press-release/.
// The /circulars/ archive stops in 2025 — past months cannot be fully rebuilt.
async function collect_epfo(from, to) {
  const clean = RU.clean, out = [], seen = new Set();
  for (const a of document.querySelectorAll('a[href*="/uploads/20"]')) {
    const m = a.href.match(/uploads\/(\d{4})\/(\d{2})\//); if (!m || `${m[1]}-${m[2]}` < from.slice(0, 7) || seen.has(a.href)) continue;
    seen.add(a.href);
    let box = a; for (let i = 0; i < 4 && box.parentElement && clean(box.textContent).length < 40; i++) box = box.parentElement;
    const f = decodeURIComponent(a.href.split('/').pop()); const fd = f.match(/(\d{2})[.\-_](\d{2})[.\-_](20\d{2})/);
    out.push(RU.item({ portal: 'EPFO', section: 'Homepage', doc_type: /circular/i.test(f) ? 'Circular' : 'Notice',
      title: clean(a.textContent) || clean(box.textContent).slice(0, 200), issue_date: fd ? `${fd[3]}-${fd[2]}-${fd[1]}` : null,
      upload_date: await RU.lastModified(a.href), date_basis: 'file-server', url: a.href, textUrl: a.href }));
  }
  const tn = await (await fetch('/tender-notices/', { credentials: 'omit' })).text();
  for (const m of tn.matchAll(/Subject\s*(?:<[^>]+>\s*)*([^<]{10,300})[\s\S]{0,400}?Last Date\s*(?:<[^>]+>\s*)*(\d{2}\/\d{2}\/\d{4})([\s\S]{0,600}?)(?=Subject|$)/g)) {
    const link = (m[3].match(/href=["']([^"']+)["']/) || [])[1];
    const ta = document.createElement('textarea'); ta.innerHTML = clean(m[1]); const title = ta.value;       // decode &#8211; etc.
    if (out.some(o => o.title.toLowerCase().slice(0, 50) === title.toLowerCase().slice(0, 50))) continue;    // already on homepage
    out.push(RU.item({ portal: 'EPFO', section: 'Tenders / Notices', doc_type: 'Notice', title, issue_date: RU.iso(m[2]),
      date_basis: 'issue', url: link || location.origin + '/tender-notices/' }));
  }
  const pr = new DOMParser().parseFromString(await (await fetch('/press-release/', { credentials: 'omit' })).text(), 'text/html');
  for (const a of pr.querySelectorAll('a[href*="/uploads/"]')) {
    let b = a; for (let i = 0; i < 4 && b.parentElement && !/(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, 20\d{2}/.test(b.textContent); i++) b = b.parentElement;
    const d = RU.iso((clean(b.textContent).match(/(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, 20\d{2}/) || [''])[0]);
    if (d && !seen.has(a.href)) { seen.add(a.href); out.push(RU.item({ portal: 'EPFO', section: 'Press Release', doc_type: 'Press Release',
      title: clean(decodeURIComponent(a.href.split('/').pop()).replace(/\.pdf$/i, '').replace(/[-_]/g, ' ')), upload_date: d, url: a.href, textUrl: a.href })); }
  }
  RU.items = out.filter(x => RU.inRange(x, from, to)); return RU.meta();
}

// ===== ESIC — on https://esic.gov.in/circulars =====
// Circulars table (Branch, Dated DD-MM-YYYY, Subject, Publish Date ISO); pages at /circulars/index/page:N.
// Also News & Events (/newsevents) and Press Releases (/press-release, "Publish Date: DD/MM/YYYY").
async function collect_esic(from, to) {
  const clean = RU.clean, out = [];
  for (let p = 1; p <= 40; p++) {
    const d = new DOMParser().parseFromString(await (await fetch(p === 1 ? '/circulars' : '/circulars/index/page:' + p, { credentials: 'omit' })).text(), 'text/html');
    let oldest = '9999';
    for (const r of [...d.querySelectorAll('tr')].slice(1)) {
      const c = [...r.querySelectorAll('td')]; if (c.length < 5) continue;
      const pub = clean(c[4].textContent).slice(0, 10); if (pub < oldest) oldest = pub;
      const a = c[3].querySelector('a[href]');
      out.push(RU.item({ portal: 'ESIC', section: 'Circulars · ' + clean(c[1].textContent), doc_type: /office order/i.test(c[3].textContent) ? 'Office Order' : 'Circular',
        title: clean(c[3].textContent).replace(/-?\s*PDF\s*size:\(.*?\)\s*\.?/gi, ' ').trim(), issue_date: RU.iso(clean(c[2].textContent)),
        upload_date: pub, url: a ? new URL(a.getAttribute('href'), location.origin).href : null }));
    }
    if (oldest < from) break;
  }
  const ne = new DOMParser().parseFromString(await (await fetch('/newsevents', { credentials: 'omit' })).text(), 'text/html');
  for (const r of [...ne.querySelectorAll('tr')].slice(1)) {
    const c = [...r.querySelectorAll('td')].map(x => clean(x.textContent)); const a = r.querySelector('a[href]');
    out.push(RU.item({ portal: 'ESIC', section: 'News & Events · ' + (c[1] || ''), doc_type: 'News', title: (c[2] || '').replace(/-?\s*PDF\s*size:\(.*?\)\s*\.?/gi, ' ').trim(),
      upload_date: RU.iso(clean(r.textContent)), url: a ? new URL(a.getAttribute('href'), location.origin).href : null }));
  }
  const pr = new DOMParser().parseFromString(await (await fetch('/press-release', { credentials: 'omit' })).text(), 'text/html');
  const seenPR = new Set();
  for (const a of pr.querySelectorAll('a[href*="/attachments/pressfile/"]')) {
    let b = a; for (let i = 0; i < 5 && b.parentElement && !/Publish Date/.test(b.textContent); i++) b = b.parentElement;
    const d = RU.iso((clean(b.textContent).match(/Publish Date:\s*(\d{2}\/\d{2}\/\d{4})/) || ['', ''])[1]);
    const key = d + (clean(b.textContent).slice(0, 60)); if (!d || seenPR.has(key)) continue; seenPR.add(key);
    out.push(RU.item({ portal: 'ESIC', section: 'Press Release', doc_type: 'Press Release', title: clean(a.textContent) || clean(b.textContent).replace(/Publish Date:.*?\d{4}/, '').slice(0, 200),
      upload_date: d, url: a.href }));
  }
  RU.items = out.filter(x => RU.inRange(x, from, to)); return RU.meta();
}

// ===== dispatcher called by background.js =====
var COLLECTORS = { 'Income Tax (CBDT)': collect_incometax, 'GST – CBIC': collect_cbic, 'GST – GSTN': collect_gstn,
  'MCA': collect_mca, 'EPFO': collect_epfo, 'ESIC': collect_esic };
window.__statutory = {
  // Collect one portal's in-range items; returns their metadata (no document bodies yet).
  async collect(portal, from, to) {
    await COLLECTORS[portal](from, to);
    return RU.items.map(({ textUrl, ebook, ...x }) => x);
  },
  // Document bodies for items [start, start+count). Same rule as the skill's readTexts:
  // only same-origin documents (or an explicit textUrl) can be fetched from the page.
  async payloads(start, count) {
    return Promise.all(RU.items.slice(start, start + count).map(async it => {
      if (it.portal === 'MCA') return {};                    // MCA PDFs use embedded fonts: summarise from titles
      if (!it.url || (!it.url.startsWith(location.origin) && !it.textUrl)) return {};
      return RU.docPayload(it.textUrl || it.url);
    }));
  },
};
