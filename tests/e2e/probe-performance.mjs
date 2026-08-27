// ============================================================
// probe-performance.mjs — Mide el rendimiento real de FLU en un
// navegador headless: long tasks, gaps de rAF (jank), spam de
// POSTs a /__flu_agent_trace, cargas FBX y crecimiento del ring
// de trace en reposo. Provee EVIDENCIA para el diagnóstico de
// "FLU se congela en momentos y luego continúa".
//
// Uso (requiere el servidor de desarrollo en :5175):
//   node tests/e2e/probe-performance.mjs
// ============================================================
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:5175';
const OUT_DIR = path.resolve(__dirname, '..', '..', 'reports', 'performance');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const tracePosts = [];
const fbxRequests = [];
const consoleLines = [];

page.on('request', (req) => {
  const url = req.url();
  if (url.includes('/__flu_agent_trace')) {
    tracePosts.push({ t: Date.now(), bytes: req.postData()?.length || 0 });
  }
  if (url.includes('/models/Animations/')) {
    fbxRequests.push({ file: url.split('/').pop(), t: Date.now(), finished: false });
  }
});
page.on('requestfinished', (req) => {
  const url = req.url();
  if (url.includes('/models/Animations/')) {
    const file = url.split('/').pop();
    const entry = fbxRequests.find((r) => r.file === file && !r.finished);
    if (entry) {
      entry.finished = true;
      entry.ms = Date.now() - entry.t;
    }
  }
});
page.on('requestfailed', (req) => {
  const url = req.url();
  if (url.includes('/models/Animations/')) {
    const file = url.split('/').pop();
    const entry = fbxRequests.find((r) => r.file === file && !r.finished);
    if (entry) entry.failed = true;
  }
});
page.on('console', (msg) => {
  const text = msg.text();
  if (/BunnyViewer|trace|DIAG|Cache/.test(text)) consoleLines.push(`${msg.type()}: ${text.slice(0, 160)}`);
});

const out = { phase: {}, fbxRequests: [], tracePosts: [] };

