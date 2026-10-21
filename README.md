# listing-audit-scraper (v2)

Headless-Browser-Service (Playwright/Chromium) für **öffentliche** Airbnb-Listings. Kein Chrome-Extension, kein Login.
Liefert JSON für den Elev8 Listing-Audit: Titel, Beschreibung, Amenities, Schlafarrangements, Fotos (inkl. Alt-Texte), Ratings/Subscores, Reviews im Volltext.

## Nutzung
```
GET /scrape?url=https://www.airbnb.de/rooms/<id>
Authorization: Bearer <API_KEY>
```
Optionen: `reviews=0` (ohne Review-Volltext), `raw=1` (rohe Sections), `locale=de-DE`, `pretty=1`. `GET /health` ohne Auth.

## Railway-Variablen
- `API_KEY` (Pflicht) – ohne Key sind alle /scrape-Aufrufe gesperrt.

## Hinweise
- Es läuft immer nur ein Scrape gleichzeitig (Queue). Ein Aufruf dauert ca. 20–60 s.
- `debug.sectionIds` / `debug.errors` in der Antwort zeigen, welche Airbnb-Sections gefunden wurden. Airbnb ändert sein Markup – dann Normalisierung in `normalize()` anpassen.
- Nur für eigene Listings und Tests nutzen; Airbnb-AGB beachten, keine Massenabfragen.
