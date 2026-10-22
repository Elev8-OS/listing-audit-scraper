// Lead-Magnet-Modus: blendet aus, was nicht zum Lead-Magneten gehört, und bereinigt Texte.
// Wird beim Ausliefern auf die Seite angewendet, die Seitendatei selbst bleibt unverändert.
const SWAPS = [
  // [alt, neu]: gilt für Seite und Übersetzungstabelle gleichermaßen (deutscher Text ist der Schlüssel)
  ['value="https://www.airbnb.de/rooms/1175211811818785379"', 'placeholder="https://www.airbnb.de/rooms/…"'],
  ['Beispiel-Report mit echten Daten vom 21.10.2026. Beliebige Links live auszuwerten startet mit der Live-Anbindung.', 'Dauert etwa eine Minute. Link kopieren: Airbnb-App, Inserat öffnen, Teilen, Link kopieren.'],
  ['Sample report with real data from 21 Oct 2026. Checking any link live starts with the live integration.', 'Takes about a minute. To copy the link: Airbnb app, open the listing, Share, Copy link.'],
  ['Elev8 Listing Health · Beispiel-Report mit echten Daten, Stand 21.10.2026. Marktdaten', 'Elev8 Listing Health · Marktdaten'],
  ['Elev8 Listing Health · Sample report with real data, as of 21 Oct 2026. Market data', 'Elev8 Listing Health · Market data'],
  // OTA-Versand: einheitlich "An OTAs senden", Elev8 Suite als Label
  ['Alle in OTAs übernehmen', 'Alle an OTAs senden'], ['Regel-Test in OTAs übernehmen', 'Regel-Test an OTAs senden'], ['Fläche in OTAs übernehmen', 'Fläche an OTAs senden'], ['Lücken füllen und in OTAs übernehmen', 'Lücken füllen und an OTAs senden'], ['In OTAs übernehmen', 'An OTAs senden'],
  ['Apply all to OTAs', 'Send all to OTAs'], ['Apply rule test to OTAs', 'Send rule test to OTAs'], ['Apply area to OTAs', 'Send area to OTAs'], ['Fill the gaps and apply to OTAs', 'Fill the gaps and send to OTAs'], ['Apply to OTAs', 'Send to OTAs'],
  ['Mit Elev8-Anbindung', 'Mit Elev8 Suite'], ['With Elev8 integration', 'With Elev8 Suite'],
  ['Ein Klick, und Elev8 schreibt Änderungen in alle verbundenen OTAs.', 'Mit der Elev8 Suite: ein Klick, und deine Änderungen gehen an alle verbundenen Kanäle.'],
  ['One click, and Elev8 writes changes to all connected OTAs.', 'With Elev8 Suite: one click sends your changes to all connected channels.'],
  ['Exklusive Elev8-Daten: Buchungen, Preise und Markt in einem Bericht.', 'Inserat, Fotos, Preise und Markt in einem Bericht.'],
  ['Exclusive Elev8 data: bookings, prices and market in one report.', 'Listing, photos, prices and market in one report.'],
  ['Hake ab, was du erledigt hast. Der Score rechnet live mit. Änderungen am Inserat übernimmt Elev8 mit einem Klick in alle verbundenen OTAs.', 'Hake ab, was du erledigt hast. Der Score rechnet live mit. Mit der Elev8 Suite gehen Änderungen am Inserat mit einem Klick an alle verbundenen OTAs.'],
  ['Tick off what you’ve done. The score updates live. Elev8 pushes listing changes to all connected OTAs with one click.', 'Tick off what you’ve done. The score updates live. With Elev8 Suite, listing changes go to all connected OTAs with one click.'],
];
const CSS = `
/* Lead-Magnet-Modus */
.demo,header.top .cta,#experte,#kanaele,#naechte,#portfolio,#tracker,#alerts,#quellen,#prozess,#stimmen,#preis,#lead{display:none!important}
.rnav,.rcard [data-book]{display:none!important}
header.top nav{display:none!important}
.drawer:not(.on){box-shadow:none!important}
label.field:has(#inPhone),#phoneHelp{display:none!important}
.trust li:nth-child(3){display:none}
#filters,#dlPlan,#dlPlan2,#planList a[data-book],#banner{display:none!important}
#cta .band ul li:not(:nth-child(3)){display:none}
html.gated .rcard [data-x="print"],html.gated #cta{display:none!important}
/* Elev8-Suite-Label an allen OTA-Knoepfen, mit Tooltip */
.e8lbl{font-style:normal;font-size:.64rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:2px 8px;border-radius:99px;background:#0A0A0A;color:#F6BB12;white-space:nowrap;line-height:1.5}
.btn.dark .e8lbl,.btn.ghost .e8lbl{background:#F6BB12;color:#0A0A0A}
.e8btn{position:relative}
.meta .e8chip{border:1.5px solid #F6BB12;background:#FEF4D6;color:#0A0A0A;cursor:pointer;font:inherit;font-weight:650;display:inline-flex;gap:6px;align-items:center}
@media(hover:hover){.e8btn:not(.e8chip):hover::after,.e8btn:not(.e8chip):focus-visible::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%);width:max-content;max-width:270px;background:#0A0A0A;color:#fff;font-size:.78rem;font-weight:500;line-height:1.4;padding:9px 13px;border-radius:12px;white-space:normal;text-align:left;z-index:80;box-shadow:0 10px 30px -10px rgba(0,0,0,.5);pointer-events:none}}
.e8usp{border:1.5px solid #F6BB12;background:linear-gradient(180deg,#FEF4D6,var(--card,#fff) 80%);margin:0 0 18px}
.e8usp .h{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px;font-size:1.05rem}
.e8usp p{margin:0 0 12px}
.e8usp .btn{justify-self:start;width:auto}
`;
export const patchScript = (js) => SWAPS.reduce((h, [a, b]) => h.split(a).join(b), js);
export function patchPage(html) {
  let h = html;
  for (const [a, b] of SWAPS) h = h.split(a).join(b);
  return h.includes('</head>') ? h.replace('</head>', () => `<style id="magnetCss">${CSS}</style></head>`) : h;
}
