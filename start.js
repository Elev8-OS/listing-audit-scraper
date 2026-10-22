// Startet den Scraper unverändert und ergänzt: Konsole (/ui), Listing-Health-Seite (/),
// Lead-Eingang (/api/lead) und den Foto-Check für die Seite (/api/photo-check).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { salvageJson } from './report.js';
import { generateReportV2 } from './engine.js';
import { marketFor } from './market.js';

// Der Scraper setzt max_tokens fest auf 8000. Mit Nachdenken wird die Foto-Antwort dann abgeschnitten.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  try {
    const u = typeof input === 'string' ? input : (input && input.url) || '';
    if (u.startsWith('https://api.anthropic.com/v1/messages') && init && typeof init.body === 'string') {
      const b = JSON.parse(init.body);
      if (b.max_tokens && b.max_tokens < 12000) { b.max_tokens = 12000; init = { ...init, body: JSON.stringify(b) }; }
    }
  } catch {}
  return realFetch(input, init);
};

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.API_KEY || '';
const DATA_DIR = process.env.DATA_DIR || '/tmp/listing-audit-cache';
const LEAD_WEBHOOK_URL = process.env.LEAD_WEBHOOK_URL || '';
const PUBLIC_ANALYZE = process.env.PUBLIC_ANALYZE !== '0';           // beliebige Links öffentlich prüfen (Standard: an, PUBLIC_ANALYZE=0 schließt)
const ALLOWED_IDS = new Set((process.env.ALLOWED_IDS || '1175211811818785379').split(',').map((s) => s.trim()).filter(Boolean));
const DAILY_LIMIT = Number(process.env.PUBLIC_DAILY_LIMIT || 20);   // neue Analysen pro Tag
const IP_LIMIT = Number(process.env.PUBLIC_IP_LIMIT || 3);          // neue Analysen pro IP und Woche
const IP_WINDOW = Number(process.env.IP_WINDOW_H || 168) * 3600e3;
const read = (f) => { try { return fs.readFileSync(new URL(f, import.meta.url), 'utf8'); } catch { return null; } };
const uiHtml = read('./ui.html') || '';
const liveJs = (f) => read('./' + f) || '';
const injectLive = (h) => (h.includes('/live.js') ? h : h.replace('</body>', '<script src="/live.js"></script><script src="/live2.js"></script></body>'));
const pageHtml = () => injectLive(read('./public/index.html') || '<!doctype html><meta charset="utf-8"><title>Listing Health</title><p style="font:16px system-ui;padding:40px">Die Seite ist noch nicht hochgeladen (public/index.html fehlt).</p>');

/* ---- Hilfen ---- */
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim();
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now(), arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return true; }
  arr.push(now); buckets.set(key, arr); return false;
}
async function body(req, max = 8192) {
  let n = 0; const chunks = [];
  for await (const c of req) { n += c.length; if (n > max) throw Object.assign(new Error('Anfrage zu groß'), { status: 413 }); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}
const local = async (p) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { headers: { authorization: `Bearer ${API_KEY}` } });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (u) => String(u || '').split('?')[0];

