// ============================================================
// probe-ffmpeg-video.mjs — Verifica en un navegador real que el
// ensamblador de video con ffmpeg.wasm autohospedado produce un
// mp4 (rama REAL) y no cae al modo degradado.
//
// Uso (requiere el servidor de desarrollo en :5175):
//   node tests/e2e/probe-ffmpeg-video.mjs
// ============================================================
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, 'fixtures', 'sample.txt');
const BASE_URL = 'http://localhost:5175';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

page.on('console', (msg) => {
    const text = msg.text();
    if (/ffmpeg|videoAssembler|assembleVideo/i.test(text)) {
        console.log('[console]', msg.type(), text.slice(0, 300));
    }
});

try {
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('.flu-shell', { timeout: 15000 });
    await page.evaluate(() => {
        try { localStorage.clear(); } catch { /* ignore */ }
    });

    // F1: subir documento
    await page.setInputFiles('input[type="file"][accept*=".txt"]', SAMPLE);
    await page.waitForSelector('.document-analysis__title', { timeout: 30000 });

    // F4: generar video
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('flu:generate-video'));
    });

    const timeout = 180000;
    const start = Date.now();
    let videoBlock = false;
    while (Date.now() - start < timeout) {
        const count = await page.locator('.generation-panel__video').count().catch(() => 0);
        if (count > 0) { videoBlock = true; break; }
        await page.waitForTimeout(1000);
    }

    if (!videoBlock) {
        console.log('RESULT: FAILED no-video-block (timeout 180s)');
        await browser.close();
        process.exit(0);
    }

    const playerCount = await page.locator('.generation-panel__video-player').count();
    const degradedCount = await page.locator('.generation-panel__video-degraded').count();

    if (playerCount > 0) {
        const player = page.locator('.generation-panel__video-player').first();
        const src = await player.getAttribute('src');
        const meta = await page.evaluate(() => {
            const v = document.querySelector('.generation-panel__video-player');
            if (!v) return null;
            return { readyState: v.readyState, duration: v.duration };
        });
        const storyboard = await page.locator('.generation-panel__video-meta').textContent();
        console.log('RESULT: MP4_REAL');
        console.log('  src:', src ? src.slice(0, 60) : 'none');
        console.log('  readyState:', meta?.readyState, 'duration:', meta?.duration);
        console.log('  meta:', storyboard?.trim());
        console.log('  degraded-msg:', await page.locator('.generation-panel__video-degraded').count() > 0 ? 'present' : 'absent');
    } else if (degradedCount > 0) {
        console.log('RESULT: DEGRADED (ffmpeg.wasm no generó mp4)');
        console.log('  msg:', (await page.locator('.generation-panel__video-degraded').textContent())?.trim());
        const warnings = await page.locator('.generation-panel__warning').allTextContents();
        console.log('  warnings:', warnings.join(' | '));
    } else {
        console.log('RESULT: UNKNOWN (ni reproductor ni degradado)');
    }
} catch (error) {
    console.log('RESULT: ERROR', error && error.message ? error.message : String(error));
} finally {
    await browser.close();
}
