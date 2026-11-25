// Gastgeber-Grösse: Wie viele Inserate hat der Airbnb-Account hinter dem geprüften Inserat? (AirROI)
// Zählt Inserate, bei denen der Gastgeber Hauptgastgeber ist, plus Inserate, bei denen er als Co-Host steht (Property Manager).
// Gesucht wird im Land des Inserats. Fehler werden geloggt, der Lead läuft dann ohne Grössenangabe weiter.
const KEY = () => process.env.AIRROI_API_KEY || '';
const BASE = () => (process.env.AIRROI_BASE_URL || 'https://api.airroi.com').replace(/\/+$/, '');
const headers = () => ({ 'x-api-key': KEY(), authorization: `Bearer ${KEY()}`, accept: 'application/json', 'content-type': 'application/json' });

async function getListing(id) {
  const u = new URL(BASE() + '/listings'); u.searchParams.set('id', id); u.searchParams.set('currency', 'native');
  const r = await fetch(u, { headers: headers(), signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`AirROI /listings ${r.status}`);
  return r.json();
}
async function countWhere(country, filter) {
  const r = await fetch(BASE() + '/listings/search/market', { method: 'POST', headers: headers(), body: JSON.stringify({ market: { country }, filter, pagination: { page_size: 1, offset: 0 }, currency: 'native' }), signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`AirROI search ${r.status}`);
  const j = await r.json(); return Number(j && j.pagination && j.pagination.total_count) || 0;
}

/** Grössenstufe. Grenzen per LH_TIER_BREAKS ("1,5,20": Solo bis 1, Klein bis 5, Mittel bis 20, darüber Gross). */
export function tierOf(units) {
  if (!Number.isFinite(units) || units < 1) return 'unknown';
  const [a, b, c] = String(process.env.LH_TIER_BREAKS || '1,5,20').split(',').map(Number);
  return units <= a ? 'solo' : units <= b ? 'small' : units <= c ? 'mid' : 'large';
}
export const TIER_TAG = { solo: 'lh-size-solo', small: 'lh-size-small', mid: 'lh-size-mid', large: 'lh-size-large', unknown: 'lh-size-unknown' };

export async function hostSize(listingId) {
  if (!KEY() || !listingId) return null;
  try {
    const me = await getListing(listingId), h = me.host_info || {}, country = (me.location_info || {}).country;
    if (!h.host_id || !country) return { units: null, tier: 'unknown', source: 'airroi' };
    const [asHost, asCohost] = await Promise.all([countWhere(country, { host_id: { eq: h.host_id } }), countWhere(country, { cohost_ids: { any: [h.host_id] } })]);
    const units = Math.max(1, asHost + asCohost);   // das geprüfte Inserat selbst zählt immer
    return { units, asHost, asCohost, tier: tierOf(units), hostId: h.host_id, hostName: h.host_name || null, superhost: !!h.superhost, country, source: 'airroi' };
  } catch (e) { console.error('HOST', listingId, e.message); return null; }
}
