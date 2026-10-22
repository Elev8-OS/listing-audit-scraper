// Lead-Magnet-Modus: blendet aus, was nicht zum Lead-Magneten gehört, und bereinigt Texte.
// Wird beim Ausliefern auf die Seite angewendet, die Seitendatei selbst bleibt unverändert.
const SWAPS = [
  // [alt, neu]: gilt für Seite und Übersetzungstabelle gleichermaßen (deutscher Text ist der Schlüssel)
  ['value="https://www.airbnb.de/rooms/1175211811818785379"', 'placeholder="https://www.airbnb.de/rooms/…"'],
  ['Beispiel-Report mit echten Daten vom 21.10.2026. Beliebige Links live auszuwerten startet mit der Live-Anbindung.', 'Dauert etwa eine Minute. Link kopieren: Airbnb-App, Inserat öffnen, Teilen, Link kopieren.'],
  ['Sample report with real data from 21 Oct 2026. Checking any link live starts with the live integration.', 'Takes about a minute. To copy the link: Airbnb app, open the listing, Share, Copy link.'],
  ['Elev8 Listing Health · Beispiel-Report mit echten Daten, Stand 21.10.2026. Marktdaten', 'Elev8 Listing Health · Marktdaten'],
  ['Elev8 Listing Health · Sample report with real data, as of 21 Oct 2026. Market data', 'Elev8 Listing Health · Market data'],
];
const CSS = `
/* Lead-Magnet-Modus */
.demo,header.top .cta,#experte,#kanaele,#naechte,#portfolio,#tracker,#alerts,#quellen,#prozess,#stimmen,#preis,#lead{display:none!important}
.rnav,.rcard [data-book]{display:none!important}
header.top nav{display:none!important}
.drawer:not(.on){box-shadow:none!important}
label.field:has(#inPhone),#phoneHelp{display:none!important}
.trust li:nth-child(n+3){display:none}
#filters,#dlPlan,#dlPlan2,.prog [data-open^="apply"],#planList [data-open^="apply"],#planList [data-open="src:elev8"],#planList a[data-book],#studio [data-open^="apply"]{display:none!important}
#banner,#liveFoto [data-open^="apply"],#fotos [data-open^="apply"]{display:none!important}
#cta .band ul li:not(:nth-child(3)){display:none}
html.gated .rcard [data-x="print"],html.gated #cta,html.gated #otaInfo{display:none!important}
`;
export function patchPage(html) {
  let h = html;
  for (const [a, b] of SWAPS) h = h.split(a).join(b);
  return h.includes('</head>') ? h.replace('</head>', () => `<style id="magnetCss">${CSS}</style></head>`) : h;
}
