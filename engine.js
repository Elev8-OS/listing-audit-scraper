// Befund-Motor v2: zwei kleinere KI-Aufrufe (Analyse, Texte), geprüft, mit festen Sichtbarkeits-Signalen.
import { prepare, normalize, salvageJson } from './report.js';
const MODEL = process.env.REPORT_MODEL || process.env.PHOTO_MODEL || 'claude-sonnet-5-5';
const BASE = process.env.ANTHROPIC_BASE || 'https://api.anthropic.com';
const len = (s) => [...String(s || '')].length;
const RULES = (L) => `REGELN
- Nutze NUR Fakten aus den DATEN. Erfinde nichts: keine Umsätze, keine Marktdaten, keine Konkurrenz, keine Zahlen, die nicht in den Daten stehen.
- Bewirb oder behaupte nichts, was die Foto-Analyse oder die Bewertungen nicht bestätigen (zum Beispiel kein „Balkon“, wenn die Fotos nur einen Innenhof zeigen).
- Sprache aller Texte: ${L === 'en' ? 'Englisch' : 'Deutsch (Schweizer Schreibweise, ss statt ß)'}. Ton: direkt, konkret, ohne Floskeln.`;
const SA = `{
 "listing": {"city": "Ort oder null", "rating": 0-5 oder null, "daysSinceReview": Zahl oder null},
 "cats": [ {"id": "title|desc|photos|reviews|consistency", "base": 0-100, "finding": "1-2 Sätze", "why": "1-2 Sätze", "affects": "z. B. Klickrate", "evidence": ["3-5 belegte Fakten aus den Daten"]} ],   // genau diese 5 ids in dieser Reihenfolge
 "actions": [ {"id": "a1", "cat": "title|desc|photos|reviews|consistency", "t": "Maßnahme", "min": Minuten, "effort": "z. B. 5 Min", "impact": "Hoch|Mittel|Niedrig", "gain": 1-30, "why": "Warum", "how": "So geht's konkret", "copy": null, "ota": true|false, "tag": "elev8 oder weglassen"} ],   // 6-10 Stück: a1 = Titel ersetzen, a2 = Beschreibung ersetzen, a3 = Foto-Tour verbessern, dann a4...
 "currentTitleNote": "1 Satz zum heutigen Titel",
 "fluff": ["Werbefloskeln, die wörtlich in der heutigen Beschreibung stehen"],
 "gaps": [ {"says": "was das Inserat sagt", "real": "was Fotos, Gäste oder Daten zeigen", "fix": "Fix", "cat": "title|desc|photos|reviews|consistency", "act": "a1..."} ]   // 3-6 echte Widersprüche, lieber weniger als erfunden
}`;
const SB = `{
 "titles": [ {"text": "höchstens 50 Zeichen", "note": "warum"} ],   // genau 3 Varianten A, B, C. Zähle die Zeichen nach. Nenne Gästezahl oder Ausstattung und die echte Lage.
 "recommendedTitle": "A|B|C",
 "descAfter": "neue Beschreibung, 500-900 Zeichen, Absätze und '• '-Aufzählung, nur belegte Fakten, Unsicheres in [eckigen Klammern]"
}`;
const promptA = (f, L) => `Du bist ein erfahrener Revenue-Manager für Kurzzeitvermietung und prüfst ein Airbnb-Inserat. Erstelle den analytischen Teil des Listing-Health-Befunds.\n\n${RULES(L)}\n- base-Werte: 90+ exzellent, 70-89 solide, 50-69 deutliche Lücken, unter 50 schwach. Begründe jeden Wert mit Belegen in evidence.\n- photos: stütze dich auf photoAnalysis. reviews: stütze dich auf Bewertungen, Kategorien und Zeitverlauf.\n- gain pro Bereich so wählen, dass base plus alle gain eines Bereichs höchstens 98 ergibt.\n- ota=true nur für Änderungen im Inserat (Titel, Text, Fotos, Ausstattung, Regeln). tag=elev8 für Automatisierungen wie Bewertungsbitte.\n\nANTWORT: ausschließlich gültiges JSON in dieser Form (Kommentare nicht ausgeben):\n${SA}\n\nDATEN:\n${JSON.stringify(f)}`;
const promptB = (f, L) => `Du bist ein erfahrener Texter für Kurzzeitvermietung. Schreibe für dieses Airbnb-Inserat drei neue Titel und eine neue Beschreibung.\n\n${RULES(L)}\n- Titel: höchstens 50 Zeichen, zähle nach. Keine falschen Ortsangaben.\n- Die Beschreibung ist besser als die heutige: konkret, mit echten Ausstattungen, ehrlich zu Schwächen aus Bewertungen (zum Beispiel Lärm), ohne Werbefloskeln.\n\nANTWORT: ausschließlich gültiges JSON in dieser Form (Kommentare nicht ausgeben):\n${SB}\n\nDATEN:\n${JSON.stringify(f)}`;

