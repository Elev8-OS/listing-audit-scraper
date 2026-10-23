import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.API_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const PHOTO_MODEL = process.env.PHOTO_MODEL || 'claude-sonnet-5-5';
const PHOTO_MAX = Number(process.env.PHOTO_MAX || 0);              // 0 = alle Fotos des Inserats analysieren
const PHOTO_SINGLE = Number(process.env.PHOTO_SINGLE || 30);       // bis zu dieser Zahl ein einzelner Aufruf, darueber in Gruppen
const PHOTO_CHUNK = Number(process.env.PHOTO_CHUNK || 20);         // Fotos pro Gruppe
const PHOTO_PAR = Number(process.env.PHOTO_PAR || 2);              // Gruppen gleichzeitig
const ANTHROPIC_BASE = process.env.ANTHROPIC_BASE || 'https://api.anthropic.com';
const NAV_TIMEOUT = 45000;
const TOTAL_TIMEOUT = 150000;
const PHOTO_TIMEOUT = 540000;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MIN || 360) * 60000; // Standard: 6 Stunden
const DATA_DIR = process.env.DATA_DIR || '/tmp/listing-audit-cache'; // mit Railway-Volume dauerhaft
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const httpError = (status, message) => Object.assign(new Error(message), { status });

/* ---------- Cache (Speicher + Datei) ---------- */
const cache = new Map();       // Scrape-Ergebnisse
const photoCache = new Map();  // Foto-Analysen
const lastError = new Map();
const photoErr = new Map();
const inflight = new Map();
const photoJobs = new Map();
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const f of fs.readdirSync(DATA_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
      if (f.startsWith('photos-')) { if (j.listingId) photoCache.set(j.listingId, j); }
      else if (j.listingId) cache.set(j.listingId, j);
    } catch {}
  }
} catch (e) { console.log('Cache-Verzeichnis nicht nutzbar:', e.message); }
function cacheSet(data) {
  cache.set(data.listingId, data);
  fs.writeFile(path.join(DATA_DIR, `${data.listingId}.json`), JSON.stringify(data), () => {});
}
function photoCacheSet(data) {
  photoCache.set(data.listingId, data);
  fs.writeFile(path.join(DATA_DIR, `photos-${data.listingId}.json`), JSON.stringify(data), () => {});
}
const ageSec = (d) => Math.round((Date.now() - Date.parse(d.fetchedAt)) / 1000);
const isFresh = (d) => Boolean(d) && Date.now() - Date.parse(d.fetchedAt) < CACHE_TTL_MS;
// slim=1: ohne Seitentext und Roh-Teile (klein genug für schnelle Abrufe)
function view(d, slim) {
  if (!slim) return d;
  const { pageText, pdp, ...rest } = d;
  return rest;
}

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

