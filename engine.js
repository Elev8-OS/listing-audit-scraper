// Befund-Motor v2: zwei kleinere KI-Aufrufe (Analyse, Texte), geprüft, mit festen Sichtbarkeits-Signalen und Ausstattungs-Abgleich.
import { prepare, normalize, salvageJson } from './report.js';
export const PROMPT_VERSION = 'v6';   // bei jeder Aenderung der Prompts hochzaehlen: gespeicherte Reports werden dann neu erzeugt
const MODEL = process.env.REPORT_MODEL || process.env.PHOTO_MODEL || 'claude-sonnet-5-5';
const BASE = process.env.ANTHROPIC_BASE || 'https://api.anthropic.com';
const len = (s) => [...String(s || '')].length;
const RULES = (L) => `REGELN
- Nutze NUR Fakten aus den DATEN. Erfinde nichts: keine Umsätze, keine Marktdaten, keine Konkurrenz, keine Zahlen, die nicht in den Daten stehen.
- Bewirb oder behaupte nichts, was die Foto-Analyse oder die Bewertungen nicht bestätigen (zum Beispiel kein „Balkon“, wenn die Fotos nur einen Innenhof zeigen).
- Sprache aller Texte: ${L === 'en' ? 'Englisch' : 'Deutsch (Schweizer Schreibweise, ss statt ß)'}. Ton: direkt, konkret, ohne Floskeln.`;
const SA1 = `{
 "listing": {"city": "Ort oder null", "rating": 0-5 oder null, "daysSinceReview": Zahl oder null},
 "cats": [ {"id": "title|desc|photos|reviews|consistency", "base": 0-100, "finding": "1-2 Sätze", "why": "1 Satz", "affects": "z. B. Klickrate", "evidence": ["höchstens 4 belegte Fakten, je ein kurzer Satz"]} ],   // genau diese 5 ids in dieser Reihenfolge
 "currentTitleNote": "1 Satz zum heutigen Titel",
 "fluff": ["Werbefloskeln, die wörtlich in der heutigen Beschreibung stehen"],
 "gaps": [ {"says": "was das Inserat sagt", "real": "was Fotos, Gäste oder Daten zeigen", "fix": "Fix", "cat": "title|desc|photos|reviews|consistency"} ],   // 3-5 echte Widersprüche, lieber weniger als erfunden
 "amenityNotes": {
   "visibleNotListed": [ {"item": "Merkmal, das in photoShows klar zu sehen ist und NICHT in amenitiesAvailable steht, z. B. Kachelofen", "photos": [Foto-Nr.]} ],   // höchstens 4, nur was Gäste interessiert und die Fotobeschreibungen klar belegen
   "textVsList": [ {"says": "was die Beschreibung nennt", "real": "was die Ausstattungsliste dazu zeigt", "fix": "Fix"} ]   // nur echte Widersprüche zwischen descriptionText und amenities, sonst leer
 }
}`;
const SA2 = `{
 "actions": [ {"id": "a1", "cat": "title|desc|photos|reviews|consistency", "t": "Maßnahme", "min": Minuten, "effort": "z. B. 5 Min", "impact": "Hoch|Mittel|Niedrig", "gain": 1-20, "why": "1 Satz", "how": "1-2 Sätze, konkret", "copy": null, "ota": true|false, "tag": "elev8 oder weglassen"} ]   // 6-9 Stück: a1 = Titel ersetzen, a2 = Beschreibung ersetzen, a3 = Foto-Tour verbessern, dann a4...
}`;
const SB = `{
 "titles": [ {"text": "höchstens 50 Zeichen", "note": "1 Satz, warum der Titel funktioniert, ohne Bezug auf Bewertungen oder Gäste"} ],   // genau 3 Varianten A, B, C. Zähle die Zeichen nach. Nenne Gästezahl oder Ausstattung und die echte Lage.
 "recommendedTitle": "A|B|C",
 "descAfter": "neue Beschreibung, 500-900 Zeichen: einladender Einstieg, '• '-Liste der Vorzüge, freundlicher Schlusssatz. Nur belegte Fakten, rein positiv, ohne Bezug auf Bewertungen, ohne Zitate. Unsicheres weglassen."
}`;
const promptA1 = (f, L) => `Du bist ein erfahrener Revenue-Manager für Kurzzeitvermietung und prüfst ein Airbnb-Inserat. Erstelle den Befund (Bereiche und Widersprüche) des Listing-Health-Berichts. Fasse dich kurz.\n\n${RULES(L)}\n- base-Werte: 90+ exzellent, 70-89 solide, 50-69 deutliche Lücken, unter 50 schwach. Begründe jeden Wert mit Belegen in evidence.\n- photos: stütze dich auf photoAnalysis. reviews: stütze dich auf Bewertungen, Kategorien und Zeitverlauf.\n- amenityCheck (gelistet, aber auf keinem Foto) ist bereits berechnet: wiederhole es nicht in gaps. Prüfe in amenityNotes nur, was auf den Fotos zu sehen ist und nicht in der Liste steht, und Widersprüche zwischen Beschreibung und Liste.\n\nANTWORT: ausschließlich gültiges JSON in dieser Form (Kommentare nicht ausgeben):\n${SA1}\n\nDATEN:\n${JSON.stringify(f)}`;
const promptA2 = (f, L) => `Du bist ein erfahrener Revenue-Manager für Kurzzeitvermietung und prüfst ein Airbnb-Inserat. Erstelle den Maßnahmenplan. Fasse dich kurz.\n\n${RULES(L)}\n- Nur Maßnahmen, die sich aus den Daten ableiten. Keine Maßnahme zum Fotografieren gelisteter Ausstattung (amenityCheck wird separat behandelt).\n- ota=true nur für Änderungen im Inserat (Titel, Text, Fotos, Ausstattung, Regeln). tag=elev8 für Automatisierungen wie Bewertungsbitte.\n\nANTWORT: ausschließlich gültiges JSON in dieser Form (Kommentare nicht ausgeben):\n${SA2}\n\nDATEN:\n${JSON.stringify(f)}`;
const promptB = (f, L) => `Du bist ein erfahrener Texter für Kurzzeitvermietung. Schreibe für dieses Airbnb-Inserat drei neue Titel und eine neue Beschreibung. Ziel: Gäste bekommen ein gutes Gefühl und möchten buchen.\n\n${RULES(L)}\n- Ehrlich: Nutze nur Fakten aus den DATEN (Ausstattung, Räume, Betten, Lage, bestehender Text). Nichts erfinden, nichts übertreiben, keine Superlative ohne Beleg.\n- Rein positiv und einladend: beschreibe, was Gäste bekommen und wie es sich anfühlt. Keine Nachteile und Einschränkungen, kein „kein/keine/ohne/leider/nur“, kein Hinweisblock mit Mängeln. Praktische Fakten (zum Beispiel Stockwerk, Lift, Check-in) nennst du neutral als Information oder Vorzug.\n- Bewertungen sind tabu: nichts aus Bewertungen, keine Noten, Sterne oder Bewertungszahlen, kein „Gäste lieben“ und kein „Guest Favorite“. Keine Zitate von Gastgebern oder Gästen, keine wörtliche Rede.\n- Titel: höchstens 50 Zeichen, zähle nach. Gästezahl oder Ausstattung und die echte Lage, einladend, keine falschen Ortsangaben.\n- Schlafzimmer: Nenne nur Räume mit echtem Bett als Schlafzimmer. Steht in bedroomFacts, dass ein Raum nur ein Schlafsofa hat, nennst du nie die gelistete Zahl, sondern schreibst zum Beispiel „2 Schlafzimmer und Schlafsofa“ oder nennst nur die Gästezahl.\n- Beschreibung: 500 bis 900 Zeichen. Zuerst ein einladender Einstieg in 1 bis 2 Sätzen, dann eine kurze '• '-Liste der Vorzüge, am Ende ein freundlicher Schlusssatz. Konkret statt Werbefloskeln wie „exquisit“, „einzigartig“ oder „unvergesslich“.\n\nANTWORT: ausschließlich gültiges JSON in dieser Form (Kommentare nicht ausgeben):\n${SB}\n\nDATEN:\n${JSON.stringify(f)}`;

