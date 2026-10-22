// Befund-Motor: erzeugt aus Scrape + Foto-Analyse den Listing-Health-Report im Format der Seite.
const MODEL = process.env.REPORT_MODEL || process.env.PHOTO_MODEL || 'claude-sonnet-5-5';
const BASE = process.env.ANTHROPIC_BASE || 'https://api.anthropic.com';
const IDS = ['title', 'desc', 'photos', 'reviews', 'consistency'];
const W = { title: .15, desc: .20, photos: .20, reviews: .30, consistency: .15 };
const NAMES = {
  de: { title: 'Titel', desc: 'Beschreibung', photos: 'Fotos', reviews: 'Bewertungen', consistency: 'Stimmigkeit', rules: 'Preis und Regeln' },
  en: { title: 'Title', desc: 'Description', photos: 'Photos', reviews: 'Reviews', consistency: 'Consistency', rules: 'Price and rules' },
};
const ICONS = { title: 'type', desc: 'doc', photos: 'image', reviews: 'star', consistency: 'shield', rules: 'trend' };
const RULES = {
  de: { finding: 'Preis, Mindestaufenthalt und Stornierung prüft der Experte mit deinen Buchungsdaten.', why: 'Regeln und Preis entscheiden, ob aus Klicks Buchungen werden. Ohne Buchungsdaten sind es nur Hypothesen.', affects: 'Sichtbarkeit und Belegung' },
  en: { finding: 'The expert reviews price, minimum stay and cancellation with your booking data.', why: 'Rules and price decide whether clicks become bookings. Without booking data they are only hypotheses.', affects: 'Visibility and occupancy' },
};
const clean = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const num = (v, lo, hi, d = null) => { const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const arr = (v, max = 12) => (Array.isArray(v) ? v.slice(0, max) : []);
const strs = (v, max = 8, len = 300) => arr(v, max).map((x) => str(x, len)).filter(Boolean);

export function prepare(d, photoRes) {
  const am = d.amenities || [], rv = d.reviews || [];
  const last = rv[0] && (rv[0].createdAt || rv[0].date);
  const days = last && !isNaN(Date.parse(last)) ? Math.max(0, Math.round((Date.now() - Date.parse(last)) / 864e5)) : null;
  const ov = photoRes && photoRes.analysis && photoRes.analysis.overall, an = photoRes && photoRes.analysis;
  return {
    listingTitle: d.title, descriptionText: clean(d.description).slice(0, 3000), descriptionChars: clean(d.description).length,
    highlights: JSON.stringify(d.highlights || null).slice(0, 800), sleepingArrangements: d.sleeping || [],
    amenitiesAvailable: am.filter((a) => a.available).map((a) => a.name).slice(0, 90), amenitiesNotAvailable: am.filter((a) => !a.available).map((a) => a.name).slice(0, 30),
    ratings: { overall: d.ratings && d.ratings.overall, guestFavorite: d.ratings && d.ratings.isGuestFavorite, categories: d.ratings && d.ratings.categories, distribution: d.ratings && d.ratings.distribution, topics: d.ratings && d.ratings.topics },
    reviewCount: rv.length, daysSinceLastReview: days,
    reviews: rv.slice(0, 40).map((r) => ({ date: r.date || String(r.createdAt || '').slice(0, 10), rating: r.rating, lang: r.language, text: clean(r.text).slice(0, 320), hostReplied: !!r.hostResponse })),
    neighborhoodText: clean(d.neighborhoodGuide).slice(0, 1500), houseRules: JSON.stringify(d.houseRules || null).slice(0, 800),
    hostInfo: JSON.stringify(d.pdp && d.pdp.hostInfo || null).slice(0, 600), photoCount: (d.photos || []).length,
    photoAnalysis: an ? { overall: ov, cover: an.cover, roomCoverage: an.roomCoverage, missingMotifs: an.missingMotifs } : null,
  };
}

const SCHEMA = `{
 "listing": {"city": "Ort oder null", "rating": 0-5 oder null, "daysSinceReview": Zahl oder null},
 "cats": [ {"id": "title|desc|photos|reviews|consistency", "base": 0-100, "finding": "1-2 Sätze", "why": "1-2 Sätze", "affects": "z. B. Klickrate", "evidence": ["3-5 belegte Fakten aus den Daten"]} ],   // genau diese 5 ids in dieser Reihenfolge
 "actions": [ {"id": "a1", "cat": "title|desc|photos|reviews|consistency", "t": "Maßnahme", "min": Minuten, "effort": "z. B. 5 Min", "impact": "Hoch|Mittel|Niedrig", "gain": 1-30, "why": "Warum", "how": "So geht's konkret", "copy": "fertiger Text oder null", "ota": true|false, "tag": "elev8 oder weglassen"} ],   // 6-10 Stück, a1 = Titel ersetzen, a2 = Beschreibung ersetzen, a3 = Foto-Tour/Reihenfolge verbessern, dann a4...
 "titles": [ {"text": "max. 50 Zeichen", "note": "warum"} ],   // genau 3 neue Varianten A, B, C
 "recommendedTitle": "A|B|C",
 "currentTitleNote": "1 Satz zum heutigen Titel",
 "descAfter": "neue Beschreibung, max. 900 Zeichen, Absätze und '• '-Aufzählung, nur belegte Fakten, Unsicheres in [eckigen Klammern]",
 "fluff": ["Werbefloskeln, die wörtlich in der heutigen Beschreibung stehen"],
 "gaps": [ {"says": "was das Inserat sagt", "real": "was Gäste/Daten zeigen", "fix": "Fix", "cat": "...", "act": "a1..."} ],   // 3-6, nur echte Widersprüche
 "vis": [ ["Signal", "good|warn|bad", "Status in 1-2 Worten"] ]   // 5-8 Sichtbarkeits-Signale aus den Daten (Guest Favorite, Superhost, Gesamtnote, letzte Bewertung, Ausstattungsanzahl ...)
}`;

export function buildPrompt(facts, lang) {
  const L = lang === 'en' ? 'Englisch' : 'Deutsch (Schweizer Schreibweise, ss statt ß)';
  return `Du bist ein erfahrener Revenue-Manager für Kurzzeitvermietung und prüfst ein Airbnb-Inserat. Erstelle aus den DATEN einen Listing-Health-Befund.\n\nREGELN\n- Nutze NUR Fakten aus den DATEN. Erfinde nichts: keine Umsätze, keine Marktdaten, keine Konkurrenz, keine Zahlen, die nicht in den Daten stehen. Unbekanntes weglassen oder in [Klammern] markieren.\n- Sprache aller Texte: ${L}. Ton: direkt, konkret, ohne Floskeln.\n- base-Werte: 90+ exzellent, 70-89 solide, 50-69 deutliche Lücken, unter 50 schwach. Begründe jeden Wert mit Belegen in evidence.\n- photos: stütze dich auf photoAnalysis. reviews: stütze dich auf Bewertungen, Kategorien und Zeitverlauf.\n- Titel: max. 50 Zeichen, nennt Gästezahl oder Ausstattung und die echte Lage. Keine falschen Ortsangaben.\n- gain pro Bereich so wählen, dass base plus alle gain eines Bereichs höchstens 98 ergibt.\n- ota=true nur für Änderungen im Inserat (Titel, Text, Fotos, Ausstattung, Regeln). tag=elev8 für Automatisierungen wie Bewertungsbitte oder Check-in-Nachricht.\n\nANTWORT: ausschließlich gültiges JSON in dieser Form (Kommentare nicht ausgeben):\n${SCHEMA}\n\nDATEN:\n${JSON.stringify(facts)}`;
}

function parseJson(text) {
  const t = String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try { return JSON.parse(t); } catch { const m = t.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch { } } }
  return null;
}

