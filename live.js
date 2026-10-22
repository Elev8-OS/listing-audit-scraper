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