async function ask(prompt, key, tag) {
  const t0 = Date.now(), r = await fetch(`${BASE}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: 16000, messages: [{ role: 'user', content: prompt }] }), signal: AbortSignal.timeout(150000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Anthropic ${r.status}: ${(j.error && j.error.message) || 'Fehler'}`), { status: 502 });
  const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''), obj = salvageJson(text), u = j.usage || {};
  console.log(`KI ${tag} ${Math.round((Date.now() - t0) / 1000)}s stop=${j.stop_reason} out=${u.output_tokens} denken=${(u.output_tokens_details || {}).thinking_tokens ?? '-'} json=${obj ? Object.keys(obj).join(',') : 'NICHT LESBAR'}${obj ? '' : ' | Anfang: ' + text.slice(0, 120).replace(/\s+/g, ' ') + ' | Ende: ' + text.slice(-120).replace(/\s+/g, ' ')}`);
  return { obj, stop: j.stop_reason };
}
const okA1 = (a) => !!(a && Array.isArray(a.cats) && a.cats.length >= 5);
const okA2 = (a) => !!(a && Array.isArray(a.actions) && a.actions.length >= 3);
const okB = (b) => !!(b && Array.isArray(b.titles) && b.titles.filter((x) => x && x.text && len(x.text) <= 50).length >= 2 && len(b.descAfter) >= 200);
async function until(prompt, ok, key, hint, tag) {
  let last = null, cut = false;
  for (let i = 0; i < 2; i++) {
    const r = await ask(i ? `${prompt}\n\nHINWEIS: Die letzte Antwort war ungültig (${hint}${cut ? ', sie wurde abgeschnitten' : ''}). Antworte deutlich kürzer und halte das Schema exakt ein.` : prompt, key, tag);
    last = r.obj; cut = r.stop === 'max_tokens'; if (ok(last)) return last;
  }
  return last;
}
const fit = (s) => { s = String(s || '').trim(); if (len(s) <= 50) return s; const c = [...s].slice(0, 50).join(''), i = c.lastIndexOf(' '); return (i > 25 ? c.slice(0, i) : c).replace(/[\s·,–-]+$/, ''); };