export function normalize(raw, d, photoRes, lang) {
  if (!raw || typeof raw !== 'object') throw new Error('Die KI-Antwort war nicht lesbar');
  const L = lang === 'en' ? 'en' : 'de', N = NAMES[L];
  const rv = d.reviews || [], am = (d.amenities || []).filter((a) => a.available);
  const last = rv[0] && (rv[0].createdAt || rv[0].date), days = last && !isNaN(Date.parse(last)) ? Math.max(0, Math.round((Date.now() - Date.parse(last)) / 864e5)) : num(raw.listing && raw.listing.daysSinceReview, 0, 5000);
  const listing = { name: d.title || 'Inserat', city: str(raw.listing && raw.listing.city, 80) || null, rating: num(raw.listing && raw.listing.rating, 0, 5), reviews: rv.length, photos: (d.photos || []).length, amenities: am.length, daysSinceReview: days };
  const photoScore = num(photoRes && photoRes.analysis && photoRes.analysis.overall && photoRes.analysis.overall.score, 0, 100);
  const byId = Object.fromEntries(arr(raw.cats, 10).map((c) => [c && c.id, c]));
  const cats = IDS.map((id) => {
    const c = byId[id] || {};
    let base = num(c.base, 0, 95, 60); if (id === 'photos' && photoScore != null) base = Math.min(95, photoScore);
    const evidence = strs(c.evidence, 6, 260);
    return { id, name: N[id], icon: ICONS[id], base: Math.round(base), w: W[id], affects: str(c.affects, 80) || '', finding: str(c.finding, 400), why: str(c.why, 400), evidence: evidence.length ? evidence : [] };
  });
  cats.push({ id: 'rules', name: N.rules, icon: ICONS.rules, base: null, w: 0, affects: RULES[L].affects, finding: RULES[L].finding, why: RULES[L].why, evidence: [] });
  const impacts = ['Hoch', 'Mittel', 'Niedrig'];
  let actions = arr(raw.actions, 14).map((a, i) => a && typeof a === 'object' ? {
    id: `a${i + 1}`, cat: IDS.includes(a.cat) ? a.cat : 'consistency', t: str(a.t, 160), min: num(a.min, 1, 600, 15), effort: str(a.effort, 40) || '15 Min', impact: impacts.includes(a.impact) ? a.impact : 'Mittel',
    gain: Math.round(num(a.gain, 0, 30, 3)), why: str(a.why, 400), how: str(a.how, 500), ota: a.ota === true, ...(a.tag === 'elev8' ? { tag: 'elev8', e8: L === 'en' ? 'Task created in Elev8 (demo)' : 'Task in Elev8 angelegt (Demo)' } : {}), ...(str(a.copy, 1500) ? { copy: str(a.copy, 1500) } : {}),
  } : null).filter((a) => a && a.t);
  const fixed = { a1: ['title', L === 'en' ? 'Replace the title' : 'Titel ersetzen'], a2: ['desc', L === 'en' ? 'Rewrite the description' : 'Beschreibung neu schreiben'], a3: ['photos', L === 'en' ? 'Sort the photo tour into rooms' : 'Foto-Tour ordnen'] };
  for (const [id, [cat, t]] of Object.entries(fixed)) {
    const i = Number(id.slice(1)) - 1, a = actions[i];
    if (!a || a.cat !== cat) { actions.splice(i, 0, { id, cat, t, min: 15, effort: '15 Min', impact: 'Hoch', gain: 10, why: L === 'en' ? 'This is the area with the most leverage in the report.' : 'Hier liegt im Report der größte Hebel.', how: L === 'en' ? 'Use the suggestion from the studio below.' : 'Den Vorschlag aus dem Studio unten übernehmen.', ota: true }); }
  }
  actions = actions.slice(0, 12).map((a, i) => { const id = `a${i + 1}`; if (i < 3) a.ota = true; return { ...a, id }; });
  const idmap = new Set(actions.map((a) => a.id));
  const tv = arr(raw.titles, 3).map((t, i) => ({ id: 'ABC'[i], label: L === 'en' ? `Variant ${'ABC'[i]}` : `Variante ${'ABC'[i]}`, text: str(t && t.text, 60), note: str(t && t.note, 200) })).filter((t) => t.text && [...t.text].length <= 50);
  const rec = tv.find((t) => t.id === raw.recommendedTitle) ? raw.recommendedTitle : (tv[0] && tv[0].id) || null;
  if (rec) tv.find((t) => t.id === rec).rec = true;
  const titles = [{ id: 'cur', label: L === 'en' ? 'Current' : 'Aktuell', text: d.title || '', note: str(raw.currentTitleNote, 200) }].concat(tv);
  const ratings = ((d.ratings && d.ratings.categories) || []).map((c) => [str(c.label, 40), num(c.value, 0, 5)]).filter((r) => r[0] && r[1] != null);
  const gaps = arr(raw.gaps, 8).map((g) => g && ({ says: str(g.says, 220), real: str(g.real, 260), fix: str(g.fix, 220), cat: IDS.includes(g.cat) ? g.cat : 'consistency', act: idmap.has(g.act) ? g.act : 'a1' })).filter((g) => g && g.says && g.real);
  const vis = arr(raw.vis, 10).map((v) => Array.isArray(v) ? [str(v[0], 60), ['good', 'warn', 'bad'].includes(v[1]) ? v[1] : 'warn', str(v[2], 30)] : null).filter((v) => v && v[0]);
  return { lang: L, listing, cats, actions, titles, recommendedTitle: rec, descBefore: clean(d.description).slice(0, 900), descAfter: str(raw.descAfter, 1400), fluff: strs(raw.fluff, 8, 60), gaps, vis, ratings };
}

export async function generateReport(d, photoRes, lang, apiKey) {
  if (!apiKey) throw Object.assign(new Error('ANTHROPIC_API_KEY fehlt'), { status: 503 });
  const facts = prepare(d, photoRes);
  const r = await fetch(`${BASE}/v1/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 7000, messages: [{ role: 'user', content: buildPrompt(facts, lang) }] }), signal: AbortSignal.timeout(150000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Anthropic ${r.status}: ${(j.error && j.error.message) || 'Fehler'}`), { status: 502 });
  const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return normalize(parseJson(text), d, photoRes, lang);
}