/* ---- Foto-Analyse absichern: abgeschnittene Antworten retten, Gesamtnote ergänzen ---- */
const q4 = (p) => (p.brightness + p.sharpness + p.composition + p.tidiness) / 4;
function completeAnalysis(a) {
  const ph = Array.isArray(a.photos) ? a.photos : [], ok = ph.filter((p) => [p.brightness, p.sharpness, p.composition, p.tidiness].every(Number.isFinite));
  if (!a.overall && ok.length) {
    const avg = ok.reduce((s, p) => s + q4(p), 0) / ok.length, score = Math.round(avg * 20), grade = score >= 85 ? 'A' : score >= 75 ? 'B' : score >= 65 ? 'C' : score >= 55 ? 'D' : score >= 45 ? 'E' : 'F';
    const weak = ph.filter((p) => p.keep === false).map((p) => p.position), fixes = [];
    if (a.cover && a.cover.betterPosition && a.cover.betterPosition !== a.cover.position) fixes.push(`Titelbild wechseln: Foto ${a.cover.betterPosition} statt Foto ${a.cover.position}`);
    if (weak.length) fixes.push(`${weak.length} schwache Fotos ersetzen oder streichen (Fotos ${weak.join(', ')})`);
    const cnt = {}; ph.forEach((p) => (p.issues || []).forEach((i) => { const k = String(i).trim(); cnt[k] = (cnt[k] || 0) + 1; }));
    const top = Object.entries(cnt).sort((x, y) => y[1] - x[1])[0]; if (top && top[1] >= 3) fixes.push(`Wiederkehrendes Problem beheben: ${top[0]} (${top[1]} Fotos)`);
    const few = (a.roomCoverage || []).filter((r) => r.verdict === 'zu wenig').map((r) => r.room); if (few.length) fixes.push(`Mehr Fotos von: ${few.join(', ')}`);
    a.overall = { score, grade, summary: `Ø Bildqualität ${avg.toFixed(1)} von 5. ${weak.length} von ${ph.length} Fotos sollten ersetzt oder gestrichen werden.`, topFixes: fixes.slice(0, 4) };
    a.partial = true;
  }
  if (!Array.isArray(a.missingMotifs)) a.missingMotifs = [];
  return a;
}
function getAnalysis(j) {
  if (!j) return null;
  const a = j.analysis || salvageJson(j.raw);
  return a && Array.isArray(a.photos) && a.photos.length ? completeAnalysis(a) : null;
}

