/* Meta-Ads-Landingpage: Zuordnung (UTM, fbclid), Headline-Varianten per Link (?h=a|b|c), Sprache per Link (?lang=de|en),
   Beispiel-Beschriftung und Meta Pixel (nur mit Einwilligung, nur wenn META_PIXEL_ID in Railway gesetzt ist). */
(() => {
  'use strict';
  if (/[?&]pdf=1(&|$)/.test(location.search)) return;
  const Q = new URLSearchParams(location.search);
  const L = (de, en) => (state.lang === 'en' ? en : de);
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } } };

  /* 1. Zuordnung: erster Kontakt gewinnt, pro Sitzung gespeichert, geht mit jedem Event und mit dem Lead an den Server */
  const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'h'];
  const attr = (() => {
    let a = {}; try { a = JSON.parse(sessionStorage.getItem('lh_attr') || '{}') || {}; } catch (e) { }
    if (!Object.keys(a).length) {
      for (const k of KEYS) { const v = Q.get(k); if (v) a[k] = v.slice(0, 60); }
      try { if (Object.keys(a).length) sessionStorage.setItem('lh_attr', JSON.stringify(a)); } catch (e) { }
    }
    return a;
  })();
  window.LH_ATTR = Object.keys(attr).length ? attr : undefined;

  /* 2. Headline-Varianten für A/B-Tests über die Anzeigen-Links. Ohne ?h= gilt der Standardtext aus patch.js (Variante a). */
  const V = {
    b: { de: ['Dein Inserat in 60 Sekunden geprüft.', 'Füge deinen Airbnb-Link ein und sieh, wo dein Inserat Buchungen verliert. Mit fertigen Texten und einem Plan für heute.'], en: ['Your listing, checked in 60 seconds.', 'Paste your Airbnb link and see where your listing loses bookings. With ready-made copy and a plan for today.'] },
    c: { de: ['Titel, Fotos, Preis: Was bremst dein Inserat?', 'Füge deinen Airbnb-Link ein. Wir zeigen dir, was dich Buchungen kostet und was du heute ändern kannst.'], en: ['Title, photos, price: what is holding your listing back?', 'Paste your Airbnb link. We show you what it costs you in bookings and what you can change today.'] },
  };
  const variant = V[(Q.get('h') || (attr.h || '')).toLowerCase()];
  function applyCopy() {
    const h1 = document.querySelector('#hero h1'), lead = document.querySelector('#hero .lead');
    if (variant && h1 && lead) { const v = variant[state.lang === 'en' ? 'en' : 'de']; h1.textContent = v[0]; lead.textContent = v[1]; }
    const art = document.querySelector('.hero-art'); if (art) art.setAttribute('data-cap', L('Beispiel-Ergebnis', 'Example result'));
  }
  const _sl = setLang; setLang = function (l) { _sl(l); applyCopy(); renderBar(); };

  /* 3. Sprache per Link: ...?lang=de erzwingt Deutsch, auch wenn das Handy auf Englisch steht */
  const wanted = Q.get('lang');
  if ((wanted === 'de' || wanted === 'en') && state.lang !== wanted) _sl(wanted);

  /* 4. Meta Pixel: nur mit Einwilligung, Standard-Events für die Anzeigenoptimierung */
  const PID = String(window.LH_PIXEL || '').replace(/\D/g, '');
  let loaded = false;
  window.LH_CONSENT = store.get('lh_px') === '1';
  const cookie = (n) => { const m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; };
  /* fbp/fbc für die Zuordnung auf Meta-Seite (Conversions API); fbc wird bei fehlendem Cookie aus fbclid gebaut */
  const fbcFallback = attr.fbclid ? `fb.1.${Date.now()}.${attr.fbclid}` : '';   // einmal berechnet, damit der Wert stabil bleibt
  window.lhFb = () => ({ fbp: cookie('_fbp'), fbc: cookie('_fbc') || fbcFallback });
  let sid = ''; try { sid = sessionStorage.getItem('lh_sid') || ''; } catch (e) { }
  const track = (kind, name, params) => window.fbq(kind, name, params || {}, { eventID: `${sid}:${name}` });   // gleiche ID wie auf dem Server, Meta dedupliziert
  function loadPixel() {
    if (!PID || loaded) return; loaded = true;
    /* Standard-Snippet von Meta */
    !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', PID); window.fbq('track', 'PageView');
  }
  /* wird von gate.js bei jedem Event aufgerufen */
  window.lhTrack = (e) => {
    if (!PID || store.get('lh_px') !== '1' || !window.fbq) return;
    if (e === 'scan_start') track('trackCustom', 'AuditStart');
    else if (e === 'gate_view') track('track', 'ViewContent', { content_name: 'listing_health_report' });
    else if (e === 'unlocked') track('track', 'Lead', { content_name: 'listing_health_report' });
    else if (e === 'page_cta_click') track('track', 'Schedule');
  };

  function renderBar() {
    let bar = document.getElementById('consentBar');
    if (!PID || store.get('lh_px')) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.id = 'consentBar'; bar.className = 'consent-bar'; bar.setAttribute('role', 'dialog'); bar.setAttribute('aria-label', 'Cookies'); document.body.appendChild(bar); }
    bar.innerHTML = `<div>${L('Wir messen mit dem Meta Pixel, ob unsere Werbung wirkt. Dabei werden Nutzungsdaten an Meta übertragen. Einverstanden?', 'We use the Meta Pixel to measure whether our ads work. Usage data is sent to Meta. Is that OK?')}</div><div class="cb-row"><button type="button" class="ok" data-c="1">${L('Akzeptieren', 'Accept')}</button><button type="button" data-c="0">${L('Ablehnen', 'Decline')}</button></div>`;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('#consentBar [data-c]'); if (!b) return;
    store.set('lh_px', b.getAttribute('data-c')); window.LH_CONSENT = b.getAttribute('data-c') === '1'; if (window.LH_CONSENT) loadPixel(); renderBar();
  });
  if (store.get('lh_px') === '1') loadPixel();

  applyCopy(); renderBar();
})();