// Ein Scrape pro Listing gleichzeitig; Ergebnis wird gecacht
function startScrape(target, opts) {
  if (inflight.has(target.id)) return inflight.get(target.id);
  const p = enqueue(() => withTimeout(scrape(target, opts), TOTAL_TIMEOUT))
    .then((d) => { lastError.delete(target.id); cacheSet(d); return d; })
    .catch((e) => { lastError.set(target.id, { message: e.message, at: new Date().toISOString() }); throw e; })
    .finally(() => inflight.delete(target.id));
  p.catch(() => {});
  inflight.set(target.id, p);
  return p;
}

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
      note: (typeof a.subtitle === 'string' ? a.subtitle : a.subtitle?.text) || null,
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

  // Schlafarrangements: stops[] mit name + description.descriptions[].text
  let sleeping = (pdp.sleepingArrangements?.stops ?? []).map((s) => ({
    room: s.name ?? null,
    beds: (s.description?.descriptions ?? []).map((d) => d.text).filter(Boolean).join(', ') || null,
    photoId: s.items?.[0]?.image?.imageId ?? null,
  }));
  if (!sleeping.length) {
    const seenSl = new Set();
    sleeping = deepFind(pdp.sleepingArrangements ?? {}, (o) => typeof o.title === 'string' && typeof o.subtitle === 'string')
      .map((a) => ({ room: a.title, beds: a.subtitle, photoId: null }))
      .filter((a) => { const k = `${a.room}|${a.beds}`; return seenSl.has(k) ? false : seenSl.add(k); });
  }

  const q = pdp.quality ?? {};
  const ratings = {
    overall: capJson(q.listingRatingStats?.overallRatingStats ?? pdp.listingRatingStats?.overallRatingStats ?? null, 2000),
    isGuestFavorite: q.isGuestFavorite ?? null,
    categories: (q.categoryRatings ?? []).map((c) => ({ category: c.categoryType ?? null, label: c.label ?? null, value: c.localizedRating ?? null })),
    distribution: (q.ratingDistribution ?? []).map((d) => ({ stars: d.label, share: d.localizedRating })),
    topics: (q.reviewTags ?? []).map((t) => ({ topic: t.localizedName ?? t.name, count: t.count })),
  };

  // Nachbarschaftstext des Hosts
  const neighborhoodGuide = deepFind(pdp.location ?? {}, (o) => typeof o.localizedString === 'string')[0]?.localizedString ?? null;

  return {
    title,
    description,
    highlights: capJson(pdp.highlights, 3000),
    sleeping,
    amenities,
    photos,
    ratings,
    houseRules: capJson(pdp.rules ?? pdp.thingsToKnow, 4000),
    neighborhoodGuide: neighborhoodGuide ? neighborhoodGuide.slice(0, 6000) : null,
    pdp: {
      keys: Object.keys(pdp),
      sleepingArrangements: capJson(pdp.sleepingArrangements),
      hostInfo: capJson(pdp.hostInfo),
      location: capJson({ ...pdp.location, seeAllLocationDetails: undefined }),
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

    // Sichtbarer Seitentext (Fallback + Kontext) und Titelbild
    const pageText = await page.evaluate(() => (document.querySelector('main') || document.body).innerText).catch(() => null);
    const coverUrl = await page.$eval('meta[property="og:image"]', (e) => e.content).catch(() => null);

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
        await closeDialog(page);
      }
    }
    const apiReviews = extractReviews([...reviewRoots, ...Object.values(sections)]);
    const reviews = apiReviews.length >= domReviews.length ? apiReviews : domReviews;

    if (opts.debug) {
      console.log(`[DBG SUMMARY] amenities=${data.amenities.length} sleeping=${data.sleeping.length} photos=${data.photos.length} reviews=${reviews.length} cats=${data.ratings.categories.length} descLen=${(data.description || '').length} guideLen=${(data.neighborhoodGuide || '').length} errors=${JSON.stringify(errors)}`);
    }

    return {
      ok: true,
      fetchedAt: new Date().toISOString(),
      listingId: target.id,
      url: target.url,
      reviewsIncluded: opts.reviews,
      pageTitle,
      coverUrl: coverUrl ? stripQuery(coverUrl) : null,
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

/* ---------- Foto-Analyse (Claude Bildanalyse) ---------- */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: e.message }; }
    }
  }));
  return out;
}

