/* Beispiel-Report auf Foto-Befunde der KI-Analyse (zwei Läufe, nur stabile Befunde) nachziehen */
(function () {
  const D_ = D, set = (o, k, v) => { o[k] = v; };
  const P = D_.cats.find((c) => c.id === 'photos'), C = D_.cats.find((c) => c.id === 'consistency');
  P.base = 64;
  P.finding = 'Die Fotos sind hell und gepflegt, aber technisch mittelmäßig. Die Schlafsituation passt nicht zum Inserat: Schlafzimmer 2 ist nicht zu erkennen, Schlafzimmer 3 ist ein leerer Raum.';
  P.evidence = ['Foto-Note 64 von 100 (KI-Analyse aller 20 Fotos): flaues Licht, schiefe Winkel, mehrere Hochformate', 'Titelbild (Foto 6, Wohnzimmer) nur „mittel“: grau und leer. Foto 10 ist deutlich heller (4,25 von 5).', 'Schlafzimmer 3: Foto 4 zeigt einen leeren Raum ohne Bett und ohne Schlafcouch', 'Schlafzimmer 2 mit zwei Einzelbetten ist auf keinem Foto zu erkennen, Foto 2 zeigt ein Doppelbett', 'Innenhof (Foto 9): Beton, Unkraut, keine Möbel. Schwächstes Foto der Tour.', 'Die Fotos 3, 4, 7, 8, 14, 15 und 20 sind Wiederholungen oder unattraktiv', '15 von 20 Fotos ohne Raumzuordnung'];
  C.evidence = C.evidence.map((e) => e.indexOf('„Schlafzimmer 3“ besteht') === 0 ? '„Schlafzimmer 3“: Foto 4 zeigt einen leeren Raum ohne Bett und ohne Schlafcouch' : e);
  C.evidence.splice(2, 0, 'Das Inserat nennt „Privater Innenhof oder Balkon“, Foto 9 zeigt einen unmöblierten Betonhof');
  const T_ = D_.titles; T_.find((t) => t.id === 'A').text = 'Altstadt-Apartment für 6 · 3 Zimmer & Lift'; T_.find((t) => t.id === 'A').note = 'Gästezahl und zwei Merkmale. Spricht Gruppen an. Ohne „Balkon“, weil der Innenhof auf den Fotos keiner ist.';
  T_.find((t) => t.id === 'B').text = 'Geräumig mitten in der Altstadt · mit Lift';
  const a1 = D_.actions.find((a) => a.id === 'a1'); a1.copy = 'Geräumig mitten in der Altstadt · mit Lift'; a1.note = 'Wir haben „Balkon“ bewusst weggelassen: Foto 9 zeigt einen unmöblierten Innenhof.';
  const a3 = D_.actions.find((a) => a.id === 'a3'); a3.gain = 10;
  a3.why = 'Gäste scannen die Tour nach Räumen. 15 von 20 Fotos sind keinem Raum zugeordnet, und die KI-Analyse findet Wiederholungen, schiefe Winkel und unattraktive Motive.';
  a3.how = 'Räume anlegen und Fotos zuordnen. Die Fotos 3, 7, 8, 14, 15 und 20 streichen. Titelbild prüfen: Foto 10 ist heller als Foto 6. Danach die Reihenfolge aus dem Foto-Check übernehmen.';
  D_.actions.splice(3, 0,
    { id: 'a15', cat: 'photos', ota: true, t: 'Schlafzimmer 2 und 3 frisch bezogen neu fotografieren', min: 60, effort: '1 Std', impact: 'Hoch', gain: 8, why: 'Foto 4 zeigt für Schlafzimmer 3 einen leeren Raum, Schlafzimmer 2 ist auf keinem Foto zu erkennen. Gäste prüfen, wo sie schlafen.', how: 'Betten beziehen, die Schlafcouch aufbauen und bei eingeschaltetem Licht im Querformat aus der Tür fotografieren. Danach Foto 4 ersetzen.' },
    { id: 'a16', cat: 'photos', t: 'Innenhof aufräumen und neu fotografieren', min: 90, effort: '1 bis 2 Std', impact: 'Mittel', gain: 4, why: 'Foto 9 ist das schwächste der Tour: Unkraut, Beton, keine Möbel. Der Hof wird als „Balkon“ geführt.', how: 'Unkraut entfernen, Fassade abwaschen, zwei Stühle und Pflanzen hinstellen und neu fotografieren. Bis dahin Foto 9 aus der Tour nehmen.' });
  D_.descAfter = D_.descAfter.replace('• Lift, Balkon, WLAN und eigener Arbeitsplatz', '• Lift, WLAN, eigener Arbeitsplatz und Zugang zum Innenhof');
  const g = D_.gaps.find((x) => x.says === '„Schlafzimmer 3“');
  if (g) { g.says = '„Schlafzimmer 3“ mit Schlafcouch'; g.real = 'Foto 4 zeigt einen leeren Raum ohne Bett und ohne Schlafcouch.'; g.fix = 'Schlafcouch aufbauen und neu fotografieren oder das Zimmer ehrlich benennen.'; g.cat = 'photos'; g.act = 'a15'; }
  D_.gaps.push({ says: 'Ausstattung: „Privater Innenhof oder Balkon“', real: 'Foto 9 zeigt einen betonierten Innenhof mit Unkraut und ohne Möbel.', fix: 'Nicht als Balkon bewerben. Hof aufräumen und möblieren.', cat: 'photos', act: 'a16' });
  Object.assign(EN, {
    'Die Fotos sind hell und gepflegt, aber technisch mittelmäßig. Die Schlafsituation passt nicht zum Inserat: Schlafzimmer 2 ist nicht zu erkennen, Schlafzimmer 3 ist ein leerer Raum.': 'The photos are bright and tidy but technically mediocre. The sleeping setup doesn’t match the listing: bedroom 2 can’t be recognised, bedroom 3 is an empty room.',
    'Foto-Note 64 von 100 (KI-Analyse aller 20 Fotos): flaues Licht, schiefe Winkel, mehrere Hochformate': 'Photo grade 64 of 100 (AI analysis of all 20 photos): flat light, crooked angles, several portrait shots',
    'Titelbild (Foto 6, Wohnzimmer) nur „mittel“: grau und leer. Foto 10 ist deutlich heller (4,25 von 5).': 'Cover photo (photo 6, living room) only “medium”: grey and empty. Photo 10 is much brighter (4.25 of 5).',
    'Schlafzimmer 3: Foto 4 zeigt einen leeren Raum ohne Bett und ohne Schlafcouch': 'Bedroom 3: photo 4 shows an empty room with no bed and no sofa bed',
    'Schlafzimmer 2 mit zwei Einzelbetten ist auf keinem Foto zu erkennen, Foto 2 zeigt ein Doppelbett': 'Bedroom 2 with two single beds can’t be recognised in any photo, photo 2 shows a double bed',
    'Innenhof (Foto 9): Beton, Unkraut, keine Möbel. Schwächstes Foto der Tour.': 'Courtyard (photo 9): concrete, weeds, no furniture. The weakest photo in the tour.',
    'Die Fotos 3, 4, 7, 8, 14, 15 und 20 sind Wiederholungen oder unattraktiv': 'Photos 3, 4, 7, 8, 14, 15 and 20 are repetitions or unattractive',
    '„Schlafzimmer 3“: Foto 4 zeigt einen leeren Raum ohne Bett und ohne Schlafcouch': '“Bedroom 3”: photo 4 shows an empty room with no bed and no sofa bed',
    'Das Inserat nennt „Privater Innenhof oder Balkon“, Foto 9 zeigt einen unmöblierten Betonhof': 'The listing says “private courtyard or balcony”, photo 9 shows an unfurnished concrete courtyard',
    'Gästezahl und zwei Merkmale. Spricht Gruppen an. Ohne „Balkon“, weil der Innenhof auf den Fotos keiner ist.': 'Guest count and two features. Appeals to groups. Without “balcony”, because the courtyard in the photos isn’t one.',
    'Wir haben „Balkon“ bewusst weggelassen: Foto 9 zeigt einen unmöblierten Innenhof.': 'We deliberately left out “balcony”: photo 9 shows an unfurnished courtyard.',
    'Gäste scannen die Tour nach Räumen. 15 von 20 Fotos sind keinem Raum zugeordnet, und die KI-Analyse findet Wiederholungen, schiefe Winkel und unattraktive Motive.': 'Guests scan the tour for rooms. 15 of 20 photos aren’t assigned to a room, and the AI analysis finds repetitions, crooked angles and unattractive shots.',
    'Räume anlegen und Fotos zuordnen. Die Fotos 3, 7, 8, 14, 15 und 20 streichen. Titelbild prüfen: Foto 10 ist heller als Foto 6. Danach die Reihenfolge aus dem Foto-Check übernehmen.': 'Create rooms and assign photos. Remove photos 3, 7, 8, 14, 15 and 20. Check the cover: photo 10 is brighter than photo 6. Then take the order from the photo check.',
    'Schlafzimmer 2 und 3 frisch bezogen neu fotografieren': 'Re-shoot bedrooms 2 and 3 with fresh bedding',
    'Foto 4 zeigt für Schlafzimmer 3 einen leeren Raum, Schlafzimmer 2 ist auf keinem Foto zu erkennen. Gäste prüfen, wo sie schlafen.': 'Photo 4 shows an empty room for bedroom 3, bedroom 2 can’t be recognised in any photo. Guests check where they will sleep.',
    'Betten beziehen, die Schlafcouch aufbauen und bei eingeschaltetem Licht im Querformat aus der Tür fotografieren. Danach Foto 4 ersetzen.': 'Make the beds, set up the sofa bed and shoot from the doorway in landscape with the lights on. Then replace photo 4.',
    'Innenhof aufräumen und neu fotografieren': 'Tidy the courtyard and re-shoot it',
    'Foto 9 ist das schwächste der Tour: Unkraut, Beton, keine Möbel. Der Hof wird als „Balkon“ geführt.': 'Photo 9 is the weakest in the tour: weeds, concrete, no furniture. The courtyard is listed as a “balcony”.',
    'Unkraut entfernen, Fassade abwaschen, zwei Stühle und Pflanzen hinstellen und neu fotografieren. Bis dahin Foto 9 aus der Tour nehmen.': 'Remove the weeds, wash the facade, put out two chairs and plants and re-shoot. Until then take photo 9 out of the tour.',
    '1 bis 2 Std': '1 to 2 hrs', '„Schlafzimmer 3“ mit Schlafcouch': '“Bedroom 3” with sofa bed',
    'Foto 4 zeigt einen leeren Raum ohne Bett und ohne Schlafcouch.': 'Photo 4 shows an empty room with no bed and no sofa bed.',
    'Schlafcouch aufbauen und neu fotografieren oder das Zimmer ehrlich benennen.': 'Set up the sofa bed and re-shoot, or name the room honestly.',
    'Ausstattung: „Privater Innenhof oder Balkon“': 'Amenity: “Private courtyard or balcony”', 'Foto 9 zeigt einen betonierten Innenhof mit Unkraut und ohne Möbel.': 'Photo 9 shows a concrete courtyard with weeds and no furniture.',
    'Nicht als Balkon bewerben. Hof aufräumen und möblieren.': 'Don’t advertise it as a balcony. Tidy and furnish the courtyard.', 'Note C+': 'Grade C+',
  });
  /* Vorschau-Karte oben: Score aus den Daten */
  const sc = D_.cats.reduce((t, c) => t + (c.w && c.base != null ? c.base * c.w : 0), 0), n = Math.round(sc), g2 = n >= 92 ? 'A' : n >= 88 ? 'A–' : n >= 84 ? 'B+' : n >= 78 ? 'B' : n >= 72 ? 'B–' : n >= 66 ? 'C+' : n >= 60 ? 'C' : n >= 50 ? 'D' : 'F';
  const peek = document.querySelector('.peek'); if (peek) {
    const nodes = []; const w = document.createTreeWalker(peek, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode())) nodes.push(t);
    nodes.forEach((x) => { const v = x.nodeValue.trim(); if (v === '72') { x.nodeValue = String(n); try { _nodes.forEach((o) => { if (o.n === x) o.de = String(n); }); } catch (e) { } } if (v === 'Note B–') { x.nodeValue = 'Note ' + g2; try { _nodes.forEach((o) => { if (o.n === x) o.de = 'Note ' + g2; }); } catch (e) { } } });
    const ring = peek.querySelector('circle[stroke-dashoffset]'); if (ring) ring.setAttribute('stroke-dashoffset', (364.4 * (1 - n / 100)).toFixed(1));
    if (g2 !== 'C+') EN['Note ' + g2] = 'Grade ' + g2;
    try { _nodes.forEach((x) => { if (x.n && peek.contains(x.n)) { if (x.de === '72') x.de = String(n); if (x.de === 'Note B–') x.de = 'Note ' + g2; } }); applyStatic(); } catch (e) { }
  }
})();

