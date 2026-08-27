/**
 * inspect-avatar-scene.mjs
 * ============================================================
 * Diagnóstico RUNTIME del avatar FLU:
 *   1. Muestra el color PROMEDIO de cada textura PNG del bunny
 *      (¿las texturas son grises o de color tan/rojo/azul?).
 *   2. Reporta el canvas y el estado global disponible.
 *
 * Run: node scripts/inspect-avatar-scene.mjs
 * (Requiere el dev server en http://localhost:5173/)
 * ============================================================
 */
import { chromium } from 'playwright';

const URL = 'http://localhost:5173/';
const TEXTURES = [
    'Bunny_Body_1_D.png', 'Bunny_Face_1_D.png', 'Bunny_Pants_1_D.png', 'Bunny_Cap_1_D.png',
    'Bunny_Body_1_N.png', 'Bunny_Body_1_R.png', 'Bunny_Body_1_M.png',
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

page.on('console', (m) => {
    if (m.type() === 'error') console.log('[CONSOLE.ERROR]', m.text());
});
page.on('pageerror', (e) => console.log('[PAGEERROR]', e.message));

console.log('Navegando a ' + URL);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('.flu-bridge-container canvas', { timeout: 30000 });
await page.waitForTimeout(9000);

// --- 1) Sample de texturas del bunny ---
const texSample = await page.evaluate(async (names) => {
    const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    const out = [];
    for (const name of names) {
        const url = '/textures/' + name;
        try {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            const loaded = await new Promise((res) => {
                img.onload = () => res(true);
                img.onerror = () => res(false);
                img.src = url;
            });
            if (!loaded) { out.push({ name, status: '404/error', size: null }); continue; }
            const c = document.createElement('canvas');
            c.width = img.naturalWidth || 1;
            c.height = img.naturalHeight || 1;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);
            const d = ctx.getImageData(0, 0, c.width, c.height).data;
            let sr = 0, sg = 0, sb = 0, n = 0;
            for (let i = 0; i < d.length; i += 4) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++; }
            out.push({
                name,
                status: 'ok',
                size: c.width + 'x' + c.height,
                avgColor: hex(Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)),
            });
        } catch (e) {
            out.push({ name, status: 'error: ' + String(e), size: null });
        }
    }
    return out;
}, TEXTURES);

console.log('=================== TEXTURAS ===================');
console.log(JSON.stringify(texSample, null, 2));

// --- 2) Intento de alcanzar la escena R3F (defensivo) ---
const sceneInfo = await page.evaluate(() => {
    const c = document.querySelector('.flu-bridge-container canvas');
    const out = { canvasFound: !!c, accessors: {} };
    if (!c) return out;
    out.accessors.canvasGetState = typeof c.getState;
    out.accessors.canvasR3f = typeof c.__r3f;
    out.accessors.windowR3f = typeof window.__r3f;
    out.accessors.windowR3fRoots = typeof window.__R3F__;
    out.accessors.bunnyStore = typeof window.__bunnyStore;
    out.accessors.bunnyPreloadDone = window.__bunnyPreloadDone;
    out.accessors.bunnyProbe = typeof window.__bunnyProbe;
    // Acceso al store de Zustand del bunny
    if (window.__bunnyStore && window.__bunnyStore.getState) {
        const s = window.__bunnyStore.getState();
        out.bunnyState = {
            componentColors: s.componentColors,
            animationSpeed: s.animationSpeed,
            activeExpression: s.activeExpression,
            expression: s.expression,
        };
    }
    return out;
});
console.log('=================== ESCENA ===================');
console.log(JSON.stringify(sceneInfo, null, 2));

await browser.close();
