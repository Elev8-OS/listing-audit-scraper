// Ergänzungen für Live-Reports: Titelbild, Markt (nur Airbnb), Wettbewerb, Leerzustand der Widersprüche, lebendige Vorschau-Karte.
(() => {
  'use strict';
  Object.assign(EN, {
    'Du': 'You', 'Inserat': 'Listing', 'Gäste': 'guests', 'Schlafzimmer': 'bedrooms', 'Median': 'Median', 'Ja': 'Yes', 'Nein': 'No', 'Nächte': 'nights', 'Nacht': 'night',
    'Zwischen Inserat und Daten haben wir keinen klaren Widerspruch gefunden.': 'We found no clear contradiction between the listing and the data.',
    'Airbnb-Schätzung für dein Inserat, daneben der Markt im Umkreis.': 'Airbnb estimate for your listing, next to the market nearby.',
    'Ø-Preis pro Nacht, geschätzt': 'Average price per night, estimated', 'Belegung, geschätzt (12 Monate)': 'Occupancy, estimated (12 months)', 'Umsatz, geschätzt (12 Monate)': 'Revenue, estimated (12 months)',
    'Preis pro Nacht im Umkreis': 'Price per night nearby', 'Belegung im Umkreis': 'Occupancy nearby', 'Umsatz pro Jahr im Umkreis': 'Revenue per year nearby',
    '<b>Was wir sehen:</b> Dein Preis pro Nacht liegt über {0} % der Vergleichsinserate, deine Belegung über {1} % und dein Umsatz über {2} %. {3}': '<b>What we see:</b> Your price per night is above {0} % of the comparable listings, your occupancy above {1} % and your revenue above {2} %. {3}',
    'Hoher Preis bei geringer Belegung: Preis oder Regeln bremsen vermutlich.': 'High price with low occupancy: price or rules are probably holding you back.',
    'Hohe Belegung bei tiefem Preis: Hier liegt vermutlich Spielraum nach oben.': 'High occupancy at a low price: there is probably room to raise the price.',
    'Beim Umsatz liegt Luft nach oben. Der Experte prüft Preis, Regeln und Saison im Call.': 'There is room to grow in revenue. The expert reviews price, rules and season on the call.',
    'Preis und Belegung liegen im Mittelfeld oder darüber.': 'Price and occupancy are mid-field or above.',
    'Quelle: Airbnb-Daten, Schätzung für die letzten 12 Monate bei {0} ganzen Unterkünften im Umkreis. Mit Elev8-Konto ersetzen echte Buchungsdaten die Schätzung.': 'Source: Airbnb data, estimate for the last 12 months across {0} entire homes nearby. With an Elev8 account real booking data replaces the estimate.',
    'Regeln im Vergleich': 'Rules compared', 'Merkmal': 'Feature', 'Dein Inserat': 'Your listing', 'Umkreis': 'Area',
    'Mindestaufenthalt': 'Minimum stay', 'Stornierung': 'Cancellation', 'Reinigungsgebühr': 'Cleaning fee', 'Ausstattungen': 'Amenities', 'Guest Favorite': 'Guest Favorite',
    '{0} von {1} umsatzstärksten: höchstens 2 Nächte': '{0} of the top {1} by revenue: 2 nights at most', '{0} von {1} umsatzstärksten: flexible Stornierung': '{0} of the top {1} by revenue: flexible cancellation',
    'Median {0} der umsatzstärksten': 'Median {0} of the top earners', 'Median {0}': 'Median {0}', '{0} von {1} umsatzstärksten sind Guest Favorite': '{0} of the top {1} by revenue are Guest Favorites',
    'Geschätzter Umsatz (12 Monate)': 'Estimated revenue (12 months)', 'Ø-Preis pro Nacht': 'Average price per night', 'Belegung': 'Occupancy', 'Bewertung': 'Rating',
    '<b>Was auffällt:</b> Das umsatzstärkste Inserat erzielt etwa {0} im Jahr bei {1} Belegung und {2} pro Nacht. Mindestaufenthalt: {3}, Stornierung: {4}.': '<b>What stands out:</b> The top-earning listing makes about {0} a year at {1} occupancy and {2} per night. Minimum stay: {3}, cancellation: {4}.',
    'Schätzungen aus Airbnb-Daten, 12 Monate, ganze Unterkünfte im Umkreis. Die Namen der Inserate zeigen wir nicht.': 'Estimates from Airbnb data, 12 months, entire homes nearby. We don’t show the names of the listings.',
    'Flexibel': 'Flexible', 'Moderat': 'Moderate', 'Streng': 'Strict', 'Fest': 'Firm', 'Sehr streng': 'Super strict',
  });
  let MK = null;
  const _f = window.fetch;
  window.fetch = async function (u) {
    const r = await _f.apply(this, arguments);
    try {
      if (String(u).indexOf('/api/report') === 0) {
        if (PK.mode === 'demo' || PK.mode === 'final') { PK.mode = 'live'; PK.pv = null; renderPeek(); }
        const j = JSON.parse(await r.clone().text());
        if (r.status === 200 && j && j.report) { MK = j.report.market || null; }
        else if (r.status === 202) { PK.pv = j.preview || null; renderPeek(); }
        else if (r.status >= 400) { PK.mode = 'demo'; renderPeek(); }
      }
    } catch (e) { }
    return r;
  };
  const mo = (v) => v == null ? '–' : (MK && MK.currency !== 'CHF') ? `${MK.currency} ${Math.round(v)}` : chf(v);
  const POL = { Flexible: 'Flexibel', Moderate: 'Moderat', Firm: 'Fest', Strict: 'Streng', 'Super Strict 30': 'Sehr streng', 'Super Strict 60': 'Sehr streng' };
  const pol = (p) => p ? T(POL[p] || p) : '–';
  const nn = (n) => n == null ? '–' : n === 1 ? `1 ${T('Nacht')}` : `${n} ${T('Nächte')}`;
  const live = () => state.reportLive && MK && MK.you;

  /* Vorschau-Karte oben: füllt sich während der Prüfung mit echten Daten */
  const PK = { mode: 'demo', pv: null }, DN = Math.round(D.cats.reduce((t, c) => t + (c.w && c.base != null ? c.base * c.w : 0), 0));
  const clip = (t, n) => { t = String(t || '').split(/(?<=[.!?])\s/)[0]; return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; };
  function renderPeek() {
    const p = document.querySelector('.peek'); if (!p) return;
    const head = p.querySelector(':scope > div:first-child > div:last-child'), ring = p.querySelector('circle[stroke-dashoffset]'), num = p.querySelector('.ringbox .mid b'), rows = [...p.querySelectorAll('.row')];
    if (!head || !ring || !num) return;
    const en = state.lang === 'en', pv = PK.pv || {}, m = PK.mode, fx = (n) => String(n).replace('.', en ? '.' : ',');
    const put = (i, g, cls, b, s) => { const r = rows[i]; if (!r) return; const ge = r.querySelector('.grade'), be = r.querySelector('b'), se = r.querySelector('p.small'); ge.textContent = g; ge.className = 'grade ' + cls; be.textContent = b; se.textContent = s; };
    const top = (n, h, s, off) => { num.textContent = n; head.querySelector('b').textContent = h; head.querySelector('p').textContent = s; ring.setAttribute('stroke-dashoffset', (364.4 * (1 - off)).toFixed(1)); };
    if (m === 'demo') {
      top(String(DN), T('Note ' + gradeOf(DN)), T('Reviews stark, Titel schwach'), DN / 100);
      put(0, 'D', 'g-bad', T('Titel'), T('Keine Amenity, falsche Lage')); put(1, 'C+', 'g-warn', T('Beschreibung'), T('0 von 49 Amenities genannt')); put(2, 'A–', 'g-good', T('Reviews'), T('4,88 ★ aus 24 Bewertungen'));
    } else if (m === 'live') {
      const wait = en ? 'Reading …' : 'Wird gelesen …', prog = pv.photoScore != null ? .7 : pv.title ? .4 : .12;
      top('…', en ? 'Checking …' : 'Wird geprüft …', pv.photoScore != null ? (en ? `Photo grade ${pv.photoScore}/100` : `Foto-Note ${pv.photoScore}/100`) : pv.photos != null ? (en ? `${pv.photos} photos read` : `${pv.photos} Fotos gelesen`) : (en ? 'Your listing' : 'Dein Inserat'), prog);
      put(0, '…', 'g-mid', en ? 'Title' : 'Titel', pv.title ? clip(pv.title, 46) : wait);
      put(1, '…', 'g-mid', en ? 'Description' : 'Beschreibung', pv.amenities != null ? (en ? `${pv.amenities} amenities listed · ${pv.descChars} characters of text` : `${pv.amenities} Ausstattungen · ${pv.descChars} Zeichen Text`) : wait);
      put(2, pv.rating != null ? '★' : '…', 'g-mid', 'Reviews', pv.rating != null ? (en ? `${fx(Number(pv.rating).toFixed(2))} ★ from ${pv.reviews} reviews` : `${fx(Number(pv.rating).toFixed(2))} ★ aus ${pv.reviews} Bewertungen`) : wait);
    } else if (m === 'final' && state.reportLive) {
      const cs = D.cats.filter((c) => c.base != null), n = Math.round(cs.reduce((t, c) => t + c.base * c.w, 0)), best = cs.slice().sort((a, b) => b.base - a.base)[0], worst = cs.slice().sort((a, b) => a.base - b.base)[0];
      top(String(n), (en ? 'Grade ' : 'Note ') + gradeOf(n), en ? `${best.name} strong, ${worst.name} weak` : `${best.name} stark, ${worst.name} schwach`, n / 100);
      ['title', 'desc', 'reviews'].forEach((id, i) => { const c = D.cats.find((x) => x.id === id); if (c) put(i, gradeOf(c.base), gcls(c.base), c.name, clip(c.finding, 58)); });
    }
  }
  const _rv = reveal; reveal = function () { _rv(); PK.mode = state.reportLive ? 'final' : 'demo'; renderPeek(); };
  const _sl = setLang; setLang = function (l) { _sl(l); renderPeek(); };

  /* Titelbild in der Vorschau */
  const _rs = renderStudio;
  renderStudio = function () {
    _rs();
    const L = state.live && state.live.res; if (!L) return;
    const u = L.coverUrl ? String(L.coverUrl).split('?')[0] + '?im_w=720' : (L.photos && L.photos[0] && L.photos[0].thumb), el = $('#titleView .scard .img');
    if (u && el) el.innerHTML = `<img src="${esc(u)}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;display:block">`;
  };

  /* Widersprüche: nie leer */
  const _rg = renderGap;
  renderGap = function () {
    _rg();
    if (!D.gaps || !D.gaps.length) $('#gapList').innerHTML = `<div class="panel"><p>${T('Zwischen Inserat und Daten haben wir keinen klaren Widerspruch gefunden.')}</p></div>`;
  };

  /* Markt: nur Airbnb */
  const _rm = renderMarket;
  renderMarket = function () {
    if (!live()) return _rm();
    const M = MK, Y = M.you, r = M.rank, fmtP = (v) => pct(v), nz = (v) => v == null ? '–' : v;
    $('#marketSub').textContent = T('Airbnb-Schätzung für dein Inserat, daneben der Markt im Umkreis.');
    const kp = [[mo(Y.adr), T('Ø-Preis pro Nacht, geschätzt')], [pct(Y.occ), T('Belegung, geschätzt (12 Monate)')], [mo(Y.rev), T('Umsatz, geschätzt (12 Monate)')]];
    const vis = D.vis && D.vis.length ? `<h3 style="margin-bottom:10px">${T('Sichtbarkeits-Signale')}</h3><div class="vis" style="margin-bottom:18px">${D.vis.map(([l, k, s]) => `<span class="chip ${k}">${esc(T(l))} · ${esc(T(s))}</span>`).join('')}</div>` : '';
    const lad = (title, k, you, fmt) => ladder(T(title), [{ v: M.dist[k].p25, l: 'P25' }, { v: M.dist[k].p50, l: T('Median') }, { v: M.dist[k].p75, l: 'P75' }, { v: M.dist[k].p90, l: 'P90' }], [{ v: you, l: `${T('Du')} ${fmt(you)}`, k: 'e8' }], Math.max(M.dist[k].p90, you) * 1.1, fmt);
    const concl = r.adr >= 60 && r.occ < 40 ? 'Hoher Preis bei geringer Belegung: Preis oder Regeln bremsen vermutlich.' : r.adr < 40 && r.occ >= 60 ? 'Hohe Belegung bei tiefem Preis: Hier liegt vermutlich Spielraum nach oben.' : r.rev < 40 ? 'Beim Umsatz liegt Luft nach oben. Der Experte prüft Preis, Regeln und Saison im Call.' : 'Preis und Belegung liegen im Mittelfeld oder darüber.';
    const R = M.rules;
    $('#market').innerHTML = `${vis}<div class="kpis">${kp.map(([b, s]) => `<div class="kpi"><b>${b}</b><span>${s}</span></div>`).join('')}</div>
      ${lad('Preis pro Nacht im Umkreis', 'adr', Y.adr, mo)}${lad('Belegung im Umkreis', 'occ', Y.occ, fmtP)}${lad('Umsatz pro Jahr im Umkreis', 'rev', Y.rev, mo)}
      <div class="panel" style="margin:14px 0"><p>${T('<b>Was wir sehen:</b> Dein Preis pro Nacht liegt über {0} % der Vergleichsinserate, deine Belegung über {1} % und dein Umsatz über {2} %. {3}', nz(r.adr), nz(r.occ), nz(r.rev), T(concl))}</p></div>
      <h3 style="margin:22px 0 10px">${T('Regeln im Vergleich')}</h3>
      <table class="table"><thead><tr><th>${T('Merkmal')}</th><th>${T('Dein Inserat')}</th><th>${T('Umkreis')}</th></tr></thead><tbody>
      <tr><td>${T('Mindestaufenthalt')}</td><td>${nn(Y.minNights)}</td><td>${T('{0} von {1} umsatzstärksten: höchstens 2 Nächte', R.minNights2, R.n)}</td></tr>
      <tr><td>${T('Stornierung')}</td><td>${pol(Y.policy)}</td><td>${T('{0} von {1} umsatzstärksten: flexible Stornierung', R.flexible, R.n)}</td></tr>
      <tr><td>${T('Reinigungsgebühr')}</td><td>${mo(Y.cleaning)}</td><td>${T('Median {0} der umsatzstärksten', mo(R.cleaning))}</td></tr>
      <tr><td>${T('Ausstattungen')}</td><td>${nz(Y.amenities)}</td><td>${T('Median {0}', Math.round(R.amenities || 0))}</td></tr>
      <tr><td>Guest Favorite</td><td>${Y.gf ? T('Ja') : T('Nein')}</td><td>${T('{0} von {1} umsatzstärksten sind Guest Favorite', R.gf, R.n)}</td></tr></tbody></table>
      <p class="small" style="margin-top:10px">${T('Quelle: Airbnb-Daten, Schätzung für die letzten 12 Monate bei {0} ganzen Unterkünften im Umkreis. Mit Elev8-Konto ersetzen echte Buchungsdaten die Schätzung.', M.n)}</p>`;
  };

  /* Wettbewerb: die drei umsatzstärksten, ohne Namen */
  const _rc = renderComp;
  renderComp = function () {
    if (!state.reportLive) return _rc();
    const w = $('#wettbewerb'), ok = live() && MK.top && MK.top.length; w.classList.toggle('hidden', !ok); if (!ok) return;
    const T3 = MK.top, Y = MK.you, cols = [Object.assign({ me: 1, k: 'Du', sub: `${Y.guests || '–'} ${T('Gäste')} · ${Y.bedrooms || '–'} ${T('Schlafzimmer')}` }, Y)].concat(T3.map((c, i) => Object.assign({ k: `${T('Inserat')} ${'ABC'[i]}`, sub: `${c.guests || '–'} ${T('Gäste')} · ${c.bedrooms || '–'} ${T('Schlafzimmer')}` }, c)));
    const rows = [['Geschätzter Umsatz (12 Monate)', (c) => mo(c.rev)], ['Ø-Preis pro Nacht', (c) => mo(c.adr)], ['Belegung', (c) => pct(c.occ)], ['Mindestaufenthalt', (c) => nn(c.minNights)], ['Stornierung', (c) => pol(c.policy)], ['Reinigungsgebühr', (c) => mo(c.cleaning)], ['Guest Favorite', (c) => c.gf ? T('Ja') : T('Nein')], ['Bewertung', (c) => c.rating == null ? '–' : `${dec(c.rating)} (${c.reviews || 0})`]];
    const t1 = T3[0];
    $('#compView').innerHTML = `<div class="scroll"><table class="cmp"><thead><tr><th></th>${cols.map((c) => `<th class="${c.me ? 'me' : ''}">${esc(T(c.k))}<br><span class="small">${esc(c.sub)}</span></th>`).join('')}</tr></thead><tbody>${rows.map(([l, f]) => `<tr><td><b>${T(l)}</b></td>${cols.map((c) => `<td class="${c.me ? 'me' : ''}">${f(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="panel" style="margin-top:14px"><p>${T('<b>Was auffällt:</b> Das umsatzstärkste Inserat erzielt etwa {0} im Jahr bei {1} Belegung und {2} pro Nacht. Mindestaufenthalt: {3}, Stornierung: {4}.', mo(t1.rev), pct(t1.occ), mo(t1.adr), nn(t1.minNights), pol(t1.policy))}</p></div>
      <p class="small" style="margin-top:8px">${T('Schätzungen aus Airbnb-Daten, 12 Monate, ganze Unterkünfte im Umkreis. Die Namen der Inserate zeigen wir nicht.')}</p>`;
  };
})();
