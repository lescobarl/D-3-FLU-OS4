/**
 * sample-os1-screenshots.mjs
 * ============================================================
 * Analiza los screenshots ORIGINALES del bunny en D-3-FLU-OS1
 * (bunny-screenshot*.png) para establecer qué aspecto tenía el
 * avatar "original" realmente (colores, brillo, encuadre).
 *
 * Los PNG se cargan como data URL (mismo-origin para canvas) y
 * se aplica el MISMO análisis que captura-avatar-visual.mjs:
 * flood-fill desde bordes, clases de pixel, histograma, región
 * de cabeza.
 *
 * Run: node scripts/sample-os1-screenshots.mjs
 * Salida: reports/avatar-visual/os1-<name>.json + resumen en consola
 * ============================================================
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const OS1_DIR = resolve('..', 'D-3-FLU-OS1', 'flu-os');
const OUT = 'reports/avatar-visual';
mkdirSync(OUT, { recursive: true });

const FILES = ['bunny-screenshot.png', 'bunny-screenshot-idle.png', 'bunny-screenshot-later.png'];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

for (const f of FILES) {
    const fullPath = resolve(OS1_DIR, f);
    let b64;
    try {
        b64 = readFileSync(fullPath).toString('base64');
    } catch (e) {
        console.log(`[SKIP] No existe ${fullPath}`);
        continue;
    }

    const analysis = await page.evaluate(async (base64) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + base64;
        await img.decode();
        const w = img.naturalWidth, h = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, w, h);
        const d = id.data;
        const n = w * h;

        const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
        const hex3 = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

        // --- Fondo REAL: promedio de las 4 esquinas ---
        const corner = (x, y) => {
            const i = (y * w + x) * 4;
            return { r: d[i], g: d[i + 1], b: d[i + 2] };
        };
        const cs = [corner(0, 0), corner(w - 1, 0), corner(0, h - 1), corner(w - 1, h - 1)];
        const bgR = Math.round((cs[0].r + cs[1].r + cs[2].r + cs[3].r) / 4);
        const bgG = Math.round((cs[0].g + cs[1].g + cs[2].g + cs[3].g) / 4);
        const bgB = Math.round((cs[0].b + cs[1].b + cs[2].b + cs[3].b) / 4);

        const isLikeBg = (r, g, b, tol) => {
            const dr = r - bgR, dg = g - bgG, db = b - bgB;
            return (dr * dr + dg * dg + db * db) < tol;
        };

        // --- Flood-fill desde bordes ---
        const visited = new Uint8Array(n);
        const stack = [];
        const TOL = 900;
        const seed = (x, y) => {
            const idx = y * w + x;
            if (visited[idx]) return;
            const i = idx * 4;
            if (isLikeBg(d[i], d[i + 1], d[i + 2], TOL)) { visited[idx] = 1; stack.push(idx); }
        };
        for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
        for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
        while (stack.length) {
            const idx = stack.pop();
            const x = idx % w, y = (idx / w) | 0;
            if (x > 0) seed(x - 1, y);
            if (x < w - 1) seed(x + 1, y);
            if (y > 0) seed(x, y - 1);
            if (y < h - 1) seed(x, y + 1);
        }

        // --- Recolección sobre el modelo ---
        let nonBgCount = 0;
        let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
        let darkCount = 0, brightCount = 0, midCount = 0;
        let sumR = 0, sumG = 0, sumB = 0;
        const hist = new Map();

        for (let i = 0; i < n; i++) {
            if (visited[i]) continue;
            nonBgCount++;
            const x = i % w, y = (i / w) | 0;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
            const L = lum(r, g, b);
            if (L < 45) darkCount++; else if (L > 200) brightCount++; else midCount++;
            sumR += r; sumG += g; sumB += b;
            const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
            hist.set(key, (hist.get(key) || 0) + 1);
        }

        const modelW = maxX - minX + 1, modelH = maxY - minY + 1;

        // --- Región de cabeza (tercio superior) ---
        let sumHeadR = 0, sumHeadG = 0, sumHeadB = 0, headCount = 0, headDarkCount = 0;
        const headTop = minY, headBottom = minY + Math.floor(modelH * 0.30);
        for (let y = headTop; y <= headBottom && y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                if (visited[i]) continue;
                const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
                sumHeadR += r; sumHeadG += g; sumHeadB += b; headCount++;
                if (lum(r, g, b) < 45) headDarkCount++;
            }
        }

        const topColors = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
            .map((entry) => {
                const k = entry[0], cnt = entry[1];
                const r = (k >> 8) << 4, g = ((k >> 4) & 0xf) << 4, b = (k & 0xf) << 4;
                return { hex: hex3(r, g, b), count: cnt, pct: +((cnt / Math.max(1, nonBgCount)) * 100).toFixed(1) };
            });

        return {
            ok: true,
            imgW: w, imgH: h,
            backgroundDetected: { r: bgR, g: bgG, b: bgB, hex: hex3(bgR, bgG, bgB) },
            nonBgCount,
            coveragePct: +((nonBgCount / n) * 100).toFixed(2),
            modelBBox: nonBgCount > 0 ? { minX, minY, maxX, maxY, w: modelW, h: modelH } : null,
            pixelClasses: {
                dark: darkCount, mid: midCount, bright: brightCount,
                darkPctOfModel: nonBgCount ? +((darkCount / nonBgCount) * 100).toFixed(1) : 0,
                midPctOfModel: nonBgCount ? +((midCount / nonBgCount) * 100).toFixed(1) : 0,
                brightPctOfModel: nonBgCount ? +((brightCount / nonBgCount) * 100).toFixed(1) : 0,
            },
            avgColorModel: nonBgCount ? {
                r: Math.round(sumR / nonBgCount), g: Math.round(sumG / nonBgCount), b: Math.round(sumB / nonBgCount),
                hex: hex3(Math.round(sumR / nonBgCount), Math.round(sumG / nonBgCount), Math.round(sumB / nonBgCount)),
            } : null,
            headRegion: headCount ? {
                avg: {
                    r: Math.round(sumHeadR / headCount), g: Math.round(sumHeadG / headCount), b: Math.round(sumHeadB / headCount),
                    hex: hex3(Math.round(sumHeadR / headCount), Math.round(sumHeadG / headCount), Math.round(sumHeadB / headCount)),
                },
                darkPixels: headDarkCount,
                darkPctOfHead: +((headDarkCount / headCount) * 100).toFixed(1),
            } : null,
            topColors,
        };
    }, b64);

    const outName = OUT + '/os1-' + f.replace('.png', '') + '.json';
    writeFileSync(outName, JSON.stringify({ file: f, sizeKB: Math.round(b64.length * 0.75 / 1024), analysis }, null, 2));
    console.log('\n========== ' + f + ' ==========');
    if (analysis.ok) {
        const a = analysis;
        console.log('Tamaño imagen: ' + a.imgW + 'x' + a.imgH);
        console.log('Fondo detectado: ' + a.backgroundDetected.hex);
        console.log('Cobertura no-fondo: ' + a.coveragePct + '%');
        if (a.modelBBox) console.log('BBox modelo: ' + a.modelBBox.w + 'x' + a.modelBBox.h + ' en ' + a.modelBBox.minX + ',' + a.modelBBox.minY);
        console.log('Clases pixel: oscuro=' + a.pixelClasses.darkPctOfModel + '%, medio=' + a.pixelClasses.midPctOfModel + '%, brillante=' + a.pixelClasses.brightPctOfModel + '%');
        console.log('Color PROMEDIO modelo: ' + a.avgColorModel.hex);
        if (a.headRegion) console.log('Región CABEZA: ' + a.headRegion.avg.hex + ' (oscuros ' + a.headRegion.darkPctOfHead + '%)');
        console.log('Colores dominantes:');
        (a.topColors || []).forEach((tc) => console.log('   ' + tc.hex + ' -> ' + tc.pct + '%'));
    } else {
        console.log('Análisis falló');
    }
    console.log('Guardado -> ' + outName);
}

await browser.close();
console.log('\nListo.');
