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

// Pro sectionId ALLE Wrapper behalten
function collectSections(root) {
  const out = {};
  const seen = new WeakSet();
  (function walk(n) {
    if (!n || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n.sectionId === 'string' && ('section' in n || 'sectionData' in n)) {
      (out[n.sectionId] ||= []).push(n);
    }
    for (const k in n) walk(n[k]);
  })(root);
  return out;
}
function mergeSections(target, src) {
  for (const [id, arr] of Object.entries(src)) target[id] = (target[id] || []).concat(arr);
}

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

// Airbnb-Rauschen entfernen (Logging, Typnamen, Nulls)
const NOISE = new Set(['__typename', 'loggingData', 'loggingEventData', 'e2eLoggingSession', 'experiments', 'eventData', 'eventDataSchema', 'eventDataSchemaName']);
function prune(v) {
  if (Array.isArray(v)) return v.map(prune).filter((x) => x !== undefined);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (NOISE.has(k) || x == null) continue;
      const p = prune(x);
      if (p === undefined || (Array.isArray(p) && !p.length) || (p && typeof p === 'object' && !Array.isArray(p) && !Object.keys(p).length)) continue;
      o[k] = p;
    }
    return o;
  }
  return v;
}
function capJson(v, max = 9000) {
  const p = prune(v);
  const s = JSON.stringify(p);
  if (s === undefined) return null;
  return s.length > max ? `${s.slice(0, max)}…[gekürzt, ${s.length} Zeichen]` : p;
}

// Die eigentlichen Listing-Daten liegen unter data.node.pdpPresentation (mehrere Kopien → größte je Key)
function mergePdp(roots) {
  const merged = {};
  for (const o of deepFind(roots, (x) => x.pdpPresentation && typeof x.pdpPresentation === 'object')) {
    for (const [k, v] of Object.entries(o.pdpPresentation)) {
      if (v == null) continue;
      const len = JSON.stringify(v).length;
      if (!merged[k] || len > merged[k].len) merged[k] = { v, len };
    }
  }
  return Object.fromEntries(Object.entries(merged).map(([k, x]) => [k, x.v]));
}

function stripQuery(u) { return (u || '').split('?')[0]; }
function isListingPhoto(src) {
  return /muscache\.com\/im\/pictures/.test(src) &&
    !/AirbnbPlatformAssets|airbnb-platform-assets|\/user\//.test(src);
}