async function fetchImageB64(url) {
  const r = await fetch(`${stripQuery(url)}?im_w=1200`, {
    headers: { accept: 'image/jpeg,image/webp,image/png,*/*;q=0.5', 'user-agent': UA },
  });
  if (!r.ok) throw new Error(`Bild nicht ladbar (${r.status})`);
  let type = (r.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  if (!/^image\/(jpeg|png|gif|webp)$/.test(type)) type = 'image/jpeg';
  const buf = Buffer.from(await r.arrayBuffer());
  return { type, data: buf.toString('base64'), bytes: buf.length };
}

const photoSig = (d) => crypto.createHash('sha1').update('v2|' + (d.photos || []).map((p) => p.url).join('|')).digest('hex');   // v2: aeltere Analysen (nur die ersten 30 Fotos) werden neu erzeugt

const PHOTO_INSTRUCTIONS = `Bewerte die Fotos dieses Airbnb-Listings für einen Listing-Audit. Beurteile NUR, was du auf den Bildern wirklich siehst; bei Unsicherheit schreibe "unklar". Sei konkret und knapp.

Antworte AUSSCHLIESSLICH mit gültigem JSON (kein Text davor oder danach, keine Markdown-Zäune) in genau dieser Form:
{
  "photos": [
    {"position": 1, "room": "Küche|Wohnzimmer|Esszimmer|Schlafzimmer|Bad|Balkon/Terrasse|Eingang/Flur|Treppenhaus/Lift|Aussen/Fassade|Detail|Sonstiges",
     "shows": "ein kurzer Satz, was zu sehen ist",
     "brightness": 1-5, "sharpness": 1-5, "composition": 1-5, "tidiness": 1-5,
     "issues": ["z. B. zu dunkel, schiefer Winkel, Unordnung, Gegenlicht, Personen/Auto sichtbar"],
     "keep": true|false,
     "tip": "eine konkrete Verbesserung oder leer"}
  ],
  "cover": {"position": <Nr. des aktuellen Titelbilds oder null>, "verdict": "gut|mittel|schwach", "reason": "ein Satz", "betterPosition": <Nr. oder null>},
  "recommendedOrder": [<Positionen in empfohlener Reihenfolge, die ersten 5 zählen am meisten>],
  "roomCoverage": [{"room": "Küche", "photos": <Anzahl>, "verdict": "ausreichend|zu wenig|fehlt"}],
  "amenityCoverage": [{"amenity": "<Name aus der Liste>", "photographed": true|false|"unklar", "positions": [<Nr.>]}],
  "missingMotifs": ["Motive, die ein Gast erwartet und die fehlen"],
  "overall": {"score": 0-100, "grade": "A|B|C|D|F", "summary": "2-3 Sätze", "topFixes": ["max. 5, nach Wirkung sortiert"]}
}
Skala 1 = schlecht, 5 = sehr gut. "amenityCoverage": nur Ausstattung, die man fotografieren kann (z. B. Küche, Backofen, Geschirrspüler, Waschmaschine, Trockner, Fernseher, Arbeitsplatz, Esstisch, Babybett, Balkon, Lift, Kaffeemaschine, Brettspiele, Eingang). Keine Dinge wie WLAN oder Check-in.`;

const textOf = (j) => (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
function parseJson(text) {
  let a = null;
  try { a = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { a = JSON.parse(m[0]); } catch {} }
  }
  return a;
}
async function claude(content, maxTokens) {   // mit Wiederholung bei Ueberlastung oder Ratenlimit
  let last;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: PHOTO_MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content }] }),
      signal: AbortSignal.timeout(240000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j;
    last = httpError(502, `Anthropic ${r.status}: ${j?.error?.message || 'Fehler'}`);
    if (![429, 500, 502, 503, 529].includes(r.status)) throw last;
    const wait = Math.min(30, Number(r.headers.get('retry-after')) || 5 * (i + 1));
    await new Promise((res) => setTimeout(res, wait * 1000));
  }
  throw last;
}

const CHUNK_INSTRUCTIONS = `Bewerte die Fotos dieser Gruppe für einen Listing-Audit. Beurteile NUR, was du auf den Bildern wirklich siehst; bei Unsicherheit schreibe "unklar". Sei konkret und knapp. Verwende die Foto-Nummern aus den Beschriftungen.

Antworte AUSSCHLIESSLICH mit gültigem JSON (kein Text davor oder danach, keine Markdown-Zäune) in genau dieser Form:
{
  "photos": [
    {"position": <Foto-Nr.>, "room": "Küche|Wohnzimmer|Esszimmer|Schlafzimmer|Bad|Balkon/Terrasse|Eingang/Flur|Treppenhaus/Lift|Aussen/Fassade|Detail|Sonstiges",
     "shows": "ein kurzer Satz, was zu sehen ist",
     "brightness": 1-5, "sharpness": 1-5, "composition": 1-5, "tidiness": 1-5,
     "issues": ["z. B. zu dunkel, schiefer Winkel, Unordnung, Gegenlicht, Personen/Auto sichtbar"],
     "keep": true|false,
     "tip": "eine konkrete Verbesserung oder leer"}
  ],
  "amenityCoverage": [{"amenity": "<Name aus der Liste>", "photographed": true|false|"unklar", "positions": [<Nr.>]}]
}
Skala 1 = schlecht, 5 = sehr gut. "amenityCoverage": nur Ausstattung, die man fotografieren kann (z. B. Küche, Backofen, Geschirrspüler, Waschmaschine, Trockner, Fernseher, Arbeitsplatz, Esstisch, Babybett, Balkon, Lift, Kaffeemaschine, Brettspiele, Eingang). Keine Dinge wie WLAN oder Check-in. "photographed" gilt nur für die Fotos DIESER Gruppe: true, wenn der Punkt auf mindestens einem dieser Fotos klar zu sehen ist, sonst false.`;

