// GHL (LeadConnector): Kontakt anlegen (E-Mail und/oder Telefon), Notiz speichern, E-Mail senden.
const TOKEN = () => process.env.GHL_TOKEN || '';
const LOC = () => process.env.GHL_LOCATION_ID || 'y8KriiXCFqwv3Cax6IC6';
const API = () => (process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com').replace(/\/+$/, '');
export const ghlReady = () => !!TOKEN();
async function call(method, p, body, version) {
  const r = await fetch(API() + p, { method, headers: { Authorization: `Bearer ${TOKEN()}`, Version: version || '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(`GHL ${r.status} ${p}: ${(j && (j.message || j.error)) || t.slice(0, 160)}`);
  return j || {};
}
/** GHL_CF_MAP (JSON): ordnet Werten die Feld-IDs aus GHL zu, z. B. {"units":"abc123","tier":"def456","pdf":"ghi789"}. Ohne Map werden nur Tags und Notiz gesetzt. */
function customFields(values) {
  let map = {}; try { map = JSON.parse(process.env.GHL_CF_MAP || '{}') || {}; } catch { }
  return Object.entries(values || {}).filter(([k, v]) => map[k] && v != null && v !== '').map(([k, v]) => ({ id: map[k], field_value: String(v) }));
}
export async function upsertContact({ email, phone, name, tags, source, fields }) {
  const cf = customFields(fields);
  const j = await call('POST', '/contacts/upsert', { locationId: LOC(), ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(name ? { name } : {}), source, tags, ...(cf.length ? { customFields: cf } : {}) });
  const c = j.contact || j; if (!c.id) throw new Error('GHL: keine Kontakt-ID erhalten');
  return { id: c.id, isNew: !!j.new };
}
export const addNote = (contactId, body) => call('POST', `/contacts/${contactId}/notes`, { body });
export const sendEmail = ({ contactId, subject, html, attachments }) => call('POST', '/conversations/messages', { type: 'Email', contactId, subject, html, ...(process.env.GHL_EMAIL_FROM ? { emailFrom: process.env.GHL_EMAIL_FROM } : {}), ...(attachments && attachments.length ? { attachments } : {}) }, '2021-04-15');
