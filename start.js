// Startet den Scraper unverändert und ergänzt nur die Bedien-Oberfläche unter /ui.
import http from 'node:http';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('./ui.html', import.meta.url), 'utf8');
const orig = http.createServer.bind(http);
http.createServer = (...args) => {
  const handler = args.pop();
  return orig(...args, (req, res) => {
    const p = String(req.url || '').split('?')[0];
    if (p === '/ui') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
      return res.end(ui);
    }
    return handler(req, res);
  });
};
await import('./server.js');