async function ask(prompt, key) {
  const r = await fetch(`${BASE}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: 12000, messages: [{ role: 'user', content: prompt }] }), signal: AbortSignal.timeout(170000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Anthropic ${r.status}: ${(j.error && j.error.message) || 'Fehler'}`), { status: 502 });
  return salvageJson((j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''));
}
const okA = (a) => !!(a && Array.isArray(a.cats) && a.cats.length >= 5 && Array.isArray(a.actions) && a.actions.length >= 3);
const okB = (b) => !!(b && Array.isArray(b.titles) && b.titles.filter((x) => x && x.text && len(x.text) <= 50).length >= 2 && len(b.descAfter) >= 200);
async function until(prompt, ok, key, hint) {
  let last = null;
  for (let i = 0; i < 3; i++) { last = await ask(i ? `${prompt}\n\nHINWEIS: Die letzte Antwort war ungültig (${hint}). Halte das Schema exakt ein.` : prompt, key); if (ok(last)) return last; }
  return last;
}
const fit = (s) => { s = String(s || '').trim(); if (len(s) <= 50) return s; const c = [...s].slice(0, 50).join(''), i = c.lastIndexOf(' '); return (i > 25 ? c.slice(0, i) : c).replace(/[\s·,–-]+$/, ''); };

function buildVis(f, photoRes, L) {
  const en = L === 'en', n = (x) => String(x).replace('.', en ? '.' : ','), v = [], add = (l, k, s) => v.push([l, k, s]);
  const gf = f.ratings && f.ratings.guestFavorite; add('Guest Favorite', gf ? 'good' : 'warn', gf ? (en ? 'Yes' : 'Ja') : (en ? 'No' : 'Nein'));
  const r = f.ratings && f.ratings.overall; if (Number.isFinite(r)) add(en ? 'Overall rating' : 'Gesamtnote', r >= 4.8 ? 'good' : r >= 4.6 ? 'warn' : 'bad', n(Number(r).toFixed(2)));
  add(en ? 'Reviews' : 'Bewertungen', f.reviewCount >= 50 ? 'good' : f.reviewCount >= 15 ? 'warn' : 'bad', String(f.reviewCount));
  const d = f.daysSinceLastReview; if (d != null) add(en ? 'Latest review' : 'Letzte Bewertung', d <= 30 ? 'good' : d <= 90 ? 'warn' : 'bad', en ? `${d} days ago` : `vor ${d} Tagen`);
  const am = (f.amenitiesAvailable || []).length; add(en ? 'Amenities' : 'Ausstattungen', am >= 45 ? 'good' : am >= 30 ? 'warn' : 'bad', String(am));
  add(en ? 'Photos' : 'Fotos', f.photoCount >= 25 ? 'good' : f.photoCount >= 15 ? 'warn' : 'bad', String(f.photoCount));
  const ps = photoRes && photoRes.analysis && photoRes.analysis.overall && photoRes.analysis.overall.score; if (Number.isFinite(ps)) add(en ? 'Photo grade' : 'Foto-Note', ps >= 80 ? 'good' : ps >= 60 ? 'warn' : 'bad', `${ps}/100`);
  return v;
}

export async function generateReportV2(d, photoRes, lang, key) {
  if (!key) throw Object.assign(new Error('ANTHROPIC_API_KEY fehlt'), { status: 503 });
  const L = lang === 'en' ? 'en' : 'de', f = prepare(d, photoRes), fB = { ...f, reviews: (f.reviews || []).slice(0, 15) };
  const [A, B] = await Promise.all([until(promptA(f, L), okA, key, 'Bereiche oder Maßnahmen fehlen'), until(promptB(fB, L), okB, key, 'Titel länger als 50 Zeichen oder Beschreibung fehlt')]);
  if (!okA(A)) throw new Error('Die Analyse war unvollständig');
  if (!B || !Array.isArray(B.titles) || len(B.descAfter) < 100) throw new Error('Die KI hat keinen neuen Text geliefert');
  B.titles = B.titles.slice(0, 3).map((t) => ({ ...t, text: fit(t && t.text) }));
  const rep = normalize({ ...A, ...B }, d, photoRes, L);
  rep.vis = buildVis(f, photoRes, L);
  const rec = rep.titles.find((t) => t.rec);
  if (rec && rep.actions[0] && !rep.actions[0].copy) rep.actions[0].copy = rec.text;
  if (rep.actions[1] && !rep.actions[1].copy) rep.actions[1].copy = rep.descAfter;
  return rep;
}
