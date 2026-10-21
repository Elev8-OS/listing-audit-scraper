import http from 'node:http';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.API_KEY || '';
const NAV_TIMEOUT = 45000;
const TOTAL_TIMEOUT = 150000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const httpError = (status, message) => Object.assign(new Error(message), { status });

/* ---------- Browser & Queue (immer nur ein Scrape gleichzeitig) ---------- */
let browser = null;
async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  return browser;
}
let chain = Promise.resolve();
function enqueue(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}
const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(httpError(504, 'Timeout')), ms))]);

/* ---------- Helfer ---------- */
function parseListingUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw httpError(400, 'Ungültige URL'); }
  if (!/(^|\.)airbnb\.[a-z.]+$/i.test(u.hostname)) throw httpError(400, 'Nur airbnb.*-URLs erlaubt');
  const m = u.pathname.match(/\/rooms\/(?:plus\/)?(\d+)/);
  if (!m) throw httpError(400, 'Keine /rooms/<id>-URL');
  const host = u.hostname.replace(/^www\./, '');
  return { id: m[1], host, url: `https://www.${host}/rooms/${m[1]}` };
}

// Airbnb liefert die Seite als verschachteltes JSON mit "sections".
// Wir behalten pro sectionId ALLE Wrapper (Section + Geschwister-Felder), weil der Inhalt
// je nach Seite im "section"-Objekt oder daneben liegen kann und manche Kopien nur Stubs sind.
function collectSections(root) {
  const out = {};
  const seen = new WeakSet();
  (function walk(n) {
    if (!n || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n.sectionId === 'string' && 'section' in n) {
      (out[n.sectionId] ||= []).push(n);
    }
    for (const k in n) walk(n[k]);
  })(root);
  return out;
}
function mergeSections(target, src) {
  for (const [id, arr] of Object.entries(src)) target[id] = (target[id] || []).concat(arr);
}

