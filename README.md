# listing-audit-scraper (v2)

Headless-Browser-Service (Playwright/Chromium) für **öffentliche** Airbnb-Listings. Kein Chrome-Extension, kein Login.
Liefert JSON für den Elev8 Listing-Audit: Titel, Beschreibung, Amenities, Schlafarrangements, Fotos (inkl. Alt-Texte), Ratings/Subscores, Reviews im Volltext.

## Endpunkte (alle außer /health mit `Authorization: Bearer <API_KEY>`)

| Endpunkt | Zweck |
| --- | --- |
| `GET /scrape?url=<airbnb-url>` | Scrapen und warten (30–60 s). Frischer Cache-Treffer kommt sofort. |
| `GET /scrape?url=…&async=1` | Scrape im Hintergrund starten, sofort Antwort 202. |
| `GET /cached?id=<id oder url>` | Gespeichertes Ergebnis sofort abrufen (404, wenn keins da; 202, wenn gerade läuft). |
| `GET /cache` | Übersicht aller gespeicherten Listings mit Alter. |
| `GET /health` | Lebenszeichen ohne Auth. |

Optionen: `refresh=1` (Cache ignorieren), `slim=1` (ohne Seitentext und Roh-Teile, deutlich kleiner), `reviews=0`, `locale=de-DE`, `pretty=1`, `debug=1`.

Typischer Ablauf für Automationen: `/scrape?async=1` aufrufen, nach ca. 45 s `/cached?id=…&slim=1` abholen.

## Railway-Variablen
- `API_KEY` (Pflicht) – ohne Key sind alle Abfragen gesperrt.
- `CACHE_TTL_MIN` (optional, Standard 360) – wie lange ein Ergebnis als frisch gilt.
- `DATA_DIR` (optional, Standard `/tmp/listing-audit-cache`) – Speicherort. Mit einem Railway-Volume (z. B. `/data`) bleibt der Cache auch nach einem Deployment erhalten.

## Hinweise
- Es läuft immer nur ein Scrape gleichzeitig (Queue); pro Listing nur einer (Doppelaufrufe teilen sich das Ergebnis).
- `debug.errors` in der Antwort zeigt Probleme. Airbnb ändert sein Markup – dann `normalize()` anpassen.
- Nur für eigene Listings und Tests nutzen; Airbnb-AGB beachten, keine Massenabfragen.
