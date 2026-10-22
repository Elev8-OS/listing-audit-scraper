/* Lead-Gate nach dem Scan: Befunde frei, Details gegen E-Mail. Messung, Freischaltung, PDF-Modus und klickbare PDF-Links. */
(() => {
  'use strict';
  const PDFMODE = /[?&]pdf=1(&|$)/.test(location.search), Q = new URLSearchParams(location.search);
  const L = (de, en) => (state.lang === 'en' ? en : de);
  const G = { unlocked: PDFMODE, id: null, mk: null, token: Q.get('k') || null, scanned: false, viewed: false };
  try { if (sessionStorage.getItem('lh_unlocked') === '1') G.unlocked = true; } catch (e) { }
  let sid = ''; try { sid = sessionStorage.getItem('lh_sid') || ''; if (!sid) { sid = Math.random().toString(36).slice(2, 12); sessionStorage.setItem('lh_sid', sid); } } catch (e) { sid = Math.random().toString(36).slice(2, 12); }
  const ev = (e, o = {}) => { if (PDFMODE) return; try { const b = JSON.stringify({ e, sid, id: G.id || undefined, lang: state.lang, ...o }); if (navigator.sendBeacon) navigator.sendBeacon('/api/event', new Blob([b], { type: 'application/json' })); else fetch('/api/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: b, keepalive: true }); } catch (x) { } };
  const gated = () => !G.unlocked && state.reportLive && state.mode === 'prospect';

  /* Daten aus der Report-Abfrage mitlesen */
  const _f = window.fetch;
  window.fetch = async function (u) {
    const r = await _f.apply(this, arguments);
    try {
      if (String(u).indexOf('/api/report') === 0) {
        if (!G.scanned) { G.scanned = true; ev('scan_start'); }
        if (r.status === 200) { const j = JSON.parse(await r.clone().text()); if (j && j.id) { G.id = j.id; G.mk = (j.report && j.report.market) || null; } }
        else if (r.status >= 400) { G.scanned = false; ev('scan_error', { zone: String(r.status) }); }
      }
    } catch (e) { }
    return r;
  };

  /* Stil */
  const css = document.createElement('style'); css.id = 'gateCss';
  css.textContent = `
.gate{margin:28px 0;border:2px solid #0A0A0A;border-radius:22px;padding:clamp(20px,3.4vw,34px);background:linear-gradient(180deg,var(--ysoft,#FEF4D6),var(--card,#fff) 70%);display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:26px;align-items:center;box-shadow:0 10px 40px -18px rgba(0,0,0,.35)}
@media(max-width:820px){.gate{grid-template-columns:1fr}}
.gate h2{font-size:clamp(1.5rem,3.4vw,2.2rem);letter-spacing:-.035em;line-height:1.05;margin:0 0 8px;font-weight:800}
.gate p{margin:0 0 10px;color:var(--ink2,#4B4B47)}
.gate .money{font-weight:800;letter-spacing:-.03em;font-size:1.25rem;color:var(--ink,#0A0A0A)}
.gate .money i{font-style:normal;filter:blur(7px);user-select:none;display:inline-block}
.gate ul{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:6px;font-size:.93rem}.gate li{display:flex;gap:8px;align-items:flex-start}.gate li::before{content:"";flex:none;width:7px;height:7px;border-radius:50%;background:var(--y,#F6BB12);margin-top:.5em}
.gate form{display:grid;gap:10px}.gate input[type=email]{min-height:50px;border:1.5px solid var(--line,#E6E6E1);border-radius:14px;padding:0 16px;font:inherit;background:var(--bg,#fff);color:var(--ink,#0A0A0A)}
.gate input[type=email]:focus{outline:none;border-color:var(--ink,#0A0A0A);box-shadow:0 0 0 4px rgba(246,187,18,.3)}
.gate .gcons{display:flex;gap:9px;align-items:flex-start;font-size:.8rem;color:var(--ink3,#85857F);line-height:1.4}.gate .gcons input{margin-top:.2em;flex:none}
.gate .err{color:var(--bad,#B3261E);font-size:.86rem;min-height:1.2em}
.gate.done{grid-template-columns:1fr;border-color:var(--good,#14803F);background:var(--goodbg,#E5F4EA)}
.lockcard{margin:12px 0;border:1.5px dashed var(--ink3,#85857F);border-radius:16px;padding:16px 18px;display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap;cursor:pointer}
html:not(.gated) .lockcard{display:none}
html.gated #planList>:nth-child(n+4){display:none!important}
html.gated #planList .body,html.gated #planList .btn,html.gated #filters,html.gated #dlPlan,html.gated #dlPlan2{display:none!important}
html.gated #compView>*,html.gated #liveFoto #lgrid,html.gated #market .kpis,html.gated #market .ladder,html.gated #market table,html.gated #gapList>:nth-child(n+2),html.gated #descView[data-after="1"] .desc{filter:blur(7px);pointer-events:none;user-select:none}
html.gated #liveFoto [data-applysuggest],html.gated #liveFoto [data-applyforce]{display:none!important}
html.gated #compView,html.gated #market,html.gated #gapList,html.gated #liveFoto,html.gated #descView[data-after="1"]{position:relative;cursor:pointer}
html.gated #compView::before,html.gated #market::before,html.gated #gapList::before,html.gated #liveFoto::before,html.gated #descView[data-after="1"]::before{content:attr(data-lk);display:inline-block;margin:0 0 10px;background:var(--y,#F6BB12);color:#0A0A0A;font-weight:700;font-size:.82rem;padding:5px 12px;border-radius:99px;position:relative;z-index:2;filter:none}
html.gated #titleTabs button.lk,html.gated #descTabs button.lk{opacity:.6}
html.gated #titleTabs button.lk::after,html.gated #descTabs button.lk::after{content:"";display:inline-block;width:.85em;height:.85em;margin-left:.45em;vertical-align:-.1em;background:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M17 9V7a5 5 0 0 0-10 0v2H5v12h14V9zm-8-2a3 3 0 0 1 6 0v2H9z'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M17 9V7a5 5 0 0 0-10 0v2H5v12h14V9zm-8-2a3 3 0 0 1 6 0v2H9z'/%3E%3C/svg%3E") center/contain no-repeat}
/* Handy: Report-Raster darf nicht von breitem Inhalt aufgedehnt werden, Kopfzeile passt, Tippflaechen mindestens 44 px */
@media(max-width:1023px){.rg{grid-template-columns:minmax(0,1fr)!important}.rg>*{min-width:0}}
@media(max-width:440px){header .cta{display:none}}
@media(max-width:560px){.panel{grid-template-columns:minmax(0,1fr)}.lgrid{grid-template-columns:minmax(0,1fr)}.row2{flex-wrap:wrap}.btn{white-space:normal;max-width:100%;text-align:center}}
@media(max-width:560px){.btn.sm,button.tog,button.chk,#titleTabs button,#descTabs button,header button,.tile,.fbtn{min-height:44px}button.tog,button.chk{min-width:44px}.gate input[type=checkbox]{width:22px;height:22px}.gate .gcons{font-size:.84rem}.gate{padding:20px 18px}}
@media print{#printDoc .ctab{display:inline-block;margin:10pt 0 0 13pt;background:#F6BB12;color:#0A0A0A;font-weight:700;font-size:10pt;padding:6pt 14pt;border-radius:20pt;text-decoration:none}#printDoc a{color:inherit;text-decoration:none}}
`;
  document.head.appendChild(css);

  const zones = { '#planList': 'plan', '#compView': 'markt', '#market': 'markt', '#gapList': 'luecke', '#liveFoto': 'fotos', '#descView': 'text' };
  const labels = () => L('Mit E-Mail freischalten', 'Unlock with your email');

  function gateCard() {
    let g = document.getElementById('gate');
    if (!g) { g = document.createElement('section'); g.id = 'gate'; g.className = 'gate'; const b = document.getElementById('befunde'); if (b) b.insertAdjacentElement('afterend', g); else return null; }
    return g;
  }
  function renderGate() {
    const g = gateCard(); if (!g || g.classList.contains('done')) return;
    if (g.dataset.lang === state.lang && g.querySelector('#gateForm')) return;   // nicht neu aufbauen: sonst gehen Eingaben verloren
    g.dataset.lang = state.lang;
    const pot = G.mk && G.mk.potential, cur = G.mk && G.mk.currency || 'CHF', n = (D.actions || []).length;
    g.innerHTML = `<div><h2>${L('Dein Plan ist fertig. Wohin sollen wir ihn schicken?', 'Your plan is ready. Where should we send it?')}</h2>
      ${pot ? `<p class="money">${L('Dein Inserat lässt geschätzt', 'Your listing leaves an estimated')} ${cur} <i>${String(pot).replace(/\d/g, '8').replace(/\B(?=(\d{3})+(?!\d))/g, '’')}</i> ${L('pro Jahr liegen.', 'a year on the table.')}</p>` : ''}
      <p>${L('Du siehst oben, was auffällt. Im Report steht, was du dagegen tust:', 'Above you see what stands out. The report shows what to do about it:')}</p>
      <ul><li>${L(`Alle ${n} Maßnahmen mit fertigen Texten`, `All ${n} actions with ready-made copy`)}</li><li>${L('Neuer Titel und neue Beschreibung', 'New title and description')}</li><li>${L('Foto-Reihenfolge und Ersetzen-Liste', 'Photo order and replace list')}</li><li>${L('Marktvergleich mit den drei Besten im Umkreis', 'Market comparison with the three best nearby')}</li><li>${L('Alles als PDF per E-Mail', 'All of it as a PDF by email')}</li></ul></div>
      <form id="gateForm" novalidate><input id="gMail" type="email" autocomplete="email" inputmode="email" placeholder="${L('Deine E-Mail-Adresse', 'Your email address')}" aria-label="${L('E-Mail-Adresse', 'Email address')}"><label class="gcons"><input id="gConsent" type="checkbox"><span>${L('Ich möchte den Report per E-Mail erhalten und bin einverstanden, dass Elev8 mich dazu kontaktiert.', 'I want to receive the report by email and agree that Elev8 contacts me about it.')}</span></label><button class="btn primary" type="submit" id="gBtn">${L('Report freischalten', 'Unlock report')}</button><div class="err" id="gErr" role="alert"></div></form>`;
    if (!G.viewed) { G.viewed = true; ev('gate_view', { score: Math.round(overall()) }); }
  }
  function lockCards() {
    const pl = document.getElementById('planList'); let c = document.getElementById('planLock');
    if (gated() && pl) {
      const rest = Math.max(0, (D.actions || []).length - 3);
      if (!c) { c = document.createElement('div'); c.id = 'planLock'; c.className = 'lockcard'; pl.insertAdjacentElement('afterend', c); }
      c.innerHTML = `<b>${L(`+${rest} weitere Maßnahmen und alle Details mit „So geht’s“ und fertigen Texten`, `+${rest} more actions and all details with “how” and ready-made copy`)}</b><button class="btn sm primary" type="button">${labels()}</button>`;
    } else if (c) c.remove();
  }
  function applyGate() {
    const on = gated(); document.documentElement.classList.toggle('gated', on);
    for (const s of Object.keys(zones)) { const e = document.querySelector(s); if (e) { if (on) e.setAttribute('data-lk', labels()); else e.removeAttribute('data-lk'); } }
    const dv = document.getElementById('descView'); if (dv) { if (on && state.descSel === 'after') dv.setAttribute('data-after', '1'); else dv.removeAttribute('data-after'); }
    lockCards(); if (on) renderGate();
    else { const g = document.getElementById('gate'); if (g && !G.unlocked) g.remove(); }
  }
  function toGate(z) { const g = document.getElementById('gate'); ev('gate_locked_click', { zone: z || '?' }); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = document.getElementById('gMail'); if (i) setTimeout(() => i.focus({ preventScroll: true }), 450); }

  /* Klicks auf gesperrte Teile -> Gate */
  document.addEventListener('click', (e) => {
    if (!gated()) return; const t = e.target; if (!t.closest) return;
    if (t.closest('#gate')) return;
    const locked = t.closest('#planLock') ? 'plan' : t.closest('#planList .act,#planList [data-tog],#planList [data-open],#planList [data-copy]') ? 'plan' : t.closest('#dlPlan,#dlPlan2') ? 'plan' : t.closest('#titleTabs button.lk') ? 'titel' : t.closest('#descTabs button[data-desc="after"]') ? 'text' : t.closest('[data-open^="apply"],[data-copytitle],[data-copydesc],[data-applygo],[data-applysuggest]') ? 'ota' : t.closest('#compView,#market .kpis,#market .ladder,#market table') ? 'markt' : t.closest('#gapList') ? 'luecke' : t.closest('#liveFoto') ? 'fotos' : null;
    if (!locked) return; e.preventDefault(); e.stopPropagation(); toGate(locked);
  }, true);
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-book]')) ev('page_cta_click'); });

  /* Absenden */
  document.addEventListener('submit', async (e) => {
    if (!e.target || e.target.id !== 'gateForm') return; e.preventDefault();
    const err = document.getElementById('gErr'), mail = document.getElementById('gMail').value.trim(), btn = document.getElementById('gBtn');
    err.textContent = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) || !document.getElementById('gConsent').checked) { err.textContent = L('Bitte E-Mail prüfen und der Zusendung zustimmen.', 'Please check your email and agree to receive it.'); ev('gate_error', { zone: 'input' }); return; }
    ev('gate_submit'); btn.disabled = true; btn.textContent = L('Wird gesendet …', 'Sending …');
    let base = {}; try { base = leadPayload() || {}; } catch (x) { }
    const p = { ...base, email: mail, consent: { given: true, at: new Date().toISOString(), text: document.querySelector('#gateForm .gcons span').textContent }, report: { id: G.id, lang: state.lang }, sid, gate: true, view: 'prospect', lang: state.lang, openedAreas: Array.from(state.clicks || []).slice(0, 40) };
    try {
      const r = await fetch('/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }), j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || r.status);
      G.token = j.token || null; G.unlocked = true; try { sessionStorage.setItem('lh_unlocked', '1'); } catch (x) { }
      ev('unlocked'); const g = document.getElementById('gate'); g.classList.add('done');
      g.innerHTML = `<div><h2>${L('Freigeschaltet. Dein Report ist unterwegs.', 'Unlocked. Your report is on its way.')}</h2><p>${L(`Das PDF kommt in wenigen Minuten an ${mail}. Hier siehst du schon alles.`, `The PDF arrives at ${mail} in a few minutes. You can already see everything here.`)}</p>${G.mk && G.mk.potential ? `<p class="money">${L('Dein Inserat lässt geschätzt', 'Your listing leaves an estimated')} ${G.mk.currency || 'CHF'} ${String(G.mk.potential).replace(/\B(?=(\d{3})+(?!\d))/g, '’')} ${L('pro Jahr liegen.', 'a year on the table.')}</p><p style="font-size:.85rem">${L('Schätzung: Abstand zur Belegung des oberen Viertels der Vergleichsinserate, bei gleichem Preis pro Nacht.', 'Estimate: gap to the occupancy of the top quarter of comparable listings, at your current nightly rate.')}</p>` : ''}<div class="row2"><a class="btn primary" href="#plan">${L('Zum Plan', 'To the plan')}</a><a class="btn ghost" data-book href="#">${L('Demo-Call buchen', 'Book a demo call')}</a></div></div>`;
      try { bindBook(); } catch (x) { } renderAll(); applyGate();
    } catch (x) { ev('gate_error', { zone: 'server' }); btn.disabled = false; btn.textContent = L('Report freischalten', 'Unlock report'); err.textContent = L('Senden hat nicht geklappt. Bitte versuche es gleich noch einmal.', 'Sending failed. Please try again in a moment.'); }
  });

  /* Studio: empfohlene Variante und „Nachher“ sperren */
  const _rs = renderStudio;
  renderStudio = function () {
    const rec = (D.titles || []).find((t) => t.rec);
    if (gated()) { if (rec && state.titleSel === rec.id) state.titleSel = 'cur'; }
    _rs();
    if (gated()) {
      if (rec) { const b = document.querySelector(`#titleTabs [data-title="${rec.id}"]`); if (b) b.classList.add('lk'); }
      const a = document.querySelector('#descTabs [data-desc="after"]'); if (a) a.classList.add('lk');
    }
    applyGate();
  };
  const _ra = renderAll; renderAll = function () { _ra(); applyGate(); };
  const _sl = setLang; setLang = function (l) { _sl(l); applyGate(); const g = document.getElementById('gate'); if (g && !g.classList.contains('done')) renderGate(); };

  /* Drucken: gesperrt, bis freigeschaltet; mit klickbaren Links */
  function patchPrint() {
    const d = document.getElementById('printDoc'); if (!d) return;
    const url = G.token ? `${location.origin}/go/${G.token}` : (typeof BOOKING_URL !== 'undefined' ? BOOKING_URL : 'https://elev8-suite.com');
    d.querySelectorAll('.cta b').forEach((b) => { const a = document.createElement('a'); a.className = 'ctab'; a.href = url; a.textContent = b.textContent; b.replaceWith(a); });
    d.querySelectorAll('.pbnd svg').forEach((s) => { if (s.parentElement.tagName === 'A') return; const a = document.createElement('a'); a.href = 'https://elev8-suite.com'; s.replaceWith(a); a.appendChild(s); });
    d.querySelectorAll('.fine').forEach((f) => { if (f.querySelector('a')) return; f.insertAdjacentHTML('beforeend', ` <a href="https://elev8-suite.com" style="text-decoration:underline">elev8-suite.com</a>`); });
  }
  window.addEventListener('beforeprint', () => {
    if (gated()) { const d = document.getElementById('printDoc'); ev('print_blocked'); if (d) d.innerHTML = `<section class="pg"><h2>${L('Der vollständige Report kommt per E-Mail', 'The full report arrives by email')}</h2><p class="sub">${L('Schalte ihn auf der Seite mit deiner E-Mail-Adresse frei. Danach bekommst du ihn als PDF.', 'Unlock it on the page with your email address. Then you get it as a PDF.')}</p></section>`; return; }
    patchPrint();
  });

  /* Mess-Ereignis: Scan fertig, und PDF-Modus */
  const _rv = reveal;
  reveal = function () {
    _rv();
    if (PDFMODE) { try { if (window.pdBuild) window.pdBuild(); patchPrint(); } catch (e) { } window.__pdfReady = true; return; }
    if (state.reportLive) ev('scan_done', { score: Math.round(overall()) });
    applyGate();
    if (gated()) { const g = document.getElementById('gate'); if (g) setTimeout(() => g.scrollIntoView({ behavior: 'smooth', block: 'center' }), 900); }
  };
  if (PDFMODE) {
    document.documentElement.classList.add('pdfmode');
    setTimeout(() => { try { setLang(Q.get('lang') === 'en' ? 'en' : 'de'); document.getElementById('inUrl').value = Q.get('url') || ''; document.getElementById('checkForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); } catch (e) { window.__pdfError = String(e); } }, 60);
  }
})();
