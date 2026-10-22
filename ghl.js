// GHL (LeadConnector): Kontakt anlegen, Notiz speichern, E-Mail senden.
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
export async function upsertContact({ email, name, tags, source }) {
  const j = await call('POST', '/contacts/upsert', { locationId: LOC(), email, ...(name ? { name } : {}), source, tags });
  const c = j.contact || j; if (!c.id) throw new Error('GHL: keine Kontakt-ID erhalten');
  return { id: c.id, isNew: !!j.new };
}
export const addNote = (contactId, body) => call('POST', `/contacts/${contactId}/notes`, { body });
export const sendEmail = ({ contactId, subject, html, attachments }) => call('POST', '/conversations/messages', { type: 'Email', contactId, subject, html, ...(process.env.GHL_EMAIL_FROM ? { emailFrom: process.env.GHL_EMAIL_FROM } : {}), ...(attachments && attachments.length ? { attachments } : {}) }, '2021-04-15');