function photoScore(photoRes) {
  const a = photoRes && photoRes.analysis, ok = a && Array.isArray(a.photos) ? a.photos.filter((p) => [p.brightness, p.sharpness, p.composition, p.tidiness].every(Number.isFinite)) : [];
  return ok.length ? Math.round(ok.reduce((t, p) => t + (p.brightness + p.sharpness + p.composition + p.tidiness) / 4, 0) / ok.length * 20) : null;
}
function buildVis(f, photoRes, L) {
  const en = L === 'en', n = (x) => String(x).replace('.', en ? '.' : ','), v = [], add = (l, k, s) => v.push([l, k, s]);
  const gf = f.ratings && f.ratings.guestFavorite; add('Guest Favorite', gf ? 'good' : 'warn', gf ? (en ? 'Yes' : 'Ja') : (en ? 'No' : 'Nein'));
  const r = f.ratings && f.ratings.overall; if (Number.isFinite(r)) add(en ? 'Overall rating' : 'Gesamtnote', r >= 4.8 ? 'good' : r >= 4.6 ? 'warn' : 'bad', n(Number(r).toFixed(2)));
  add(en ? 'Reviews' : 'Bewertungen', f.reviewCount >= 50 ? 'good' : f.reviewCount >= 15 ? 'warn' : 'bad', String(f.reviewCount));
  const d = f.daysSinceLastReview; if (d != null) add(en ? 'Latest review' : 'Letzte Bewertung', d <= 30 ? 'good' : d <= 90 ? 'warn' : 'bad', en ? `${d} days ago` : `vor ${d} Tagen`);
  const am = (f.amenitiesAvailable || []).length; add(en ? 'Amenities' : 'Ausstattungen', am >= 45 ? 'good' : am >= 30 ? 'warn' : 'bad', String(am));
  add(en ? 'Photos' : 'Fotos', f.photoCount >= 25 ? 'good' : f.photoCount >= 15 ? 'warn' : 'bad', String(f.photoCount));
  const ps = photoScore(photoRes); if (ps != null) add(en ? 'Photo grade' : 'Foto-Note', ps >= 80 ? 'good' : ps >= 60 ? 'warn' : 'bad', `${ps}/100`);
  return v;
}