// Tolerante Suche: alle Objekte im Baum, die pred erfüllen
function deepFind(root, pred, limit = 1000) {
  const out = [];
  const seen = new WeakSet();
  (function walk(n) {
    if (out.length >= limit || !n || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    if (!Array.isArray(n) && pred(n)) out.push(n);
    for (const k in n) walk(n[k]);
  })(root);
  return out;
}
const firstKey = (root, key) => {
  const f = deepFind(root, (o) => o[key] != null, 1)[0];
  return f ? f[key] : null;
};
const strings = (root, key) => deepFind(root, (o) => typeof o[key] === 'string').map((o) => o[key]);
const uniq = (arr) => [...new Set(arr)];

function stripQuery(u) { return (u || '').split('?')[0]; }
function isListingPhoto(src) {
  return /muscache\.com\/im\/pictures/.test(src) &&
    !/AirbnbPlatformAssets|airbnb-platform-assets|\/user\//.test(src);
}

function normalize(sections) {
  const sec = (re) => Object.keys(sections).filter((k) => re.test(k)).map((k) => sections[k]);
  const first = (re) => sec(re);

  const title = firstKey(first(/^TITLE/), 'title');

  const descParts = deepFind(
    [...sec(/^DESCRIPTION_MODAL/), ...sec(/^DESCRIPTION_DEFAULT/)],
    (o) => typeof o.htmlText === 'string',
  ).map((o) => o.htmlText);
  const description = uniq(descParts).join('\n\n---\n\n') || null;

  const seenAm = new Set();
  let amenities = deepFind(sec(/^AMENITIES/), (o) => Array.isArray(o.amenities)).flatMap((g) =>
    g.amenities.map((a) => ({
      group: g.title ?? null,
      name: a.title ?? null,
      available: a.available !== false,
      note: a.subtitle || null,
    })),
  );
  if (!amenities.length) {
    amenities = deepFind(sec(/^AMENITIES/), (o) => typeof o.title === 'string' && 'available' in o).map((a) => ({
      group: null, name: a.title, available: a.available !== false, note: a.subtitle || null,
    }));
  }
  amenities = amenities.filter((a) => {
    const k = `${a.name}|${a.available}`;
    return seenAm.has(k) ? false : seenAm.add(k);
  });

  const seenPh = new Set();
  const photos = deepFind(sec(/^PHOTO_TOUR/), (o) => typeof o.baseUrl === 'string')
    .map((p) => ({ url: stripQuery(p.baseUrl), caption: p.accessibilityLabel || p.caption || null, id: p.id ?? null }))
    .filter((p) => (seenPh.has(p.url) ? false : seenPh.add(p.url)))
    .map((p, i) => ({ position: i + 1, ...p }));

  const seenSl = new Set();
  const sleeping = deepFind(sec(/^SLEEPING/), (o) => typeof o.title === 'string' && typeof o.subtitle === 'string')
    .map((a) => ({ room: a.title, beds: a.subtitle }))
    .filter((a) => { const k = `${a.room}|${a.beds}`; return seenSl.has(k) ? false : seenSl.add(k); });

  const rv = sec(/^REVIEWS/);
  const ratings = rv.length
    ? {
        overall: firstKey(rv, 'overallRating') ?? firstKey(rv, 'localizedOverallRating') ?? firstKey(rv, 'ratingAverage'),
        count: firstKey(rv, 'overallCount') ?? firstKey(rv, 'reviewsCount') ?? firstKey(rv, 'reviewCount'),
        categories: uniq(
          deepFind(rv, (o) => 'categoryType' in o).map((r) =>
            JSON.stringify({ category: r.categoryType, label: r.label ?? null, value: r.localizedRating ?? r.value ?? null })),
        ).map((s) => JSON.parse(s)),
        distribution: firstKey(rv, 'ratingDistribution') ?? null,
        topics: uniq(strings(rv, 'localizedTitle').concat(strings(rv, 'tagName'))),
      }
    : null;

  return {
    title,
    description,
    overview: uniq(strings(sec(/^OVERVIEW/), 'title')),
    highlights: deepFind(sec(/^HIGHLIGHTS/), (o) => typeof o.title === 'string' && 'subtitle' in o)
      .map((h) => ({ title: h.title, subtitle: h.subtitle })),
    sleeping,
    amenities,
    photos,
    ratings,
    guestFavoriteBanner: uniq(strings(sec(/^GUEST_FAVORITE/), 'title')),
    hostTexts: uniq(strings(sec(/^(MEET_YOUR_HOST|HOST_OVERVIEW)/), 'title')),
    houseRules: uniq(
      deepFind(sec(/^POLICIES/), (o) => typeof o.title === 'string')
        .map((o) => JSON.stringify({ title: o.title, text: o.subtitle ?? null })),
    ).map((s) => JSON.parse(s)),
    location: firstKey(sec(/^LOCATION/), 'subtitle'),
    locationTexts: uniq(strings(sec(/^LOCATION/), 'htmlText')),
  };
}

function extractReviews(roots) {
  const map = new Map();
  for (const o of deepFind(roots, (x) => typeof x.comments === 'string' && x.id != null && 'reviewer' in x, 5000)) {
    const id = String(o.id);
    if (!map.has(id)) {
      map.set(id, {
        id,
        rating: o.rating ?? null,
        date: o.localizedDate ?? null,
        createdAt: o.createdAt ?? null,
        language: o.language ?? null,
        reviewer: o.reviewer?.firstName ?? null,
        reviewerLocation: o.localizedReviewerLocation ?? null,
        text: o.comments,
        hostResponse: o.response ?? null,
        needsTranslation: o.localizedReview?.needsTranslation ?? null,
      });
    }
  }
  return [...map.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function logChunks(label, value, max = 12000) {
  let s = typeof value === 'string' ? value : JSON.stringify(value);
  if (!s) return;
  if (s.length > max) s = `${s.slice(0, max)}…[+${s.length - max} Zeichen]`;
  for (let i = 0; i * 3500 < s.length; i++) console.log(`[DBG ${label} #${i}] ${s.slice(i * 3500, (i + 1) * 3500)}`);
}

/* ---------- DOM-Interaktion ---------- */
async function dismiss(page) {
  for (const re of [/Alle akzeptieren|Accept all|Akzeptieren/i, /Schließen|Close|Verstanden|Got it/i]) {
    try {
      const b = page.locator('button').filter({ hasText: re }).first();
      if (await b.count()) await b.evaluate((n) => n.click());
    } catch {}
  }
  await page.keyboard.press('Escape').catch(() => {});
}

async function openDialogBy(page, regex, label, errors) {
  const el = page.locator('button, a, [role="button"]').filter({ hasText: regex }).first();
  if (!(await el.count())) { errors.push(`${label}: Button nicht gefunden`); return false; }
  try {
    await el.evaluate((n) => { n.scrollIntoView({ block: 'center' }); n.click(); });
    await page.waitForSelector('[role="dialog"]', { timeout: 7000 });
    await page.waitForTimeout(1500);
    return true;
  } catch (e) {
    errors.push(`${label}: ${String(e.message).split('\n')[0]}`);
    return false;
  }
}
const closeDialog = async (page) => { await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(600); };

async function scrollDialog(page, countSel, max = 60) {
  let stable = 0, last = -1;
  for (let i = 0; i < max && stable < 3; i++) {
    await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return;
      const c = [d, ...d.querySelectorAll('*')]
        .filter((e) => e.scrollHeight > e.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(e).overflowY))
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (c) c.scrollTop = c.scrollHeight;
    });
    await page.waitForTimeout(800);
    const n = await page.locator(countSel).count();
    if (n === last) stable++; else { stable = 0; last = n; }
  }
  return last;
}

