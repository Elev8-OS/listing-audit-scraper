// Meta Conversions API (serverseitig). Läuft nur, wenn META_PIXEL_ID und META_CAPI_TOKEN in Railway gesetzt sind
// UND der Besucher dem Meta Pixel zugestimmt hat (Flag kommt vom Browser). Fehler werden geloggt und blockieren nie.
import crypto from 'node:crypto';

const PIXEL = () => String(process.env.META_PIXEL_ID || '').replace(/\D/g, '');
const TOKEN = () => String(process.env.META_CAPI_TOKEN || '').trim();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const FB = { fbp: /^fb\.\d\.\d{10,14}\.\d{5,20}$/, fbc: /^fb\.\d\.\d{10,14}\.[\w-]{5,200}$/ };

export const capiEnabled = () => !!(PIXEL() && TOKEN());

/** Meta-Name je Ereignis des Funnels. Lead kommt aus der Lead-Verarbeitung (mit gehashter E-Mail), nicht aus 'unlocked'. */
export const META_EVENT = { scan_start: 'AuditStart', gate_view: 'ViewContent', page_cta_click: 'Schedule' };

/** o: { name, sid, url, ip, ua, fb: {fbp, fbc}, email?, phone?, custom? } */
export async function sendCapi(o) {
  if (!capiEnabled() || !o || !o.name) return;
  try {
    const fb = o.fb || {}, ud = {};
    if (o.ip) ud.client_ip_address = String(o.ip).slice(0, 64);
    if (o.ua) ud.client_user_agent = String(o.ua).slice(0, 400);
    if (FB.fbp.test(fb.fbp || '')) ud.fbp = fb.fbp;
    if (FB.fbc.test(fb.fbc || '')) ud.fbc = fb.fbc;
    if (o.sid) ud.external_id = [sha(String(o.sid))];
    const mail = String(o.email || '').trim().toLowerCase(); if (mail) ud.em = [sha(mail)];
    let ph = String(o.phone || '').replace(/\D/g, '').replace(/^00/, ''); if (ph.length >= 8) ud.ph = [sha(ph)];
    const ev = { event_name: o.name, event_time: Math.floor(Date.now() / 1000), event_id: `${o.sid || 'x'}:${o.name}`, action_source: 'website', event_source_url: o.url, user_data: ud };
    if (o.custom) ev.custom_data = o.custom;
    const payload = { data: [ev] };
    if (process.env.META_TEST_EVENT_CODE) payload.test_event_code = String(process.env.META_TEST_EVENT_CODE);
    const r = await fetch(`${process.env.META_GRAPH_URL || 'https://graph.facebook.com'}/v21.0/${PIXEL()}/events?access_token=${encodeURIComponent(TOKEN())}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
    if (!r.ok) console.error('CAPI', o.name, r.status, (await r.text().catch(() => '')).slice(0, 200));
  } catch (e) { console.error('CAPI', o && o.name, e.message); }
}