/* ---- Lead-Eingang ---- */
async function handleLead(req, res) {
  if (limited('lead:' + ipOf(req), 5, 3600e3)) return json(res, 429, { ok: false, error: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
  let p; try { p = JSON.parse(await body(req)); } catch (e) { return json(res, e.status || 400, { ok: false, error: 'Ungültige Anfrage' }); }
  const email = String(p.email || '').trim(), consent = p.consent && p.consent.given === true;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !consent) return json(res, 422, { ok: false, error: 'E-Mail oder Einwilligung fehlt' });
  const lead = { receivedAt: new Date().toISOString(), name: String(p.name || '').slice(0, 120), email: email.slice(0, 200), phone: String(p.phone || '').slice(0, 40), consent: p.consent, listing: p.listing || null, score: p.score || null, view: p.view || null, lang: p.lang || null, topFindings: (p.topFindings || []).slice(0, 5), openedAreas: (p.openedAreas || []).slice(0, 40), source: 'listing-health' };
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.appendFileSync(path.join(DATA_DIR, 'leads.jsonl'), JSON.stringify(lead) + '\n'); } catch (e) { console.error('LEAD speichern fehlgeschlagen', e.message); }
  console.log('LEAD', JSON.stringify(lead));
  if (LEAD_WEBHOOK_URL) {
    try { const r = await fetch(LEAD_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(lead), signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error('Webhook ' + r.status); }
    catch (e) { console.error('LEAD-Webhook fehlgeschlagen', e.message); }
  }
  return json(res, 200, { ok: true });
}

/* ---- Foto-Check: Scrape + Foto-Analyse für die Seite ---- */
const jobs = new Map(); // id -> { status, step, error, startedAt }
const dayKey = () => new Date().toISOString().slice(0, 10);
async function steps(id, url, j) {
    j.step = 'scrape';
    const have = await local(`/cached?id=${id}&slim=1`);
    if (have.status !== 200) {
      const s = await local(`/scrape?async=1&slim=1&url=${encodeURIComponent(url)}`);
      if (s.status >= 400) throw new Error((s.json && s.json.error) || 'Scrape fehlgeschlagen');
      let ok = false;
      for (let i = 0; i < 70 && !ok; i++) { await sleep(5000); const c = await local(`/cached?id=${id}&slim=1`); if (c.status === 200) ok = true; else if (c.status === 404 && c.json && c.json.lastError) throw new Error('Das Inserat konnte nicht gelesen werden'); }
      if (!ok) throw new Error('Das Lesen des Inserats dauert zu lange');
    }
    j.step = 'photos';
    let done = false, refreshed = false;
    for (let i = 0; i < 90 && !done; i++) {
      const r = await local(`/analyze-photos?id=${id}&async=1`);
      if (r.status === 200) { if (getAnalysis(r.json)) done = true; else if (!refreshed) { refreshed = true; await local(`/analyze-photos?id=${id}&async=1&refresh=1`); await sleep(6000); } else throw new Error('Foto-Analyse fehlgeschlagen'); }
      else if (r.status >= 400) throw new Error((r.json && r.json.error) || 'Foto-Analyse fehlgeschlagen');
      else if (r.json && r.json.lastError) throw new Error('Foto-Analyse fehlgeschlagen');
      else await sleep(6000);
    }
    if (!done) throw new Error('Die Foto-Analyse dauert zu lange');
}
async function pipeline(id, url) {
  const j = jobs.get(id);
  try { await steps(id, url, j); j.status = 'done'; } catch (e) { j.status = 'error'; j.error = e.message; }
}

/* ---- Befund-Motor: kompletter Report für die Seite ---- */
const reports = new Map(); // id:lang -> { at, report }
const repFile = (k) => path.join(DATA_DIR, `report-${k.replace(':', '-')}.json`);
function cachedReport(k) {
  const m = reports.get(k); if (m && Date.now() - m.at < 864e5) return m.report;
  try { const f = repFile(k), st = fs.statSync(f); if (Date.now() - st.mtimeMs < 864e5) { const r = JSON.parse(fs.readFileSync(f, 'utf8')); reports.set(k, { at: st.mtimeMs, report: r }); return r; } } catch {}
  return null;
}
async function runReport(id, url, lang, j) {
  try {
    if (j.step !== 'report') await steps(id, url, j);
    j.step = 'report';
    const [full, pc, mk] = await Promise.all([local(`/cached?id=${id}`), result(id), marketFor(id).catch((e) => { console.error('MARKT', id, e.message); return null; })]);
    if (full.status !== 200) throw new Error('Das Inserat konnte nicht gelesen werden');
    const rep = await generateReportV2(full.json, pc ? { analysis: pc.analysis } : null, lang, process.env.ANTHROPIC_API_KEY || '');
    rep.market = mk || null;
    const k = `${id}:${lang}`; reports.set(k, { at: Date.now(), report: rep });
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(repFile(k), JSON.stringify(rep)); } catch {}
    j.status = 'done';
  } catch (e) { console.error('REPORT', id, e.message); j.status = 'error'; j.error = e.message; }
}
async function handleReport(req, res, u) {
  if (!API_KEY) return json(res, 503, { ok: false, error: 'Dienst nicht konfiguriert' });
  const url = u.searchParams.get('url') || '', lang = u.searchParams.get('lang') === 'en' ? 'en' : 'de', m = url.match(/^https?:\/\/(?:www\.)?airbnb\.[a-z.]+\/rooms\/(\d{6,})/i);
  if (!m) return json(res, 400, { ok: false, error: 'Bitte einen Airbnb-Link im Format airbnb.de/rooms/… eingeben.' });
  const id = m[1], k = `${id}:${lang}`, ready = cachedReport(k);
  if (ready) { const pc = await result(id); if (pc) return json(res, 200, { ok: true, status: 'done', id, report: ready, photoCheck: pc }); }
  if (!(PUBLIC_ANALYZE || ALLOWED_IDS.has(id))) return json(res, 403, { ok: false, status: 'closed', error: 'Der Foto-Check für eigene Links ist in dieser Version noch geschlossen. Buche einen Demo-Call, dann prüfen wir dein Inserat.' });
  let j = jobs.get(`${k}`);
  if (j && j.status === 'error' && Date.now() - j.startedAt > 60e3) { jobs.delete(k); j = null; }
  if (!j) {
    const known = !!(await result(id));          // Scrape und Foto-Analyse schon vorhanden: nur der Befund fehlt, zählt nicht gegen das Limit
    if (!known && (limited('ip:' + ipOf(req), IP_LIMIT, IP_WINDOW) || limited('day:' + dayKey(), DAILY_LIMIT, 864e5))) return json(res, 429, { ok: false, status: 'limit', error: 'Du hast diese Woche schon drei Analysen genutzt, oder heute sind alle vergeben. Buche einen Demo-Call, dann prüfen wir dein Inserat.' });
    j = { status: 'running', step: known ? 'report' : 'scrape', startedAt: Date.now() }; jobs.set(k, j); runReport(id, `https://www.airbnb.de/rooms/${id}`, lang, j);
  }
  if (j.status === 'done') { const pc = await result(id), rp = cachedReport(k); if (pc && rp) return json(res, 200, { ok: true, status: 'done', id, report: rp, photoCheck: pc }); }
  if (j.status === 'error') return json(res, 502, { ok: false, status: 'error', id, error: j.error });
  return json(res, 202, { ok: true, status: 'running', step: j.step, id });
}
async function result(id) {
  const [d, a] = await Promise.all([local(`/cached?id=${id}&slim=1`), local(`/analyze-photos?id=${id}`)]);
  const analysis = a.status === 200 ? getAnalysis(a.json) : null;
  if (d.status !== 200 || !analysis) return null;
  const photos = (d.json.photos || []).map((p) => ({ position: p.position, caption: p.caption || null, thumb: `${strip(p.url)}?im_w=480`, full: `${strip(p.url)}?im_w=1200` }));
  return { title: d.json.title || null, rating: d.json.rating ?? null, reviewCount: d.json.reviewCount ?? null, photoCount: photos.length, photos, analyzedAt: a.json.analyzedAt, coverUrl: a.json.coverUrl || null, analysis };
}
async function handlePhotoCheck(req, res, u) {
  if (!API_KEY) return json(res, 503, { ok: false, error: 'Dienst nicht konfiguriert' });
  const url = u.searchParams.get('url') || '', m = url.match(/^https?:\/\/(?:www\.)?airbnb\.[a-z.]+\/rooms\/(\d{6,})/i);
  if (!m) return json(res, 400, { ok: false, error: 'Bitte einen Airbnb-Link im Format airbnb.de/rooms/… eingeben.' });
  const id = m[1], allowed = PUBLIC_ANALYZE || ALLOWED_IDS.has(id);
  const ready = await result(id);                       // Zwischengespeichertes liefern wir immer
  if (ready) return json(res, 200, { ok: true, status: 'done', id, ...ready });
  if (!allowed) return json(res, 403, { ok: false, status: 'closed', error: 'Der Foto-Check für eigene Links ist in dieser Version noch geschlossen. Buche einen Demo-Call, dann prüfen wir dein Inserat.' });
  let j = jobs.get(id);
  if (j && j.status === 'error' && Date.now() - j.startedAt > 60e3) { jobs.delete(id); j = null; }
  if (!j) {
    if (limited('ip:' + ipOf(req), IP_LIMIT, IP_WINDOW) || limited('day:' + dayKey(), DAILY_LIMIT, 864e5)) return json(res, 429, { ok: false, status: 'limit', error: 'Du hast diese Woche schon drei Analysen genutzt, oder heute sind alle vergeben. Buche einen Demo-Call, dann prüfen wir dein Inserat.' });
    j = { status: 'running', step: 'scrape', startedAt: Date.now() }; jobs.set(id, j); pipeline(id, `https://www.airbnb.de/rooms/${id}`);
  }
  if (j.status === 'done') { const r2 = await result(id); if (r2) return json(res, 200, { ok: true, status: 'done', id, ...r2 }); }
  if (j.status === 'error') return json(res, 502, { ok: false, status: 'error', id, error: j.error });
  return json(res, 202, { ok: true, status: 'running', step: j.step, id });
}

/* ---- Weiche vor dem Scraper ---- */
const orig = http.createServer.bind(http);
http.createServer = (...args) => {
  const handler = args.pop();
  return orig(...args, async (req, res) => {
    try {
      const u = new URL(req.url || '/', 'http://localhost'), p = u.pathname;
      if (req.method === 'GET' && p === '/ui') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }); return res.end(uiHtml); }
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }); return res.end(pageHtml()); }
      if (req.method === 'POST' && p === '/api/lead') return await handleLead(req, res);
      if (req.method === 'GET' && p === '/api/photo-check') return await handlePhotoCheck(req, res, u);
      if (req.method === 'GET' && p === '/api/report') return await handleReport(req, res, u);
      if (req.method === 'GET' && (p === '/live.js' || p === '/live2.js')) { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' }); return res.end(liveJs(p.slice(1))); }
    } catch (e) { return json(res, 500, { ok: false, error: 'Interner Fehler' }); }
    return handler(req, res);
  });
};
await import('./server.js');