const SYNTH_INSTRUCTIONS = `Du bekommst die Einzelbewertungen aller Fotos eines Airbnb-Listings (jedes Foto wurde schon einzeln angesehen). Erstelle daraus die Gesamtbewertung für einen Listing-Audit. Stütze dich nur auf diese Angaben, erfinde nichts.

Antworte AUSSCHLIESSLICH mit gültigem JSON (kein Text davor oder danach, keine Markdown-Zäune) in genau dieser Form:
{
  "cover": {"verdict": "gut|mittel|schwach", "reason": "ein Satz", "betterPosition": <Nr. oder null>},
  "recommendedOrder": [<Positionen in empfohlener Reihenfolge, die ersten 5 zählen am meisten>],
  "roomCoverage": [{"room": "Küche", "verdict": "ausreichend|zu wenig|fehlt"}],
  "missingMotifs": ["Motive, die ein Gast erwartet und die fehlen"],
  "overall": {"score": 0-100, "grade": "A|B|C|D|F", "summary": "2-3 Sätze", "topFixes": ["max. 5, nach Wirkung sortiert"]}
}
"roomCoverage": jeder Raum aus der Zählung plus Räume, die laut Schlafarrangements oder Ausstattung vorhanden sein müssten, aber auf keinem Foto vorkommen (verdict "fehlt"). "recommendedOrder": nenne möglichst alle Fotos, schwache (keep=false) ans Ende.`;

