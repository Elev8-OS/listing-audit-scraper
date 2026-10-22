// Lead-Gate: Ereignisse, Lead-Verarbeitung (PDF + GHL-E-Mail), PDF-Auslieferung, Klick-Weiterleitung, Statistik.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { renderPdf } from './pdf.js';
import * as ghl from './ghl.js';

const EVENTS = new Set(['scan_start', 'scan_done', 'scan_error', 'gate_view', 'gate_locked_click', 'gate_submit', 'gate_error', 'unlocked', 'print_blocked', 'page_cta_click']);
const gradeOf = (s) => (s >= 92 ? 'A' : s >= 88 ? 'A–' : s >= 84 ? 'B+' : s >= 78 ? 'B' : s >= 72 ? 'B–' : s >= 66 ? 'C+' : s >= 60 ? 'C' : s >= 50 ? 'D' : 'F');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const first = (t, n) => { t = String(t || '').split(/(?<=[.!?])\s/)[0]; return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; };

export function createLeads(c) {
  const { DATA_DIR, API_KEY, PORT, json, limited, ipOf, body, cachedReport } = c;
  const dir = (...p) => path.join(DATA_DIR, ...p);
  const append = (f, o) => { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.appendFileSync(dir(f), JSON.stringify(o) + '\n'); } catch (e) { console.error('SPEICHERN', f, e.message); } };
  const lines = (f) => { try { return fs.readFileSync(dir(f), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
  const sign = (id) => crypto.createHmac('sha256', API_KEY || 'x').update(id).digest('hex').slice(0, 16);
  const base = (req) => (process.env.PUBLIC_BASE_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/+$/, '');
  const ev = (e, o = {}) => append('events.jsonl', { t: new Date().toISOString(), e, ...o });
  const authed = (req) => !!API_KEY && (req.headers.authorization || '') === `Bearer ${API_KEY}`;
  const bookingUrl = (src) => { try { const u = new URL(process.env.BOOKING_URL || 'https://elev8-suite.com'); u.searchParams.set('utm_source', 'listing-health'); u.searchParams.set('utm_medium', src); return u.toString(); } catch { return 'https://elev8-suite.com'; } };

  async function event(req, res) {
    if (limited('ev:' + ipOf(req), 300, 3600e3)) return json(res, 429, { ok: false });
    let p; try { p = JSON.parse(await body(req, 2048)); } catch { return json(res, 400, { ok: false }); }
    if (!EVENTS.has(p.e)) return json(res, 400, { ok: false });
    ev(p.e, { sid: String(p.sid || '').slice(0, 24), id: String(p.id || '').replace(/\D/g, '').slice(0, 24) || undefined, score: Number.isFinite(p.score) ? p.score : undefined, zone: p.zone ? String(p.zone).slice(0, 24) : undefined, lang: p.lang === 'en' ? 'en' : 'de' });
    return json(res, 200, { ok: true });
  }

  function mailHtml(rec, rep, score, grade, urls, pdfOk) {
    const en = rec.lang === 'en', name = (rep && rep.listing && rep.listing.name) || rec.listing || '', worst = ((rep && rep.cats) || []).filter((x) => x.base != null).sort((a, b) => a.base - b.base).slice(0, 3);
    const btn = (href, label, dark) => `<a href="${esc(href)}" style="display:inline-block;background:${dark ? '#0A0A0A' : '#F6BB12'};color:${dark ? '#fff' : '#0A0A0A'};font-weight:700;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:15px">${esc(label)}</a>`;
    const T = en
      ? { hi: 'Hi,', l1: `your report for <b>${esc(name)}</b> is ready: <b>${score}/100</b>, grade <b>${esc(grade)}</b>.`, f: 'This stands out first:', p: 'Open the PDF report', pn: 'The PDF has the action plan with ready-made copy, the photo order and the market comparison.', nopdf: 'The PDF is still being prepared. We will send it as soon as it is ready.', c: 'Want us to go through the plan with you? 30 minutes, no strings attached.', b: 'Book a demo call', s: 'Elev8' }
      : { hi: 'Hallo,', l1: `dein Report für <b>${esc(name)}</b> ist da: <b>${score}/100</b>, Note <b>${esc(grade)}</b>.`, f: 'Das fällt zuerst auf:', p: 'PDF-Report öffnen', pn: 'Im PDF: Maßnahmenplan mit fertigen Texten, Foto-Reihenfolge und Marktvergleich.', nopdf: 'Das PDF wird noch vorbereitet. Wir schicken es dir, sobald es fertig ist.', c: 'Sollen wir den Plan mit dir durchgehen? 30 Minuten, unverbindlich.', b: 'Demo-Call buchen', s: 'Elev8' };
    return `<div style="font-family:Inter,Helvetica,Arial,sans-serif;color:#0A0A0A;font-size:15px;line-height:1.55;max-width:560px"><p>${T.hi}</p><p>${T.l1}</p>${worst.length ? `<p style="margin-bottom:4px"><b>${T.f}</b></p><ul style="margin:0 0 16px;padding-left:18px">${worst.map((x) => `<li>${esc(x.name)} (${esc(gradeOf(x.base))}): ${esc(first(x.finding, 110))}</li>`).join('')}</ul>` : ''}${pdfOk ? `<p style="margin:18px 0 6px">${btn(urls.pdf, T.p)}</p><p style="color:#4B4B47;font-size:13px">${T.pn}</p>` : `<p style="color:#4B4B47">${T.nopdf}</p>`}<p style="margin-top:22px">${T.c}</p><p>${btn(urls.go, T.b, true)}</p><p style="color:#85857F;font-size:13px;margin-top:24px">${T.s}</p></div>`;
  }

  async function deliver(rec, b) {
    const rep = rec.listingId ? cachedReport(`${rec.listingId}:${rec.lang}`) : null, cs = ((rep && rep.cats) || []).filter((x) => x.base != null), score = cs.length ? Math.round(cs.reduce((t, x) => t + x.base * x.w, 0)) : null, grade = score != null ? gradeOf(score) : '–';
    const file = dir('pdf', `${rec.id}.pdf`), urls = { pdf: `${b}/r/${rec.token}.pdf`, go: `${b}/go/${rec.token}` };
    let pdfOk = false;
    if (rec.listingId) {
      try { fs.mkdirSync(dir('pdf'), { recursive: true }); await renderPdf({ origin: `http://127.0.0.1:${PORT}`, base: b, url: `https://www.airbnb.de/rooms/${rec.listingId}`, lang: rec.lang, token: rec.token, out: file }); pdfOk = fs.existsSync(file); ev('pdf_ready', { sid: rec.id }); }
      catch (e) { ev('pdf_failed', { sid: rec.id }); console.error('PDF', rec.id, e.message); }
    }
    if (!ghl.ghlReady()) { ev('mail_skipped', { sid: rec.id }); console.log('GHL nicht konfiguriert (GHL_TOKEN fehlt): keine E-Mail gesendet an', rec.id); return; }
    try {
      const safe = String(grade).replace('+', 'p').replace('–', 'm').toLowerCase(), contact = await ghl.upsertContact({ email: rec.email, name: rec.name, source: 'Listing Health', tags: ['listing-health', `lh-note-${safe}`, `lh-${rec.lang}`, ...(pdfOk ? [] : ['lh-pdf-fehlt'])] });
      const note = `Listing Health\nInserat: https://www.airbnb.de/rooms/${rec.listingId}\nScore: ${score ?? '–'} (${grade})\nSprache: ${rec.lang}\nSchwächste Bereiche: ${cs.slice().sort((a, x) => a.base - x.base).slice(0, 3).map((x) => `${x.name} ${x.base}`).join(', ')}\nGeöffnet vor dem Gate: ${(rec.openedAreas || []).join(', ') || '–'}\nPDF: ${pdfOk ? urls.pdf : 'nicht erzeugt'}`;
      await ghl.addNote(contact.id, note).catch((e) => console.error('GHL-Notiz', e.message));
      const subject = rec.lang === 'en' ? `Your Listing Health report: ${(rep && rep.listing && rep.listing.name) || ''} (grade ${grade})` : `Dein Listing-Health-Report: ${(rep && rep.listing && rep.listing.name) || ''} (Note ${grade})`, html = mailHtml(rec, rep, score ?? '–', grade, urls, pdfOk);
      try { await ghl.sendEmail({ contactId: contact.id, subject, html, attachments: pdfOk ? [urls.pdf] : [] }); }
      catch (e) { if (!pdfOk) throw e; console.error('GHL-Anhang abgelehnt, sende ohne Anhang:', e.message); await ghl.sendEmail({ contactId: contact.id, subject, html }); }
      ev('mail_sent', { sid: rec.id, pdf: pdfOk });
    } catch (e) { ev('mail_failed', { sid: rec.id }); console.error('GHL', rec.id, e.message); }
  }

  async function lead(req, res) {
    if (limited('lead:' + ipOf(req), 5, 3600e3)) return json(res, 429, { ok: false, error: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
    let p; try { p = JSON.parse(await body(req, 16384)); } catch (e) { return json(res, e.status || 400, { ok: false, error: 'Ungültige Anfrage' }); }
    const email = String(p.email || '').trim(), consent = p.consent && p.consent.given === true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !consent) return json(res, 422, { ok: false, error: 'E-Mail oder Einwilligung fehlt' });
    const r = p.report || {}, id = crypto.randomBytes(5).toString('hex');
    const rec = { id, token: `${id}.${sign(id)}`, receivedAt: new Date().toISOString(), name: String(p.name || '').slice(0, 120), email: email.slice(0, 200), phone: String(p.phone || '').slice(0, 40), consent: p.consent, listing: p.listing || null, listingId: String(r.id || '').replace(/\D/g, '').slice(0, 24), lang: r.lang === 'en' || p.lang === 'en' ? 'en' : 'de', score: p.score || null, view: p.view || null, topFindings: (p.topFindings || []).slice(0, 5), openedAreas: (p.openedAreas || []).slice(0, 40), gate: !!p.gate, sid: String(p.sid || '').slice(0, 24), source: 'listing-health' };
    append('leads.jsonl', rec); console.log('LEAD', JSON.stringify(rec)); ev('lead_saved', { sid: rec.sid || rec.id, id: rec.listingId, lang: rec.lang });
    const hook = process.env.LEAD_WEBHOOK_URL;
    if (hook) { try { const w = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rec), signal: AbortSignal.timeout(8000) }); if (!w.ok) throw new Error('Webhook ' + w.status); } catch (e) { console.error('LEAD-Webhook fehlgeschlagen', e.message); } }
    json(res, 200, { ok: true, token: rec.token });
    deliver(rec, base(req)).catch((e) => console.error('LEAD-LIEFERUNG', e.message));
  }

  const parse = (name) => { const m = String(name).match(/^([a-f0-9]{10})\.([a-f0-9]{16})/); return m && sign(m[1]) === m[2] ? m[1] : null; };
  function pdf(req, res, name) {
    const id = parse(name), f = id && dir('pdf', `${id}.pdf`);
    if (!id || !fs.existsSync(f)) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Nicht gefunden'); }
    ev('pdf_open', { sid: id }); res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="Elev8-Listing-Health-Report.pdf"', 'cache-control': 'private, max-age=3600' }); fs.createReadStream(f).pipe(res);
  }
  function go(req, res, name) {
    const id = parse(name); if (id) ev('go_click', { sid: id });
    res.writeHead(302, { location: bookingUrl(id ? 'report' : 'link'), 'cache-control': 'no-store' }); res.end();
  }
  async function pdfTest(req, res, u) {
    if (!authed(req)) return json(res, 401, { ok: false, error: 'Nicht erlaubt' });
    const m = String(u.searchParams.get('url') || '').match(/rooms\/(\d{6,})/), lang = u.searchParams.get('lang') === 'en' ? 'en' : 'de'; if (!m) return json(res, 400, { ok: false, error: 'Link fehlt' });
    const f = dir('pdf', `test-${m[1]}.pdf`); try { fs.mkdirSync(dir('pdf'), { recursive: true }); await renderPdf({ origin: `http://127.0.0.1:${PORT}`, url: `https://www.airbnb.de/rooms/${m[1]}`, lang, token: '', out: f }); } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
    res.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(res);
  }
  function stats(req, res, u) {
    if (!authed(req)) return json(res, 401, { ok: false, error: 'Nicht erlaubt' });
    const days = Math.min(365, Math.max(1, Number(u.searchParams.get('days')) || 30)), since = Date.now() - days * 864e5, E = lines('events.jsonl').filter((x) => Date.parse(x.t) >= since), L = lines('leads.jsonl').filter((x) => Date.parse(x.receivedAt) >= since);
    const names = ['scan_start', 'scan_done', 'scan_error', 'gate_view', 'gate_locked_click', 'gate_submit', 'lead_saved', 'unlocked', 'pdf_ready', 'pdf_failed', 'mail_sent', 'mail_failed', 'mail_skipped', 'pdf_open', 'go_click', 'page_cta_click', 'print_blocked'];
    const funnel = {}; for (const n of names) { const s = E.filter((x) => x.e === n); funnel[n] = { n: s.length, u: new Set(s.map((x) => x.sid || x.id || x.t)).size }; }
    const r = (a, b) => (funnel[b] && funnel[b].u ? Math.round((funnel[a].u / funnel[b].u) * 1000) / 10 : null);
    const zones = {}; E.filter((x) => x.e === 'gate_locked_click').forEach((x) => { zones[x.zone || '?'] = (zones[x.zone || '?'] || 0) + 1; });
    const byDay = {}; E.forEach((x) => { const d = x.t.slice(0, 10); (byDay[d] = byDay[d] || {})[x.e] = (byDay[d][x.e] || 0) + 1; });
    const sc = E.filter((x) => x.e === 'scan_done' && Number.isFinite(x.score)).map((x) => x.score);
    return json(res, 200, { ok: true, days, funnel, rates_percent: { scan_done_per_start: r('scan_done', 'scan_start'), gate_view_per_scan_done: r('gate_view', 'scan_done'), submit_per_gate_view: r('gate_submit', 'gate_view'), mail_sent_per_lead: r('mail_sent', 'lead_saved'), pdf_open_per_mail: r('pdf_open', 'mail_sent'), go_click_per_mail: r('go_click', 'mail_sent') }, locked_clicks_by_zone: zones, avg_score: sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : null, by_day: byDay, leads: L.slice(-20).reverse().map((x) => ({ at: x.receivedAt, listingId: x.listingId, lang: x.lang, opened: x.openedAreas, id: x.id })) });
  }
  return { event, lead, pdf, go, pdfTest, stats };
}