/* ---- Ausstattung gegen Fotos und Text ---- */
const PRIO = ['kühlschrank', 'geschirrspüler', 'aufzug', 'lift', 'waschmaschine', 'trockner', 'kaffeemaschine', 'babybett', 'gefrierschrank', 'föhn', 'klima', 'heizung', 'pool', 'balkon'];
function amenityCheck(photoRes) {
  const ac = photoRes && photoRes.analysis && photoRes.analysis.amenityCoverage; if (!Array.isArray(ac) || !ac.length) return null;
  const pr = (n) => { const i = PRIO.findIndex((p) => String(n).toLowerCase().includes(p)); return i < 0 ? 99 : i; };
  const names = (fn) => ac.filter(fn).map((a) => String(a.amenity || '').trim()).filter(Boolean);
  return { checked: ac.length, shown: names((a) => a.photographed === true).length, notShown: names((a) => a.photographed === false).sort((a, b) => pr(a) - pr(b)), unclear: names((a) => a.photographed === 'unklar') };
}
function addAmenity(rep, chk, notes, d, photoRes, L) {
  const en = L === 'en', q = (s) => (en ? `“${s}”` : `„${s}“`), list = (a, n) => a.slice(0, n).join(', '), acts = rep.actions, nid = () => 'a' + (acts.length + 1);
  const listed = (d.amenities || []).filter((a) => a.available).map((a) => String(a.name || '').toLowerCase());
  const nPh = (d.photos || []).length, pc = rep.cats.find((c) => c.id === 'photos'), cc = rep.cats.find((c) => c.id === 'consistency'), out = { checked: chk ? chk.checked : 0, notShown: chk ? chk.notShown : [], unclear: chk ? chk.unclear : [], visibleNotListed: [], textVsList: [] };
  if (chk && chk.notShown.length && acts.length < 14) {
    const id = nid(), top = list(chk.notShown, 5), n = chk.notShown.length;
    acts.push({ id, cat: 'photos', t: en ? `Photograph listed amenities guests can’t see yet: ${top}` : `Gelistete Ausstattung fotografieren, die Gäste noch nicht sehen: ${top}`, min: 30, effort: en ? '30 min' : '30 Min', impact: n >= 4 ? 'Hoch' : 'Mittel', gain: Math.min(6, 2 + n),
      why: en ? `${n} of ${chk.checked} amenities that can be photographed are not visible in any photo. Guests want to see them before booking.` : `${n} von ${chk.checked} fotografierbaren Ausstattungen sind auf keinem Foto zu sehen. Gäste wollen sie vor der Buchung sehen.`,
      how: en ? 'Take one clear photo of each item and add it to the matching room in the tour. Not visible does not mean missing, only that guests cannot check it.' : 'Von jedem Punkt ein klares Foto machen und im passenden Raum der Tour ergänzen. Nicht sichtbar heißt nicht fehlend, Gäste können es nur nicht prüfen.', ota: true });
    rep.gaps.push({ says: (en ? 'Amenities: ' : 'Ausstattung: ') + q(top), real: en ? `Not visible in any of the ${nPh} photos.` : `Auf keinem der ${nPh} Fotos zu sehen.`, fix: en ? 'Add a photo of each item.' : 'Foto von jedem Punkt ergänzen.', cat: 'photos', act: id });
    pc.evidence.push(en ? `${n} of ${chk.checked} photographable amenities are in no photo: ${list(chk.notShown, 6)}` : `${n} von ${chk.checked} fotografierbaren Ausstattungen auf keinem Foto: ${list(chk.notShown, 6)}`);
  }
  const vis = (notes && Array.isArray(notes.visibleNotListed) ? notes.visibleNotListed : []).map((x) => ({ item: String((x && x.item) || '').trim().slice(0, 60), photos: Array.isArray(x && x.photos) ? x.photos.filter(Number.isFinite).slice(0, 4) : [] })).filter((x) => x.item && !listed.some((l) => l.includes(x.item.toLowerCase()) || x.item.toLowerCase().includes(l))).slice(0, 4);
  out.visibleNotListed = vis;
  if (vis.length && acts.length < 14) {
    const id = nid(), items = list(vis.map((x) => x.item), 4);
    acts.push({ id, cat: 'consistency', t: en ? `Name what the photos show but the amenities don’t: ${items}` : `Nennen, was die Fotos zeigen und die Ausstattung nicht: ${items}`, min: 10, effort: en ? '10 min' : '10 Min', impact: 'Mittel', gain: 3,
      why: en ? 'These features are clearly visible in the photos but appear neither in the amenities list. Guests only notice them if they open every photo.' : 'Diese Merkmale sind auf den Fotos klar zu sehen, stehen aber nicht in der Ausstattungsliste. Gäste bemerken sie nur, wenn sie jedes Foto öffnen.',
      how: en ? 'Add them to the amenities where Airbnb offers a matching item, otherwise mention them in the description.' : 'In die Ausstattung aufnehmen, wo Airbnb einen passenden Punkt anbietet, sonst in der Beschreibung nennen.', ota: true });
    rep.gaps.push({ says: en ? 'Amenities list' : 'Ausstattungsliste', real: (en ? 'Visible in photos: ' : 'Auf Fotos zu sehen: ') + vis.map((x) => x.photos.length ? `${x.item} (${en ? 'photo' : 'Foto'} ${x.photos.join(', ')})` : x.item).join(', '), fix: en ? 'Name them in the amenities or the description.' : 'In Ausstattung oder Beschreibung nennen.', cat: 'consistency', act: id });
    cc.evidence.push((en ? 'Visible in photos, not in the amenities: ' : 'Auf Fotos zu sehen, nicht in der Ausstattung: ') + list(vis.map((x) => x.item), 4));
  }
  const tv = (notes && Array.isArray(notes.textVsList) ? notes.textVsList : []).map((x) => ({ says: String((x && x.says) || '').trim().slice(0, 220), real: String((x && x.real) || '').trim().slice(0, 260), fix: String((x && x.fix) || '').trim().slice(0, 220) })).filter((x) => x.says && x.real).slice(0, 3);
  out.textVsList = tv; tv.forEach((x) => { rep.gaps.push({ ...x, fix: x.fix || (en ? 'Align text and amenities.' : 'Text und Ausstattung angleichen.'), cat: 'consistency', act: 'a2' }); });
  if (tv.length) cc.evidence.push(en ? `${tv.length} contradiction(s) between description and amenities` : `${tv.length} Widerspruch/Widersprüche zwischen Beschreibung und Ausstattung`);
  rep.amenityCheck = out;
}