function normalize(sections, pdp) {
  const sec = (re) => Object.keys(sections).filter((k) => re.test(k)).map((k) => sections[k]);

  const title = firstKey(sec(/^TITLE/), 'title');

  const descParts = deepFind(
    [...sec(/^DESCRIPTION_MODAL/), ...sec(/^DESCRIPTION_DEFAULT/)],
    (o) => typeof o.htmlText === 'string',
  ).map((o) => o.htmlText);
  const description = uniq(descParts).join('\n\n---\n\n') || null;

  // Amenities: seeAllAmenitiesGroups (alle) bevorzugt, sonst preview
  const groupsSrc = pdp.amenities?.seeAllAmenitiesGroups?.length ? pdp.amenities.seeAllAmenitiesGroups : (pdp.amenities ?? {});
  const seenAm = new Set();
  const amenities = deepFind(groupsSrc, (o) => Array.isArray(o.amenities)).flatMap((g) =>
    g.amenities.map((a) => ({
      group: g.title ?? null,
      name: a.title ?? null,
      available: a.available !== false,
      note: a.subtitle || null,
    })),
  ).filter((a) => {
    const k = `${a.group}|${a.name}`;
    return seenAm.has(k) ? false : seenAm.add(k);
  });

  const seenPh = new Set();
  const photos = deepFind(sec(/^PHOTO_TOUR/), (o) => typeof o.baseUrl === 'string')
    .map((p) => ({ url: stripQuery(p.baseUrl), caption: p.accessibilityLabel || p.caption || null, id: p.id ?? null }))
    .filter((p) => (seenPh.has(p.url) ? false : seenPh.add(p.url)))
    .map((p, i) => ({ position: i + 1, ...p }));

  const seenSl = new Set();
  const sleeping = deepFind(pdp.sleepingArrangements ?? {}, (o) => typeof o.title === 'string' && typeof o.subtitle === 'string')
    .map((a) => ({ room: a.title, beds: a.subtitle }))
    .filter((a) => { const k = `${a.room}|${a.beds}`; return seenSl.has(k) ? false : seenSl.add(k); });

  const highlights = (Array.isArray(pdp.highlights) ? pdp.highlights : [])
    .map((h) => ({ title: h.title ?? null, subtitle: h.subtitle ?? h.message ?? null }));

  const q = pdp.quality ?? {};
  const ratings = {
    overall: capJson(q.listingRatingStats?.overallRatingStats ?? pdp.listingRatingStats?.overallRatingStats ?? null, 2000),
    categories: (q.categoryRatings ?? []).map((c) => ({ category: c.categoryType ?? null, value: c.localizedRating ?? null })),
    distribution: capJson(q.ratingDistribution ?? null, 3000),
  };

  return {
    title,
    description,
    highlights,
    sleeping,
    amenities,
    photos,
    ratings,
    locationTexts: uniq(strings(sec(/^LOCATION/), 'htmlText')),
    pdp: {
      keys: Object.keys(pdp),
      sleepingArrangements: capJson(pdp.sleepingArrangements),
      hostInfo: capJson(pdp.hostInfo),
      location: capJson(pdp.location),
      quality: capJson(pdp.quality),
    },
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
      });
    }
  }
  return [...map.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
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
const dialogText = (page) => page.$eval('[role="dialog"]', (e) => e.innerText).catch(() => null);

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
  const apiRoots = [];
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
      apiRoots.push(json);
      if (/Reviews/i.test(op)) reviewRoots.push(json);
      mergeSections(apiSections, collectSections(json));
    } catch {}
  });

  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await page.waitForSelector('h1', { timeout: 20000 }).catch(() => errors.push('h1 nicht gefunden'));
    await dismiss(page);
    await page.waitForTimeout(2000);

    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 1400); await page.waitForTimeout(350); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    // Sichtbarer Seitentext (Fallback + Kontext)
    const pageText = await page.evaluate(() => (document.querySelector('main') || document.body).innerText).catch(() => null);

    // Eingebetteter State + API-Antworten
    const states = await page.evaluate(() =>
      [...document.querySelectorAll('script[id^="data-deferred-state"]')].map((s) => s.textContent),
    );
    const stateRoots = [];
    const sections = {};
    for (const t of states) {
      try { const j = JSON.parse(t); stateRoots.push(j); mergeSections(sections, collectSections(j)); } catch {}
    }
    mergeSections(sections, apiSections);
    const pdp = mergePdp([...stateRoots, ...apiRoots]);
    const data = normalize(sections, pdp);

    const pageTitle = await page.title().catch(() => null);
    const h1 = await page.locator('h1').first().textContent().catch(() => null);
    data.title = data.title || h1;

    // Dialog-Fallbacks
    const dialogs = {};
    if (!data.amenities.length) {
      if (await openDialogBy(page, /Alle\s+\d+\s+Ausstattung|Show all\s+\d+\s+amenities/i, 'Amenities', errors)) {
        dialogs.amenitiesText = await dialogText(page);
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

    // Reviews im Volltext
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
        dialogs.reviewsHeader = ((await dialogText(page)) || '').slice(0, 3000);
        await closeDialog(page);
      }
    }
    const apiReviews = extractReviews([...reviewRoots, ...Object.values(sections)]);
    const reviews = apiReviews.length >= domReviews.length ? apiReviews : domReviews;

    if (opts.debug) {
      console.log(`[DBG SUMMARY] amenities=${data.amenities.length} sleeping=${data.sleeping.length} photos=${data.photos.length} highlights=${data.highlights.length} reviews=${reviews.length} cats=${data.ratings.categories.length} descLen=${(data.description || '').length} pdpKeys=${data.pdp.keys.join(',')} errors=${JSON.stringify(errors)}`);
      console.log(`[DBG SLEEPING] ${JSON.stringify(data.pdp.sleepingArrangements).slice(0, 3400)}`);
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
      pageText: pageText ? pageText.slice(0, 40000) : null,
      debug: {
        apiOps: [...apiOps],
        reviewSources: { api: apiReviews.length, dom: domReviews.length },
        errors,
      },
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