/* ---------- Haupt-Scrape ---------- */
async function scrape(target, opts) {
  const errors = [];
  const b = await getBrowser();
  const ctx = await b.newContext({
    locale: opts.locale,
    timezoneId: 'Europe/Zurich',
    viewport: { width: 1440, height: 1000 },
    userAgent: UA,
  });
  await ctx.route('**/*', (route) => {
    const t = route.request().resourceType();
    return t === 'media' || t === 'font' ? route.abort() : route.continue();
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);

  const apiSections = {};
  const apiOps = new Set();
  const reviewRoots = [];
  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (!url.includes('/api/v3/')) return;
      const op = url.split('/api/v3/')[1].split('?')[0].split('/')[0];
      apiOps.add(op);
      if (!/StaysPdp/i.test(op)) return;
      if (!(res.headers()['content-type'] || '').includes('json')) return;
      const json = await res.json();
      if (/Reviews/i.test(op)) reviewRoots.push(json);
      mergeSections(apiSections, collectSections(json));
    } catch {}
  });

  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await page.waitForSelector('h1', { timeout: 20000 }).catch(() => errors.push('h1 nicht gefunden'));
    await dismiss(page);
    await page.waitForTimeout(2000);

    // Lazy-Sections laden
    for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 1400); await page.waitForTimeout(350); }
    await page.evaluate(() => window.scrollTo(0, 0));

    // 1) Eingebetteter State + API-Antworten (alle Kopien behalten)
    const states = await page.evaluate(() =>
      [...document.querySelectorAll('script[id^="data-deferred-state"]')].map((s) => s.textContent),
    );
    const sections = {};
    for (const t of states) { try { mergeSections(sections, collectSections(JSON.parse(t))); } catch {} }
    mergeSections(sections, apiSections);
    const data = normalize(sections);

    const pageTitle = await page.title().catch(() => null);
    const h1 = await page.locator('h1').first().textContent().catch(() => null);
    data.title = data.title || h1;

    // 2) Fallbacks per Dialog
    const dialogs = {};
    if (!data.amenities.length) {
      if (await openDialogBy(page, /Alle\s+\d+\s+Ausstattung|Show all\s+\d+\s+amenities/i, 'Amenities', errors)) {
        dialogs.amenitiesText = await page.$eval('[role="dialog"]', (e) => e.innerText).catch(() => null);
        await closeDialog(page);
      }
    }
    if (data.photos.length < 6) {
      if (await openDialogBy(page, /Alle Fotos anzeigen|Show all photos/i, 'Fotos', errors)) {
        await scrollDialog(page, '[role="dialog"] img', 40);
        const imgs = await page.$$eval('[role="dialog"] img', (els) =>
          els.map((i) => ({ src: i.currentSrc || i.src, alt: i.alt || null })));
        const seen = new Set();
        data.photos = imgs.filter((i) => isListingPhoto(i.src)).map((i) => ({ url: stripQuery(i.src), caption: i.alt }))
          .filter((i) => (seen.has(i.url) ? false : seen.add(i.url)))
          .map((p, idx) => ({ position: idx + 1, ...p }));
        await closeDialog(page);
      }
    }

    // 3) Reviews im Volltext (Dialog öffnen + scrollen → Airbnb lädt weitere Seiten per API)
    let domReviews = [];
    if (opts.reviews) {
      if (await openDialogBy(page, /Alle\s+\d+\s+\S*[Bb]ewertungen|Show all\s+\d+\s+reviews/i, 'Reviews', errors)) {
        await scrollDialog(page, '[role="dialog"] [data-review-id]', 80);
        const items = await page.$$eval('[role="dialog"] [data-review-id]', (els) =>
          els.map((e) => ({ id: e.getAttribute('data-review-id'), text: e.innerText })));
        const seen = new Set();
        domReviews = items.filter((r) => (seen.has(r.id) ? false : seen.add(r.id))).map((r) => {
          const lines = r.text.split('\n').map((s) => s.trim()).filter(Boolean);
          return { id: r.id, reviewer: lines[0] ?? null, meta: lines[1] ?? null, text: lines.slice(2).join('\n') };
        });
        await closeDialog(page);
      }
    }
    const apiReviews = extractReviews([...reviewRoots, ...Object.values(sections)]);
    const reviews = apiReviews.length >= domReviews.length ? apiReviews : domReviews;

    // Debug: Roh-Struktur ins Railway-Log (nur mit &debug=1)
    if (opts.debug) {
      const want = /^(TITLE|AMENITIES|SLEEPING|REVIEWS|HIGHLIGHTS|OVERVIEW|GUEST_FAVORITE|HOST_OVERVIEW|POLICIES|LOCATION)/;
      for (const [id, arr] of Object.entries(sections)) {
        console.log(`[DBG KEYS ${id}] copies=${arr.length} wrapperKeys=${JSON.stringify(arr.map((w) => Object.keys(w)))} sizes=${JSON.stringify(arr.map((w) => JSON.stringify(w).length))}`);
        if (want.test(id)) {
          const biggest = [...arr].sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
          logChunks(id, biggest, 9000);
        }
      }
      console.log(`[DBG] reviews api=${apiReviews.length} dom=${domReviews.length} errors=${JSON.stringify(errors)}`);
    }

    return {
      ok: true,
      fetchedAt: new Date().toISOString(),
      listingId: target.id,
      url: target.url,
      pageTitle,
      ...data,
      reviews,
      reviewCount: reviews.length,
      dialogs,
      debug: {
        sectionIds: Object.keys(sections),
        apiOps: [...apiOps],
        reviewSources: { api: apiReviews.length, dom: domReviews.length },
        errors,
      },
      ...(opts.raw ? { raw: sections } : {}),
    };
  } finally {
    await ctx.close().catch(() => {});
  }
}