/* ---- Schlafzimmer, die nur ein Schlafsofa haben ---- */
const SOFA = /(sofa\s*-?\s*bed|bed\s*-?\s*sofa|couch\s*bed|sleeper\s*sofa|pull-?out\s*(sofa|couch|bed)?|air\s*mattress|day\s*bed|schlafcouch|schlafsofa|bettsofa|sofa\s*-?\s*bett|sofabett|couch|sofa|futon|ausziehbar|luftmatratze|sleeper|tagesbett)/ig;
const REAL_BED = /(queen|king|doppel|double|einzel|single|twin|etagen|bunk|kinderbett|babybett|crib|\bcot\b|\bbett\b|\bbed\b)/i;
export function bedroomCheck(d) {
  const rooms = (Array.isArray(d && d.sleeping) ? d.sleeping : []).filter((x) => /schlafzimmer|bedroom|schlafraum/i.test(String((x && x.room) || '')));
  const odd = rooms.filter((x) => { const parts = String(x.beds || '').split(/,|·|\+|\bund\b|\band\b/i).map((p) => p.trim()).filter(Boolean); return parts.length > 0 && parts.every((p) => { const rest = p.replace(SOFA, ' '); return rest !== p && !REAL_BED.test(rest); }); }).map((x) => ({ room: String(x.room), beds: String(x.beds || '') }));
  return { listed: rooms.length, real: rooms.length - odd.length, odd };
}
const NUMW = { 2: 'zwei', 3: 'drei', 4: 'vier', 5: 'f\u00fcnf', 6: 'sechs' };
export function fixBedroomClaims(text, bc) {   // aus "3 Schlafzimmer" wird "2 Schlafzimmer", wenn eines davon nur ein Schlafsofa hat
  if (!text || !bc || !bc.odd.length || bc.listed === bc.real) return text;
  const nw = NUMW[bc.listed], rw = NUMW[bc.real] || String(bc.real);
  let t = String(text).replace(new RegExp(`\\b${bc.listed}(\\s*[- ]?\\s*)(Schlafzimmer|bedrooms?|Schlafr\u00e4ume)`, 'gi'), (m, sp, w) => `${bc.real}${sp}${w}`);
  if (nw) t = t.replace(new RegExp(`\\b${nw}(\\s*[- ]?\\s*)(Schlafzimmer|Schlafr\u00e4ume|bedrooms?)`, 'gi'), (m, sp, w) => `${rw}${sp}${w}`);
  return t;
}
function addBedrooms(rep, bc, d, L) {
  if (!bc.odd.length) return;
  const en = L === 'en', o = bc.odd[0], more = bc.odd.length > 1, acts = rep.actions, id = 'a' + (acts.length + 1), cc = rep.cats.find((c) => c.id === 'consistency');
  const titleClaims = new RegExp(`\\b${bc.listed}\\s*[- ]?\\s*(Schlafzimmer|bedrooms?)`, 'i').test(String(d.title || '')), q = (x) => (en ? `\u201c${x}\u201d` : `\u201e${x}\u201c`);
  acts.push({ id, cat: 'consistency', t: en ? `Name ${q(o.room)} honestly: living area with a sofa bed` : `${q(o.room)} ehrlich benennen: Wohnbereich mit Schlafsofa`, min: 5, effort: en ? '5 min' : '5 Min', impact: 'Mittel', gain: 6,
    why: en ? `${q(o.room)} only has ${o.beds}. Guests expect a real bed in its own room and are disappointed on arrival.` : `${q(o.room)} hat laut Betten-Angabe nur ${o.beds}. G\u00e4ste erwarten ein richtiges Bett in einem eigenen Raum und sind bei der Ankunft entt\u00e4uscht.`,
    how: en ? `List it as living room with a sofa bed, say ${bc.real} bedrooms in title and description and mention the sofa bed as an extra sleeping place.` : `Als Wohnzimmer mit Schlafsofa f\u00fchren, im Titel und in der Beschreibung ${bc.real} Schlafzimmer nennen und das Schlafsofa als zus\u00e4tzlichen Schlafplatz erw\u00e4hnen.`, ota: true });
  rep.gaps.unshift({ says: en ? `Listing: ${q(bc.listed + ' bedrooms')}${titleClaims ? ' (also in the title)' : ''}` : `Inserat: ${q(bc.listed + ' Schlafzimmer')}${titleClaims ? ' (auch im Titel)' : ''}`,
    real: en ? `${q(o.room)} only has ${o.beds}${more ? `, same for ${bc.odd.length - 1} more` : ''}. That is a living area with a place to sleep, not a bedroom.` : `${q(o.room)} hat nur ${o.beds}${more ? `, bei ${bc.odd.length - 1} weiteren ebenso` : ''}. Das ist ein Wohnbereich mit Schlafgelegenheit, kein Schlafzimmer.`,
    fix: en ? `Say ${bc.real} bedrooms and list the sofa bed as an extra sleeping place.` : `${bc.real} Schlafzimmer nennen und das Schlafsofa als zus\u00e4tzlichen Schlafplatz f\u00fchren.`, cat: 'consistency', act: id });
  if (cc) { cc.evidence.unshift(en ? `${q(o.room)} has only ${o.beds}, listed as a bedroom` : `${q(o.room)} hat nur ${o.beds}, ist aber als Schlafzimmer gelistet`); if (cc.base != null) cc.base = Math.max(40, cc.base - 10); }
  rep.titles.forEach((t) => { t.text = fit(fixBedroomClaims(t.text, bc)); });
  rep.descAfter = fixBedroomClaims(rep.descAfter, bc);
}

