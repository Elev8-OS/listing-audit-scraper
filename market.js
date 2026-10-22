// Marktdaten nur aus Airbnb (AirROI): Vergleichsinserate, Preis, Belegung, Umsatz der letzten 12 Monate.
const KEY = process.env.AIRROI_API_KEY || '';
const BASE = (process.env.AIRROI_BASE_URL || 'https://api.airroi.com').replace(/\/+$/, '');
async function get(p, q) {
  const u = new URL(BASE + p); Object.entries(q).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  const r = await fetch(u, { headers: { 'x-api-key': KEY, authorization: `Bearer ${KEY}`, accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`AirROI ${r.status}`);
  return r.json();
}
const pm = (x) => x.performance_metrics || {};
const qt = (arr, p) => { const a = arr.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return null; const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); };
const dist = (arr) => ({ p25: qt(arr, .25), p50: qt(arr, .5), p75: qt(arr, .75), p90: qt(arr, .9) });
const rankOf = (arr, v) => { const a = arr.filter(Number.isFinite); return a.length && Number.isFinite(v) ? Math.round(a.filter((x) => x < v).length / a.length * 100) : null; };
const card = (x) => {
  const m = pm(x), b = x.booking_settings || {}, r = x.ratings || {}, d = x.property_details || {};
  return { name: (x.listing_info || {}).listing_name || null, rev: m.ttm_revenue ?? null, adr: m.ttm_avg_rate ?? null, occ: m.ttm_occupancy ?? null, minNights: b.min_nights ?? null, policy: b.cancellation_policy || null, cleaning: (x.pricing_info || {}).cleaning_fee ?? null, gf: !!(x.listing_info || {}).guest_favorite, superhost: !!(x.host_info || {}).superhost, rating: r.rating_overall ?? null, reviews: r.num_reviews ?? null, guests: d.guests ?? null, bedrooms: d.bedrooms ?? null, amenities: (d.amenities || []).length };
};
export async function marketFor(id) {
  if (!KEY) return null;
  const me = await get('/listings', { id, currency: 'native' }), loc = me.location_info || {}, pd = me.property_details || {};
  if (!Number.isFinite(loc.latitude) || !pd.guests) return null;
  const cj = await get('/listings/comparables', { latitude: loc.latitude, longitude: loc.longitude, bedrooms: pd.bedrooms ?? 1, baths: pd.baths ?? 1, guests: pd.guests, currency: 'native' });
  const myId = Number((me.listing_info || {}).listing_id);
  const myHost = (me.host_info || {}).host_id;   // eigene weitere Inserate gehoeren nicht zur Konkurrenz
  const comps = ((cj && cj.listings) || []).filter((c) => Number((c.listing_info || {}).listing_id) !== myId && !(myHost && (c.host_info || {}).host_id === myHost) && pm(c).ttm_revenue != null);
  if (comps.length < 5) return null;
  const mine = card(me), C = comps.map(card), col = (k) => C.map((c) => c[k]), byRev = C.slice().sort((a, b) => b.rev - a.rev), top10 = byRev.slice(0, 10), m = pm(me);
  const p75 = dist(col('occ')).p75, pot = mine.occ != null && mine.adr != null && p75 != null && p75 > mine.occ ? Math.round((p75 - mine.occ) * 365 * mine.adr / 100) * 100 : null;
  return {
    potential: pot && pot >= 500 ? pot : null,
    source: 'airbnb', currency: (me.pricing_info || {}).currency || 'CHF', n: C.length, area: loc.district || loc.locality || null,
    you: { ...mine, l90: { adr: m.l90d_avg_rate ?? null, occ: m.l90d_occupancy ?? null } },
    dist: { adr: dist(col('adr')), occ: dist(col('occ')), rev: dist(col('rev')) },
    rank: { adr: rankOf(col('adr'), mine.adr), occ: rankOf(col('occ'), mine.occ), rev: rankOf(col('rev'), mine.rev) },
    top: byRev.slice(0, 3),
    rules: { n: top10.length, minNights2: top10.filter((c) => c.minNights != null && c.minNights <= 2).length, flexible: top10.filter((c) => /flex/i.test(c.policy || '')).length, gf: top10.filter((c) => c.gf).length, cleaning: qt(top10.map((c) => c.cleaning), .5), amenities: qt(top10.map((c) => c.amenities), .5) },
  };
}