// Viele Fotos: in Gruppen ansehen, dann in einem reinen Textaufruf zur Gesamtbewertung zusammenfassen
async function analyzeChunked(d, photos, cover, amen, sleeping) {
  const groups = [];
  for (let i = 0; i < photos.length; i += PHOTO_CHUNK) groups.push(photos.slice(i, i + PHOTO_CHUNK));
  const usage = { input_tokens: 0, output_tokens: 0 }, skipped = [];
  const addUsage = (j) => { const u = j.usage || {}; usage.input_tokens += u.input_tokens || 0; usage.output_tokens += u.output_tokens || 0; };
  const parts = await mapLimit(groups, PHOTO_PAR, async (g, gi) => {
    const imgs = await mapLimit(g, 5, (p) => fetchImageB64(p.url));
    const content = [{ type: 'text', text: `Listing: "${d.title}". Schlafarrangements: ${sleeping || 'unbekannt'}.\nAmenities laut Airbnb: ${amen}.\nDas Listing hat insgesamt ${photos.length} Fotos. Du siehst Gruppe ${gi + 1} von ${groups.length}: Fotos ${g[0].position} bis ${g[g.length - 1].position} in Airbnb-Reihenfolge, jeweils mit Nummer und Beschriftung.` }];
    let n = 0;
    g.forEach((p, i) => {
      const img = imgs[i];
      if (!img || img.error || !img.data) { skipped.push({ position: p.position, error: img?.error || 'unbekannt' }); return; }
      content.push({ type: 'text', text: `Foto ${p.position} · Beschriftung: ${p.caption ?? '–'}${cover && p.url === cover ? ' · ist das aktuelle TITELBILD' : ''}` });
      content.push({ type: 'image', source: { type: 'base64', media_type: img.type, data: img.data } });
      n++;
    });
    if (!n) throw new Error('Keine Bilder ladbar');
    content.push({ type: 'text', text: CHUNK_INSTRUCTIONS });
    for (let t = 0; t < 2; t++) {
      const j = await claude(content, 8000); addUsage(j);
      const a = parseJson(textOf(j));
      if (a && Array.isArray(a.photos) && a.photos.length) return a;
    }
    throw new Error('Antwort nicht lesbar');
  });

  const byPos = new Map(), am = new Map();
  parts.forEach((a, gi) => {
    const valid = new Set(groups[gi].map((p) => p.position));
    if (!a || a.error) { groups[gi].forEach((p) => { if (!skipped.some((x) => x.position === p.position)) skipped.push({ position: p.position, error: a?.error || 'unbekannt' }); }); return; }
    (a.photos || []).forEach((p) => { const k = Number(p && p.position); if (valid.has(k) && !byPos.has(k)) byPos.set(k, { ...p, position: k }); });
    groups[gi].forEach((p) => { if (!byPos.has(p.position) && !skipped.some((x) => x.position === p.position)) skipped.push({ position: p.position, error: 'nicht bewertet' }); });
    (a.amenityCoverage || []).forEach((x) => {
      const name = String((x && x.amenity) || '').trim(); if (!name) return;
      const k = name.toLowerCase(), cur = am.get(k) || { amenity: name, photographed: false, positions: [] };
      if (x.photographed === true) cur.photographed = true; else if (x.photographed === 'unklar' && cur.photographed !== true) cur.photographed = 'unklar';
      (Array.isArray(x.positions) ? x.positions : []).forEach((n) => { const v = Number(n); if (Number.isFinite(v) && !cur.positions.includes(v)) cur.positions.push(v); });
      am.set(k, cur);
    });
  });
  const list = [...byPos.values()].sort((a, b) => a.position - b.position);
  if (!list.length) throw httpError(502, 'Die Fotos konnten nicht bewertet werden');

  const counts = {}; list.forEach((p) => { const r = p.room || 'Sonstiges'; counts[r] = (counts[r] || 0) + 1; });
  const coverPos = cover ? (photos.find((p) => p.url === cover) || {}).position ?? null : null;
  const lines = list.map((p) => `${p.position} | ${p.room} | ${p.shows} | H${p.brightness} S${p.sharpness} K${p.composition} O${p.tidiness} | ${(p.issues || []).join('; ') || '-'} | ${p.keep === false ? 'streichen' : 'behalten'}${p.tip ? ' | Tipp: ' + p.tip : ''}`);
  const synthText = `Listing: "${d.title}". Schlafarrangements: ${sleeping || 'unbekannt'}.\nAmenities laut Airbnb: ${amen}.\nAktuelles Titelbild: ${coverPos ? 'Foto ' + coverPos : 'unbekannt'}. Fotos insgesamt: ${photos.length}, bewertet: ${list.length}.\nZählung pro Raum: ${Object.entries(counts).map(([r, n]) => `${r} ${n}`).join(', ')}.\n\nFoto | Raum | Zeigt | Noten (Helligkeit, Schärfe, Komposition, Ordnung) | Probleme | Empfehlung\n${lines.join('\n')}\n\n${SYNTH_INSTRUCTIONS}`;
  let s = null;
  for (let t = 0; t < 2 && !(s && s.overall && Array.isArray(s.recommendedOrder)); t++) {
    const j = await claude([{ type: 'text', text: synthText }], 4000); addUsage(j);
    s = parseJson(textOf(j));
  }
  if (!(s && s.overall && Array.isArray(s.recommendedOrder))) throw httpError(502, 'Die Gesamtbewertung der Fotos war nicht lesbar');

  const valid = new Set(list.map((p) => p.position)), seen = new Set(), order = [];
  s.recommendedOrder.forEach((n) => { const k = Number(n); if (valid.has(k) && !seen.has(k)) { seen.add(k); order.push(k); } });
  list.forEach((p) => { if (!seen.has(p.position)) order.push(p.position); });
  const verdicts = ['ausreichend', 'zu wenig', 'fehlt'];
  const rc = (s.roomCoverage || []).filter((r) => r && r.room).map((r) => {
    const c = counts[r.room] || 0; let v = verdicts.includes(r.verdict) ? r.verdict : (c >= 2 ? 'ausreichend' : c === 1 ? 'zu wenig' : 'fehlt');
    if (c > 0 && v === 'fehlt') v = 'zu wenig';
    return { room: String(r.room), photos: c, verdict: v };
  });
  Object.keys(counts).forEach((room) => { if (!rc.some((r) => r.room === room)) rc.push({ room, photos: counts[room], verdict: counts[room] >= 2 ? 'ausreichend' : 'zu wenig' }); });
  const better = Number(s.cover && s.cover.betterPosition);
  return {
    usage, skipped, chunks: groups.length, analysis: {
      photos: list,
      cover: { position: coverPos, verdict: (s.cover && s.cover.verdict) || null, reason: (s.cover && s.cover.reason) || '', betterPosition: valid.has(better) ? better : null },
      recommendedOrder: order, roomCoverage: rc, amenityCoverage: [...am.values()].map((x) => ({ ...x, positions: x.positions.sort((a, b) => a - b) })),
      missingMotifs: Array.isArray(s.missingMotifs) ? s.missingMotifs.map(String).filter(Boolean) : [], overall: s.overall,
    },
  };
}

