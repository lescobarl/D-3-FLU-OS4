// ============================================================
// verify-workspace-response.mjs
// Verifica que el bloque response real del workspace (h=1.0, con
// border-top separator) pasa toBeVisible, y diagnostica cuál
// elemento es el primer .frame-content__response (para validar
// el fix de la clase en el live-phrase).
// Uso: node tests/e2e/verify-workspace-response.mjs
// ============================================================
import { chromium } from 'playwright';

const URL = process.env.OS4_URL || 'http://localhost:5173';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Esperar a que se monte el contenido del workspace
    await page.waitForSelector('.frame-content--workspace', { timeout: 15000 });

    // --- 1. Inventario de TODOS los .frame-content__response ---
    const inventory = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('.frame-content__response'));
        return els.map((el, i) => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return {
                index: i,
                className: el.className,
                text: (el.textContent || '').trim().slice(0, 30),
                rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                display: cs.display,
                visibility: cs.visibility,
                fontSize: cs.fontSize,
                lineHeight: cs.lineHeight,
                hasResponseScroll: !!el.querySelector('.frame-content__response-scroll'),
                hasLivePhraseScroll: !!el.querySelector('.conversation-live-phrase__scroll'),
            };
        });
    });

    console.log('=== Inventario .frame-content__response (orden DOM) ===');
    for (const e of inventory) {
        console.log(`[${e.index}] h=${e.rect.h} "${e.className}" text="${e.text}" scroll=response:${e.hasResponseScroll} live:${e.hasLivePhraseScroll} visibility=${e.visibility}`);
    }

    // --- 2. toBeVisible del primer y de los candidatos ---
    const firstResp = page.locator('.frame-content__response').first();
    const firstVisible = await firstResp.isVisible().catch(() => false);
    const firstCount = await page.locator('.frame-content__response').count();
    console.log(`\ncount('.frame-content__response') = ${firstCount}`);
    console.log(`first().isVisible() = ${firstVisible}`);
    console.log(`first().className = "${await firstResp.getAttribute('class')}"`);

    // El bloque response real = el que tiene .frame-content__response-scroll (sin live-phrase)
    const responseBlock = page.locator('.frame-content--workspace .frame-content__response-scroll').locator('..');
    const respBlockVisible = await responseBlock.isVisible().catch(() => false);
    const respRect = await responseBlock.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { h: Math.round(r.height), w: Math.round(r.width) };
    });
    console.log(`\nresponse block real (padre de .frame-content__response-scroll): h=${respRect.h} w=${respRect.w} isVisible=${respBlockVisible}`);

    // --- 3. Live-phrase en workspace ---
    const wsLive = page.locator('.frame-content--workspace .conversation-live-phrase').first();
    const wsLiveAttached = await wsLive.count();
    const wsLiveVisible = await wsLive.isVisible().catch(() => false);
    const wsLiveRect = await wsLive.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { h: Math.round(r.height), y: Math.round(r.y) };
    });
    console.log(`\nworkspace live-phrase: count=${wsLiveAttached} h=${wsLiveRect.h} y=${wsLiveRect.y} isVisible=${wsLiveVisible}`);
    console.log(`workspace live-phrase className="${await wsLive.getAttribute('class')}"`);

    const result = {
        firstRespIsVisible: firstVisible,
        responseBlockIsVisible: respBlockVisible,
        responseBlockH: respRect.h,
        livePhraseH: wsLiveRect.h,
    };
    console.log('\n=== RESULTADO ===');
    console.log(JSON.stringify(result, null, 2));

    if (respBlockVisible && respBlockH > 0) {
        console.log('\n=> PREMISA CONFIRMADA: el bloque response real SÍ es visible (h>0).');
        console.log(`=> .first() isVisible = ${firstVisible}; className = "${await firstResp.getAttribute('class')}"`);
        if (firstVisible) {
            console.log('=> FIX OK: .first() resuelve a un elemento visible.');
        } else {
            console.log('=> .first() aún NO es visible (resuelve a un elemento colapsado).');
        }
    } else {
        console.log('\n=> PREMISA NO CONFIRMADA — revisar manualmente.');
    }

    await page.screenshot({ path: 'reports/verify-workspace-response.png', fullPage: false });
} finally {
    await browser.close();
}