/* ---------- HTTP ---------- */
function send(res, status, body, pretty) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, pretty ? 2 : 0));
}
function keyOk(given) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(API_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pretty = u.searchParams.get('pretty') === '1';
  try {
    if (u.pathname === '/health') return send(res, 200, { ok: true });
    if (u.pathname === '/scrape') {
      if (!API_KEY) throw httpError(503, 'API_KEY ist nicht gesetzt');
      const given =
        (req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
        req.headers['x-api-key'] ||
        u.searchParams.get('key');
      if (!keyOk(given)) throw httpError(401, 'Unauthorized');
      const target = parseListingUrl(u.searchParams.get('url') || '');
      const opts = {
        reviews: u.searchParams.get('reviews') !== '0',
        raw: u.searchParams.get('raw') === '1',
        debug: u.searchParams.get('debug') === '1',
        locale: u.searchParams.get('locale') || 'de-DE',
      };
      const data = await enqueue(() => withTimeout(scrape(target, opts), TOTAL_TIMEOUT));
      return send(res, 200, data, pretty);
    }
    send(res, 404, { error: 'Not found. Nutze GET /scrape?url=<airbnb-url>' });
  } catch (e) {
    send(res, e.status || 500, { ok: false, error: e.message }, pretty);
  }
});
server.listen(PORT, () => console.log(`listing-audit-scraper läuft auf :${PORT}`));
process.on('SIGTERM', async () => { await browser?.close().catch(() => {}); process.exit(0); });