try {
  // Forzar trace activo desde el inicio (antes de cargar la app)
  await page.addInitScript(() => {
    try { localStorage.setItem('flu.trace', '1'); } catch { /* ignore */ }
  });

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('.flu-shell', { timeout: 15000 });

  // Observadores de jank + long tasks
  await page.evaluate(() => {
    window.__perf = { longTasks: [], rAFgaps: [] };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__perf.longTasks.push({ name: e.name, at: Math.round(e.startTime), ms: Math.round(e.duration) });
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* no longtask */ }
    let last = performance.now();
    const tick = (now) => {
      const gap = now - last;
      if (gap > 50) window.__perf.rAFgaps.push({ at: Math.round(now), ms: Math.round(gap) });
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // ---- FASE 1: reposo (idle) 20s ----
  await page.waitForTimeout(2000);
  const idleStartCount = await page.evaluate(() => window.__fluDev?.trace?.snapshot?.().count ?? -1);
  const idleStartSummary = await page.evaluate(() => window.__fluDev?.trace?.snapshot?.().summary ?? {});
  const t0 = Date.now();
  const postsBefore = tracePosts.length;
  await page.waitForTimeout(20000);
  const idleSeconds = (Date.now() - t0) / 1000;
  const postsDuringIdle = tracePosts.length - postsBefore;
  const idleEndCount = await page.evaluate(() => window.__fluDev?.trace?.snapshot?.().count ?? -1);
  const idleEndSummary = await page.evaluate(() => window.__fluDev?.trace?.snapshot?.().summary ?? {});
  const idlePerf = await page.evaluate(() => window.__perf);

  out.phase.idle = {
    seconds: Math.round(idleSeconds),
    tracePosts: postsDuringIdle,
    traceBytes: tracePosts.slice(postsBefore).reduce((a, r) => a + r.bytes, 0),
    ringStart: idleStartCount,
    ringEnd: idleEndCount,
    ringGrowth: idleEndCount - idleStartCount,
    startTop: idleStartSummary.top || [],
    endTop: idleEndSummary.top || [],
    longTasks: idlePerf.longTasks.length,
    maxLongTaskMs: idlePerf.longTasks.reduce((m, t) => Math.max(m, t.ms), 0),
    rAFgaps: idlePerf.rAFgaps.length,
    maxGapMs: idlePerf.rAFgaps.reduce((m, g) => Math.max(m, g.ms), 0),
  };

  // ---- FASE 2: transición a SPEAKING (fuerza carga FBX Idle_2 + MouthMove) ----
  // Resetear métricas
  await page.evaluate(() => {
    window.__perf.longTasks = [];
    window.__perf.rAFgaps = [];
    const before = window.__bunnyStore?.getState?.().currentAnimation;
    window.__bunnyStore?.getState?.().setExpression('hablando');
  });
  const t1 = Date.now();
  await page.waitForTimeout(4000);
  const speakSeconds = (Date.now() - t1) / 1000;
  const speakPerf = await page.evaluate(() => window.__perf);
  const animState = await page.evaluate(() => ({
    expression: window.__bunnyStore?.getState?.().currentExpression,
    animation: window.__bunnyStore?.getState?.().currentAnimation,
    blend: window.__bunnyStore?.getState?.().blendQueue,
  }));

  out.phase.speaking = {
    seconds: Math.round(speakSeconds),
    animationState: animState,
    longTasks: speakPerf.longTasks,
    rAFgaps: speakPerf.rAFgaps.slice(0, 20),
    maxLongTaskMs: speakPerf.longTasks.reduce((m, t) => Math.max(m, t.ms), 0),
    rAFgapCount: speakPerf.rAFgaps.length,
  };

  // ---- FASE 3: transición a IDLE (detener) y medir ----
  await page.evaluate(() => {
    window.__perf.longTasks = [];
    window.__perf.rAFgaps = [];
    window.__bunnyStore?.getState?.().setExpression('neutral');
  });
  const t2 = Date.now();
  await page.waitForTimeout(3000);
  const idlePerf2 = await page.evaluate(() => window.__perf);
  out.phase.toIdle = {
    seconds: Math.round((Date.now() - t2) / 1000),
    longTasks: idlePerf2.longTasks.length,
    maxLongTaskMs: idlePerf2.longTasks.reduce((m, t) => Math.max(m, t.ms), 0),
    rAFgapCount: idlePerf2.rAFgaps.length,
    maxGapMs: idlePerf2.rAFgaps.reduce((m, g) => Math.max(m, g.ms), 0),
  };

  out.fbxRequests = fbxRequests;
  out.tracePostsTotal = tracePosts.length;
  out.traceBytesTotal = tracePosts.reduce((a, r) => a + r.bytes, 0);
  out.consoleLines = consoleLines.slice(0, 60);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'probe-performance.json'), JSON.stringify(out, null, 2));

  // ---- Resumen legible ----
  const p = out.phase;
  console.log('=== PROBE RENDIMIENTO FLU ===');
  console.log(`IDLE ${p.idle.seconds}s: tracePosts=${p.idle.tracePosts} (${(p.idle.traceBytes/1024).toFixed(1)}KB), ring ${p.idle.ringStart}→${p.idle.ringEnd} (+${p.idle.ringGrowth})`);
  console.log(`  longTasks=${p.idle.longTasks} max=${p.idle.maxLongTaskMs}ms · rAFgaps=${p.idle.rAFgaps} max=${p.idle.maxGapMs}ms`);
  console.log(`  top eventos idle inicio: ${(p.idle.startTop || []).slice(0, 5).join(', ')}`);
  console.log(`  top eventos idle fin:    ${(p.idle.endTop || []).slice(0, 5).join(', ')}`);
  console.log(`SPEAKING ${p.speaking.seconds}s: state=${JSON.stringify(animState)}`);
  console.log(`  longTasks=${p.speaking.longTasks.length} max=${p.speaking.maxLongTaskMs}ms · rAFgaps=${p.speaking.rAFgapCount}`);
  console.log(`  longTasks detalle: ${JSON.stringify(p.speaking.longTasks.slice(0, 8))}`);
  console.log(`  rAFgaps detalle: ${JSON.stringify(p.speaking.rAFgaps.slice(0, 8))}`);
  console.log(`TO_IDLE: longTasks=${p.toIdle.longTasks} max=${p.toIdle.maxLongTaskMs}ms · rAFgaps=${p.toIdle.rAFgapCount} max=${p.toIdle.maxGapMs}ms`);
  console.log(`FBX requests: ${fbxRequests.map((r) => `${r.file}${r.finished ? `(${r.ms}ms)` : r.failed ? '(FAIL)' : '(pend)'}`).join(', ')}`);
  console.log(`Total tracePosts=${out.tracePostsTotal} bytes=${(out.traceBytesTotal/1024).toFixed(1)}KB`);
  console.log(`Reporte: reports/performance/probe-performance.json`);
} catch (err) {
  console.error('PROBE ERROR:', err.message);
  out.error = String(err && err.stack ? err.stack : err);
} finally {
  await browser.close();
}
