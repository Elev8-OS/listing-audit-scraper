// PDF-Erzeugung mit Chromium (Playwright, wie der Scraper): lädt die Seite im PDF-Modus und druckt das Report-Layout.
import fs from 'node:fs';
let chain = Promise.resolve();
export function renderPdf(o) { const job = chain.then(() => doRender(o)); chain = job.catch(() => {}); return job; }   // immer nur ein Chromium gleichzeitig
async function doRender({ origin, url, lang, token, out }) {
  if (process.env.PDF_RENDERER === 'stub') { fs.writeFileSync(out, '%PDF-1.4\n% stub\n'); return; }
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: lang === 'en' ? 'en-GB' : 'de-CH' }), page = await ctx.newPage();
    await page.goto(`${origin}/?pdf=1&lang=${lang}&k=${encodeURIComponent(token || '')}&url=${encodeURIComponent(url)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__pdfReady === true, null, { timeout: 120000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally { await browser.close().catch(() => {}); }
}