// Live-Report: lädt den Befund-Motor-Report in die Seite und ersetzt die Beispieldaten.
(() => {
  'use strict';
  const DEMO_ID = '1175211811818785379', POLL = () => window.LIVE_POLL_MS || 5000;
  const idOf = (u) => (String(u).match(/rooms\/(\d{6,})/) || [])[1];
  const DEMO_D = JSON.parse(JSON.stringify(D)), SCAN_HTML = $('#scan').innerHTML;
  Object.assign(EN, {
    'Inserat lesen': 'Reading the listing', 'Fotos mit KI analysieren': 'Analysing photos with AI', 'Befunde erstellen': 'Creating the findings',
    'Live-Report für deinen Link. KI-Analyse aus öffentlichen Daten, Fehler sind möglich.': 'Live report for your link. AI analysis from public data, mistakes are possible.',
    'Elev8 Listing Health · KI-Analyse aus öffentlichen Daten. Fehler sind möglich, der Experte prüft jeden Befund im Call.': 'Elev8 Listing Health · AI analysis from public data. Mistakes are possible, the expert reviews every finding on the call.',
    'Das hat nicht geklappt': 'That didn’t work', 'Zurück': 'Back',
    'Aus den öffentlichen Daten lesen wir Signale für die Sichtbarkeit. Preis, Belegung und Markt brauchen Buchungsdaten.': 'From the public data we read visibility signals. Price, occupancy and market need booking data.',
    'Mit Elev8-Konto vergleichen wir Preis, Belegung und Regeln mit dem Markt im Umkreis.': 'With an Elev8 account we compare price, occupancy and rules with the market nearby.',
    'Titel, Beschreibung, Ausstattung, Fotos und Bewertungen im Volltext.': 'Title, description, amenities, photos and reviews in full text.',
    'Wie liegt dein Preis im Vergleich zum Umkreis?': 'How does your price compare to the area?', 'Welche Inserate verdienen am meisten und warum?': 'Which listings earn the most, and why?',
    'Du hast diese Woche schon drei Analysen genutzt, oder heute sind alle vergeben. Buche einen Demo-Call, dann prüfen wir dein Inserat.': 'You have already used three analyses this week, or all of today’s are taken. Book a demo call and we’ll check your listing.',
    'Das Inserat konnte nicht gelesen werden': 'The listing could not be read', 'Das Lesen des Inserats dauert zu lange': 'Reading the listing takes too long', 'Die Foto-Analyse dauert zu lange': 'The photo analysis takes too long',
    'Foto-Analyse fehlgeschlagen': 'Photo analysis failed', 'Die KI-Antwort war nicht lesbar': 'The AI response was not readable', 'Die Analyse ist nicht möglich.': 'The analysis is not possible.', 'Die Analyse dauert zu lange. Bitte später erneut versuchen.': 'The analysis takes too long. Please try again later.',
    '{0} Zeichen': '{0} characters', 'So liest sich das Inserat heute.': 'This is how the listing reads today.',
  });
  function normalizeOverall(res) {
    const a = res && res.analysis; if (!a || !Array.isArray(a.photos) || a._norm) return;
    const ok = a.photos.filter((p) => [p.brightness, p.sharpness, p.composition, p.tidiness].every(Number.isFinite)); if (!ok.length) return;
    const s = Math.round(ok.reduce((t, p) => t + (p.brightness + p.sharpness + p.composition + p.tidiness) / 4, 0) / ok.length * 20);
    a.overall = { ...(a.overall || {}), score: s, grade: gradeOf(s) }; a._norm = true;
  }
  const _renderLive = renderLive; renderLive = function () { if (state.live && state.live.res) normalizeOverall(state.live.res); return _renderLive(); };
  const hide = (ids, on) => ids.forEach((i) => { const e = document.getElementById(i); if (e) e.classList.toggle('hidden', on); });

  function resetDemo() {
    if (!state.reportLive) return;
    for (const k of Object.keys(DEMO_D)) D[k] = JSON.parse(JSON.stringify(DEMO_D[k]));
    state.reportLive = false; state.done = new Set(); state.shown = 0; state.titleSel = 'B'; state.live = null; state.openKey = null;
    $('.demo').classList.remove('hidden'); hide(['wettbewerb', 'kanaele'], false); $('#liveNote') && $('#liveNote').remove();
    $('#urlHelp').textContent = T('Beispiel-Report mit echten Daten vom 21.10.2026. Beliebige Links live auszuwerten startet mit der Live-Anbindung.');
  }

  function applyReport(r, photoCheck) {
    state.reportLive = true; state.mode = 'prospect'; $$('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === 'prospect'));
    D.listing = r.listing; D.cats = r.cats; D.actions = r.actions; D.titles = r.titles; D.descAfter = r.descAfter; D.descBeforeText = r.descBefore; D.fluff = r.fluff || [];
    D.gaps = r.gaps; D.vis = r.vis; D.ratings = r.ratings;
    D.sources = D.sources.map((s) => s.id === 'airbnb' ? { ...s, what: 'Titel, Beschreibung, Ausstattung, Fotos und Bewertungen im Volltext.' }
      : s.id === 'market' ? { ...s, s: 'lock', what: 'Preis- und Belegungsvergleich mit dem Umkreis.', unlocks: ['Wie liegt dein Preis im Vergleich zum Umkreis?', 'Welche Inserate verdienen am meisten und warum?'] } : s);
    state.done = new Set(); state.shown = 0; state.titleSel = r.recommendedTitle || 'cur'; state.openKey = null; state.clicks = new Set();
    normalizeOverall(photoCheck); const pc = D.cats.find((c) => c.id === 'photos'); if (pc && photoCheck.analysis.overall && Number.isFinite(photoCheck.analysis.overall.score)) pc.base = Math.min(95, photoCheck.analysis.overall.score);
    const sugg = liveOrders(photoCheck); state.live = { status: 'done', res: photoCheck, sugg, order: sugg.slice(), touched: false };
    $('.demo').classList.add('hidden'); hide(['wettbewerb', 'kanaele'], true); $('#photoView').classList.add('hidden');
    $('#urlHelp').textContent = T('Live-Report für deinen Link. KI-Analyse aus öffentlichen Daten, Fehler sind möglich.');
    $('footer p').textContent = T('Elev8 Listing Health · KI-Analyse aus öffentlichen Daten. Fehler sind möglich, der Experte prüft jeden Befund im Call.');
    if (!$('#liveNote')) $('#banner').insertAdjacentHTML('afterend', `<div class="note info" id="liveNote"><div>${esc(T('Live-Report für deinen Link. KI-Analyse aus öffentlichen Daten, Fehler sind möglich.'))}</div></div>`);
  }

  /* Scan-Ablauf mit echtem Fortschritt */
  const STEPS = ['Inserat lesen', 'Fotos mit KI analysieren', 'Befunde erstellen'], STEP_IX = { scrape: 0, photos: 1, report: 2 };
  async function liveReport(url) {
    const form = $('#checkForm'), sc = $('#scan'); form.classList.add('hidden'); sc.classList.add('on');
    sc.innerHTML = `<h3 style="margin-bottom:14px">${T('Dein Inserat wird geprüft')}</h3><ol id="scanList">${STEPS.map((s) => `<li><span class="dot">${ico('check')}</span><span>${esc(T(s))}</span></li>`).join('')}</ol>`;
    const lis = () => $$('#scanList li'), mark = (ix) => lis().forEach((li, i) => { li.className = i < ix ? 'ok' : i === ix ? 'run' : ''; });
    const fail = (msg) => { sc.innerHTML = `<h3 style="margin-bottom:10px">${T('Das hat nicht geklappt')}</h3><div class="note warn"><div>${esc(T(msg))}</div></div><div class="row2"><a class="btn primary" data-book href="#">${T('Demo-Call buchen')}</a><button class="btn ghost" type="button" id="scanBack">${T('Zurück')}</button></div>`; bindBook(); $('#scanBack').onclick = () => { sc.classList.remove('on'); sc.innerHTML = SCAN_HTML; form.classList.remove('hidden'); }; };
    mark(0);
    for (let i = 0; i < 170; i++) {
      let r, j; try { r = await fetch(`/api/report?url=${encodeURIComponent(url)}&lang=${state.lang}`); j = await r.json(); } catch (e) { return fail('Keine Verbindung. Bitte später erneut versuchen.'); }
      if (r.status === 200 && j.status === 'done') { mark(3); applyReport(j.report, j.photoCheck); sc.classList.remove('on'); sc.innerHTML = SCAN_HTML; form.classList.remove('hidden'); return reveal(); }
      if (r.status === 202) { mark(STEP_IX[j.step] ?? 0); await new Promise((ok) => setTimeout(ok, POLL())); continue; }
      return fail(j.error || 'Die Analyse ist nicht möglich.');
    }
    fail('Die Analyse dauert zu lange. Bitte später erneut versuchen.');
  }

  /* Weichen: Beispiel-Inserat bleibt der kuratierte Report, alle anderen Links laufen live */
  const _runScan = runScan, _liveStart = liveStart;
  runScan = function () {
    const url = $('#inUrl').value.trim(), id = idOf(url);
    if (!id || id === DEMO_ID) { resetDemo(); return _runScan(); }
    resetDemo(); return liveReport(url);
  };
  liveStart = function () { const id = idOf($('#inUrl').value); if (id && id !== DEMO_ID) return; resetDemo(); return _liveStart(); };

  /* Teile, die an die Beispieldaten gebunden waren */
  const _renderMarket = renderMarket, _renderComp = renderComp, _renderChannel = renderChannel;
  renderMarket = function () {
    if (!state.reportLive) return _renderMarket();
    $('#marketSub').textContent = T('Aus den öffentlichen Daten lesen wir Signale für die Sichtbarkeit. Preis, Belegung und Markt brauchen Buchungsdaten.');
    $('#market').innerHTML = `<h3 style="margin-bottom:10px">${T('Sichtbarkeits-Signale')}</h3><div class="vis" style="margin-bottom:14px">${D.vis.map(([l, k, s]) => `<span class="chip ${k}">${esc(T(l))} · ${esc(T(s))}</span>`).join('')}</div>` + lockBox(T('Mit Elev8-Konto vergleichen wir Preis, Belegung und Regeln mit dem Markt im Umkreis.'));
  };
  renderComp = function () { if (state.reportLive) return; return _renderComp(); };
  renderChannel = function () { if (state.reportLive) return; return _renderChannel(); };

  renderStudio = function () {
    const items = titleItems(); if (!items.find((i) => i.id === state.titleSel)) state.titleSel = (D.titles.find((t) => t.rec) || { id: 'cur' }).id;
    $('#titleTabs').innerHTML = items.map((i) => `<button type="button" role="tab" data-title="${i.id}" aria-selected="${state.titleSel === i.id}">${esc(T(i.label))}${i.rec ? ' ★' : ''}</button>`).join('');
    const it = items.find((i) => i.id === state.titleSel), len = [...it.text].length;
    $('#titleView').innerHTML = `<div class="scard"><div class="img">${ico('home')}</div><div class="tx"><span class="t2">${T('Wohnung in {0}', esc(D.listing.city || ''))}</span><span class="t1">${esc(it.text)}</span><span class="t2">${D.listing.rating != null ? '★ ' + dec(D.listing.rating) + ' (' + D.listing.reviews + ')' : ''}</span></div></div>
      <div><span class="counter ${len > 50 ? 'over' : ''}">${T('{0} / 50 Zeichen', len)}</span><p class="sub" style="margin-top:6px">${esc(T(it.note || ''))}</p></div>
      <div class="row2">${it.id !== 'cur' ? `<button class="btn sm primary" type="button" data-open="apply:a1">${ico('link')}${T('In OTAs übernehmen')}</button><button class="btn sm dark" type="button" data-copytitle="${it.id}">${ico('copy')}${T('Titel kopieren')}</button>` : ''}<button class="btn sm ghost ${state.aiOk ? '' : 'hidden'}" type="button" id="aiBtn">${ico('sparkles')}${T('Mehr Ideen (KI)')}</button></div>`;
    $('#descTabs').innerHTML = [['before', 'Vorher'], ['after', 'Nachher']].map(([k, l]) => `<button type="button" role="tab" data-desc="${k}" aria-selected="${state.descSel === k}">${T(l)}</button>`).join('');
    if (state.descSel === 'before') {
      const txt = state.reportLive ? (D.descBeforeText || '') : D.descBefore, fl = (state.reportLive ? D.fluff : ['exquisit', 'einzigartig', 'unvergesslich', 'Jetzt buchen']).filter(Boolean);
      let h = esc(txt); if (state.reportLive && fl.length) { const re = new RegExp(fl.map((f) => esc(f).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi'); h = h.replace(re, (m) => `<mark>${m}</mark>`); }
      else if (!state.reportLive) h = h.replace(/exquisit\w*|einzigartig\w*|unvergesslich\w*|Jetzt buchen/g, (m) => `<mark>${m}</mark>`);
      const n = state.reportLive ? (h.match(/<mark>/g) || []).length : (D.descBefore.match(/exquisit\w*|einzigartig\w*|unvergesslich\w*|Jetzt buchen/g) || []).length;
      $('#descView').innerHTML = `<div class="desc">${h}</div><div class="row2"><span class="chip ${n ? 'bad' : ''}">${T('{0} Werbefloskeln', n)}</span>${state.reportLive ? `<span class="chip">${T('{0} Zeichen', [...txt].length)}</span>` : `<span class="chip bad">${T('0 Ausstattungen')}</span><span class="chip bad">${T('Kein Lärmhinweis')}</span>`}</div><p class="small">${state.reportLive ? T('So liest sich das Inserat heute.') : T('Sinngemäss nachgestellt. Das Original hat 461 Zeichen und dieselbe Struktur.')}</p>`;
    } else {
      $('#descView').innerHTML = `<div class="desc">${esc(D.descAfter)}</div><div class="row2">${state.reportLive ? `<span class="chip good">${T('{0} Zeichen', [...D.descAfter].length)}</span>` : `<span class="chip good">${T('7 konkrete Angaben')}</span><span class="chip good">${T('Ehrlicher Lärmhinweis')}</span>`}</div><div class="row2"><button class="btn sm primary" type="button" data-open="apply:a2">${ico('link')}${T('In OTAs übernehmen')}</button><button class="btn sm dark" type="button" data-copydesc>${ico('copy')}${T('Text kopieren')}</button></div><p class="small">${state.reportLive ? T('Text in [eckigen Klammern] nur übernehmen, wenn er stimmt.') : T('Die Klammer am Ende nur übernehmen, wenn Ohrstöpsel und Ventilator wirklich bereitliegen.')}</p>`;
    }
  };
  EN['Text in [eckigen Klammern] nur übernehmen, wenn er stimmt.'] = 'Only keep text in [square brackets] if it is true.';
})();