export async function generateReportV2(d, photoRes, lang, key) {
  if (!key) throw Object.assign(new Error('ANTHROPIC_API_KEY fehlt'), { status: 503 });
  const ps = photoScore(photoRes);
  if (ps != null) photoRes = { ...photoRes, analysis: { ...photoRes.analysis, overall: { ...(photoRes.analysis.overall || {}), score: ps } } };   // gleiche Foto-Note wie auf der Seite: Durchschnitt der Einzelwerte
  const L = lang === 'en' ? 'en' : 'de', chk = amenityCheck(photoRes), f = prepare(d, photoRes), bc = bedroomCheck(d);
  f.amenityCheck = chk;
  f.photoShows = photoRes && photoRes.analysis && Array.isArray(photoRes.analysis.photos) ? photoRes.analysis.photos.map((p) => ({ n: p.position, room: p.room, shows: p.shows })) : null;
  const fB = { listingTitle: f.listingTitle, descriptionText: f.descriptionText, highlights: f.highlights, sleepingArrangements: f.sleepingArrangements, amenitiesAvailable: f.amenitiesAvailable, neighborhoodText: f.neighborhoodText, photoCount: f.photoCount, ...(bc.odd.length ? { bedroomFacts: { gelisteteSchlafzimmer: bc.listed, schlafzimmerMitEchtemBett: bc.real, raeumeNurMitSchlafsofa: bc.odd } } : {}) };   // Textvorschlaege: nur Fakten zum Angebot, nichts aus Bewertungen, keine fehlende Ausstattung
  const fA2 = { ...f, photoShows: null };
  const [A, A2, B] = await Promise.all([until(promptA1(f, L), okA1, key, 'Bereiche fehlen', 'befund'), until(promptA2(fA2, L), okA2, key, 'Maßnahmen fehlen', 'plan'), until(promptB(fB, L), okB, key, 'Titel länger als 50 Zeichen oder Beschreibung fehlt', 'text')]);
  if (!okA1(A)) throw new Error('Der Befund war unvollständig. Bitte später erneut versuchen.');
  if (!okA2(A2)) throw new Error('Der Maßnahmenplan war unvollständig. Bitte später erneut versuchen.');
  if (!B || !Array.isArray(B.titles) || len(B.descAfter) < 100) throw new Error('Die KI hat keinen neuen Text geliefert');
  B.titles = B.titles.slice(0, 3).map((t) => ({ ...t, text: fit(t && t.text) }));
  const rep = normalize({ ...A, ...A2, ...B }, d, photoRes, L);
  rep.gaps.forEach((g) => { const a = rep.actions.find((x) => x.cat === g.cat); g.act = a ? a.id : 'a1'; });
  addBedrooms(rep, bc, d, L);
  rep.vis = buildVis(f, photoRes, L);
  const rec = rep.titles.find((t) => t.rec);
  if (rec && rep.actions[0] && !rep.actions[0].copy) rep.actions[0].copy = rec.text;
  if (rep.actions[1] && !rep.actions[1].copy) rep.actions[1].copy = rep.descAfter;
  addAmenity(rep, chk, A.amenityNotes, d, photoRes, L);
  rep.cats.forEach((c) => { if (c.base == null) return; const as = rep.actions.filter((a) => a.cat === c.id), sum = as.reduce((t, a) => t + a.gain, 0), room = Math.max(0, 98 - c.base); if (sum > room && sum > 0) as.forEach((a) => { a.gain = Math.max(a.gain > 0 ? 1 : 0, Math.floor(a.gain * room / sum)); }); });
  return rep;
}
