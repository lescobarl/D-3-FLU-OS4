import { chromium } from '@playwright/test';

const PHRASE = 'okay flu busca en la web cómo saltan los conejos';
const URL = process.env.FLU_URL || `http://localhost:${process.env.PORT || 5173}`;

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => {
  const t = m.text();
  if (/arbitro|árbitro|navigation|BUSCAR|final-commit|commitTurnToSessionRows|onContractResolved|redundant|dispatchArbiterIntent|livePhrase/i.test(t)) logs.push(t);
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__fluDev?.runFluPhrase, null, { timeout: 60000 });

// Iniciar conversación (para que corra la ruta activa)
const clicked = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim());
  const t = btns.find((x) => /iniciar conversaci/i.test(x));
  const b = t && Array.from(document.querySelectorAll('button')).find((el) => /iniciar conversaci/i.test((el.textContent || '').trim()));
  if (b) { b.click(); return t; }
  return null;
});
console.log('clickIniciar:', clicked);
await page.waitForTimeout(2500);

await page.evaluate(async (p) => { await window.__fluDev.runFluPhrase(p); }, PHRASE);
await page.waitForTimeout(4000);

const state = await page.evaluate(() => {
  const s = window.__fluStore?.getState ? window.__fluStore.getState() : {};
  const h = Array.isArray(s.conversationHistory) ? s.conversationHistory : [];
  const buscaRows = h.filter((e) => /busca|busco|saltan|conejo/i.test(String(e.text || e.content || e.transcript || '')));
  const last = buscaRows.length ? buscaRows[buscaRows.length - 1] : null;
  return {
    nUserRows: h.length,
    nBuscaRows: buscaRows.length,
    buscaRowTexts: buscaRows.map((e) => String(e.text || e.content || e.transcript || '').slice(0, 70)),
    lastBuscaText: last ? String(last.text || last.content || last.transcript || '').slice(0, 90) : null,
    lastBuscaSpeaker: last ? String(last.speakerName || last.speaker || last.role || '') : null,
    conversationState: s.conversationState ?? null,
  };
});

console.log('>>> ESTADO:', JSON.stringify(state, null, 2));
console.log('>>> LOGS clave:');
for (const l of logs.slice(-40)) console.log('  ', l);

await browser.close();