async function analyzePhotos(d) {
  if (!ANTHROPIC_API_KEY) throw httpError(503, 'ANTHROPIC_API_KEY ist in den Railway-Variablen nicht gesetzt');
  const all = d.photos || [], photos = PHOTO_MAX > 0 ? all.slice(0, PHOTO_MAX) : all;
  if (!photos.length) throw httpError(422, 'Keine Fotos im Scrape-Ergebnis');

  const cover = d.coverUrl ? stripQuery(d.coverUrl) : null;
  const amen = (d.amenities || []).filter((a) => a.available).map((a) => a.name).join(', ');
  const sleeping = (d.sleeping || []).map((s) => `${s.room}: ${s.beds}`).join('; ');

  let analysis = null, skipped = [], usage = null, raw = null, chunks = 1;
  if (photos.length > PHOTO_SINGLE) {
    const r = await analyzeChunked(d, photos, cover, amen, sleeping);
    ({ analysis, skipped, usage, chunks } = r);
  } else {
    const imgs = await mapLimit(photos, 5, (p) => fetchImageB64(p.url));
    const content = [{
      type: 'text',
      text: `Listing: "${d.title}". Schlafarrangements: ${sleeping || 'unbekannt'}.\nAmenities laut Airbnb: ${amen}.\nIm Folgenden ${photos.length} Fotos in Airbnb-Reihenfolge, jeweils mit Nummer und Beschriftung.`,
    }];
    photos.forEach((p, i) => {
      const img = imgs[i];
      if (!img || img.error || !img.data) { skipped.push({ position: p.position, error: img?.error || 'unbekannt' }); return; }
      content.push({ type: 'text', text: `Foto ${p.position} · Beschriftung: ${p.caption ?? '–'}${cover && p.url === cover ? ' · ist das aktuelle TITELBILD' : ''}` });
      content.push({ type: 'image', source: { type: 'base64', media_type: img.type, data: img.data } });
    });
    content.push({ type: 'text', text: PHOTO_INSTRUCTIONS });
    const j = await claude(content, 8000);
    const text = textOf(j);
    analysis = parseJson(text); usage = j.usage ?? null; if (!analysis) raw = text;
  }
  return {
    ok: true,
    listingId: d.listingId,
    analyzedAt: new Date().toISOString(),
    sig: photoSig(d),
    model: PHOTO_MODEL,
    photosAnalyzed: photos.length - skipped.length,
    photosTotal: all.length,
    chunks,
    skipped,
    coverUrl: cover,
    usage,
    analysis,
    ...(analysis ? {} : { raw }),
  };
}

function startPhotos(d) {
  const id = d.listingId;
  if (photoJobs.has(id)) return photoJobs.get(id);
  const p = withTimeout(analyzePhotos(d), PHOTO_TIMEOUT)
    .then((r) => { photoErr.delete(id); photoCacheSet(r); return r; })
    .catch((e) => { photoErr.set(id, { message: e.message, at: new Date().toISOString() }); throw e; })
    .finally(() => photoJobs.delete(id));
  p.catch(() => {});
  photoJobs.set(id, p);
  return p;
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
function requireAuth(req, u) {
  if (!API_KEY) throw httpError(503, 'API_KEY ist nicht gesetzt');
  const given =
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
    req.headers['x-api-key'] ||
    u.searchParams.get('key');
  if (!keyOk(given)) throw httpError(401, 'Unauthorized');
}
const idFrom = (s) => {
  const m = String(s || '').match(/(\d{6,})/);
  if (!m) throw httpError(400, 'Parameter id oder url fehlt (Listing-ID oder Airbnb-URL)');
  return m[1];
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const sp = u.searchParams;
  const pretty = sp.get('pretty') === '1';
  const slim = sp.get('slim') === '1';
  try {
    if (u.pathname === '/health') {
      return send(res, 200, { ok: true, cached: cache.size, photoAnalyses: photoCache.size, running: inflight.size + photoJobs.size, photoAnalysisReady: Boolean(ANTHROPIC_API_KEY) });
    }

    // Übersicht über alle gespeicherten Ergebnisse
    if (u.pathname === '/cache') {
      requireAuth(req, u);
      const items = [...cache.values()].map((d) => ({
        id: d.listingId, title: d.title, fetchedAt: d.fetchedAt, ageSec: ageSec(d), fresh: isFresh(d), reviews: d.reviewCount,
        photoAnalysis: photoCache.has(d.listingId) ? photoCache.get(d.listingId).analyzedAt : null,
      }));
      return send(res, 200, { ok: true, ttlMin: CACHE_TTL_MS / 60000, running: [...inflight.keys()], runningPhotos: [...photoJobs.keys()], items }, pretty);
    }

    // Gespeichertes Ergebnis sofort abrufen (id oder url)
    if (u.pathname === '/cached') {
      requireAuth(req, u);
      const id = idFrom(sp.get('id') || sp.get('url'));
      const d = cache.get(id);
      if (d) return send(res, 200, { ...view(d, slim), cache: { hit: true, ageSec: ageSec(d), fresh: isFresh(d), running: inflight.has(id) } }, pretty);
      if (inflight.has(id)) return send(res, 202, { ok: true, status: 'running', id, hint: 'In ca. 30–60 s erneut abrufen' }, pretty);
      return send(res, 404, { ok: false, cached: false, id, lastError: lastError.get(id) ?? null, hint: 'Zuerst /scrape?async=1&url=… starten' }, pretty);
    }

    if (u.pathname === '/scrape') {
      requireAuth(req, u);
      const target = parseListingUrl(sp.get('url') || '');
      const opts = {
        reviews: sp.get('reviews') !== '0',
        debug: sp.get('debug') === '1',
        locale: sp.get('locale') || 'de-DE',
      };
      const refresh = sp.get('refresh') === '1';
      const asyncMode = sp.get('async') === '1';

      const hit = cache.get(target.id);
      if (!refresh && isFresh(hit) && (!opts.reviews || hit.reviewsIncluded)) {
        return send(res, 200, { ...view(hit, slim), cache: { hit: true, ageSec: ageSec(hit) } }, pretty);
      }
      if (asyncMode) {
        startScrape(target, opts);
        return send(res, 202, { ok: true, status: 'running', id: target.id, pollUrl: `/cached?id=${target.id}&slim=1`, hint: 'Nach ca. 30–60 s unter /cached abrufen' }, pretty);
      }
      const data = await startScrape(target, opts);
      return send(res, 200, { ...view(data, slim), cache: { hit: false } }, pretty);
    }

    // Foto-Analyse: braucht ein vorhandenes Scrape-Ergebnis im Cache
    if (u.pathname === '/analyze-photos') {
      requireAuth(req, u);
      const id = idFrom(sp.get('id') || sp.get('url'));
      const refresh = sp.get('refresh') === '1';
      const asyncMode = sp.get('async') === '1';
      const d = cache.get(id);
      const hit = photoCache.get(id);
      if (!refresh && hit && (!d || hit.sig === photoSig(d))) {
        return send(res, 200, { ...hit, cache: { hit: true } }, pretty);
      }
      if (!d) throw httpError(404, 'Kein Scrape-Ergebnis im Cache. Zuerst /scrape?url=… ausführen.');
      if (!ANTHROPIC_API_KEY) throw httpError(503, 'ANTHROPIC_API_KEY ist in den Railway-Variablen nicht gesetzt');
      if (asyncMode) {
        startPhotos(d);
        return send(res, 202, { ok: true, status: 'running', id, hint: 'Nach ca. 60–120 s erneut unter /analyze-photos?id=… abrufen', lastError: photoErr.get(id) ?? null }, pretty);
      }
      if (photoJobs.has(id) && sp.get('wait') === '0') {
        return send(res, 202, { ok: true, status: 'running', id }, pretty);
      }
      const r = await startPhotos(d);
      return send(res, 200, { ...r, cache: { hit: false } }, pretty);
    }

    send(res, 404, { error: 'Endpunkte: /scrape?url=…[&async=1][&refresh=1][&slim=1], /cached?id=…, /analyze-photos?id=…[&async=1][&refresh=1], /cache, /health' });
  } catch (e) {
    send(res, e.status || 500, { ok: false, error: e.message }, pretty);
  }
});
server.listen(PORT, () => console.log(`listing-audit-scraper läuft auf :${PORT} (Cache ${cache.size} Einträge, Foto-Analysen ${photoCache.size}, TTL ${CACHE_TTL_MS / 60000} min, Bildanalyse ${ANTHROPIC_API_KEY ? 'bereit' : 'KEY FEHLT'})`));
process.on('SIGTERM', async () => { await browser?.close().catch(() => {}); process.exit(0); });
