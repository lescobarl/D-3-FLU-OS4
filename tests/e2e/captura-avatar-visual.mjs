/**
 * captura-avatar-visual.mjs
 * ============================================================
 * Captura una screenshot del avatar FLU renderizado y ANALIZA
 * los píxeles del canvas WebGL para describir objetivamente
 * cómo se ve el modelo (¿calavera? ¿texturas? ¿ojos negros?
 * ¿encuadre demasiado cercano?).
 *
 * Run: node tests/e2e/captura-avatar-visual.mjs
 * (Requiere el dev server en http://localhost:5173/)
 *
 * Metodología:
 *   1. Flood-fill desde los bordes del canvas para separar el
 *      FONDO REAL (cualquier color, no asume #1a1a2e) del
 *      SILUETA del modelo.
 *   2. Estadística de color sobre la silueta real del modelo.
 *   3. Diagnóstico de ENCUADRE: si el bbox del modelo toca los
 *      4 bordes → el avatar está recortado / demasiado cercano.
 *   4. Región de cabeza = tercio superior del bbox del modelo,
 *      con detección de bandas oscuras (ojos/boca).
 *
 * Salida:
 *   reports/avatar-visual/full.png      → screenshot completa
 *   reports/avatar-visual/canvas.png    → screenshot SOLO canvas
 *   reports/avatar-visual/analysis.json → análisis de píxeles
 * ============================================================
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const URL = 'http://localhost:5173/';
const OUT = 'reports/avatar-visual';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
});
const page = await context.newPage();

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => {
    if (m.type() === 'error') console.log('[CONSOLE.ERROR]', m.text());
});

console.log('Navegando a ' + URL);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('.flu-bridge-container canvas', { timeout: 30000 });
console.log('Canvas del avatar presente');

// Esperar carga del modelo FBX (SwiftShader lento) + preload de animaciones
await page.waitForTimeout(7000);

// ------------------------------------------------------------
// 1) Estado del modelo vía __bunnyProbe
// ------------------------------------------------------------
const modelInfo = await page.evaluate(() => {
    const p = window.__bunnyProbe;
    if (!p) return { hasProbe: false };
    let clipStatus = null;
    let active = null;
    try { clipStatus = p.clipStatus ? p.clipStatus() : null; } catch (e) { clipStatus = { err: String(e) }; }
    try { active = p.activeActions ? p.activeActions() : null; } catch (e) { active = { err: String(e) }; }
    return {
        hasProbe: true,
        ready: p.ready ? p.ready([]) : null,
        clipStatus,
        active,
    };
});
console.log('Estado del modelo:', JSON.stringify(modelInfo, null, 2));

// ------------------------------------------------------------
// 2) Screenshots
// ------------------------------------------------------------
await page.screenshot({ path: OUT + '/full.png', fullPage: false });
console.log('Screenshot pagina completa -> reports/avatar-visual/full.png');

const canvasBox = await page.evaluate(() => {
    const c = document.querySelector('.flu-bridge-container canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
});
console.log('Canvas bounding box:', JSON.stringify(canvasBox));

if (canvasBox) {
    await page.screenshot({
        path: OUT + '/canvas.png',
        clip: { x: canvasBox.x, y: canvasBox.y, width: canvasBox.w, height: canvasBox.h },
    });
    console.log('Screenshot canvas -> reports/avatar-visual/canvas.png');
}

// ------------------------------------------------------------
// 3) Análisis de píxeles del canvas WebGL (flood-fill desde borde)
// ------------------------------------------------------------
const analysis = await page.evaluate(() => {
    const c = document.querySelector('.flu-bridge-container canvas');
    if (!c) return { ok: false, reason: 'no-canvas' };
    const w = c.width, h = c.height;
    if (!w || !h) return { ok: false, reason: 'canvas zero size' };

    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const ctx = tmp.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(c, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const n = w * h;

    const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
    const hex3 = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

    // --- 1) Fondo REAL: promedio de las 4 esquinas del canvas ---
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

    // --- 2) Flood-fill desde todos los bordes: todo lo conectado
    //         al borde y "similar al fondo" = fondo. El resto = MODELO.
    const visited = new Uint8Array(n); // 1 = fondo
    const stack = [];
    const TOL = 900; // tolerancia cuadrática (~30 por canal)

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

    // --- 3) Recolección sobre el MODELO (píxeles no-fondo) ---
    let bgCount = 0, nonBgCount = 0;
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    let darkCount = 0, brightCount = 0, midCount = 0;
    let sumR = 0, sumG = 0, sumB = 0;
    const hist = new Map();

    for (let i = 0; i < n; i++) {
        if (visited[i]) { bgCount++; continue; }
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

    // --- 4) Encuadre: ¿el modelo toca los bordes del canvas? ---
    const touches = {
        left: minX <= 1,
        right: maxX >= w - 2,
        top: minY <= 1,
        bottom: maxY >= h - 2,
    };
    const croppedHoriz = touches.left && touches.right;
    const croppedVert = touches.top && touches.bottom;
    const framing = {
        touches,
        croppedHoriz,
        croppedVert,
        fillsFrame: croppedHoriz || croppedVert,
        modelBBoxPctOfCanvas: nonBgCount ? {
            wPct: +((modelW / w) * 100).toFixed(1),
            hPct: +((modelH / h) * 100).toFixed(1),
        } : null,
    };

    // --- 5) Región de CABEZA (tercio superior del bbox, 2ª pasada) ---
    let sumHeadR = 0, sumHeadG = 0, sumHeadB = 0, headCount = 0, headDarkCount = 0;
    const headTop = minY;
    const headBottom = minY + Math.floor(modelH * 0.30);
    const rowDark = new Array(h).fill(0);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (visited[i]) continue;
            const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
            const L = lum(r, g, b);
            if (y >= headTop && y <= headBottom) {
                sumHeadR += r; sumHeadG += g; sumHeadB += b; headCount++;
                if (L < 45) headDarkCount++;
            }
            if (L < 45) rowDark[y]++;
        }
    }

    // Bandas oscuras (ojos/boca) dentro de la región de la cabeza
    const darkRows = [];
    for (let y = headTop; y <= headBottom && y < h; y++) {
        if (rowDark[y] >= 2) darkRows.push({ y, count: rowDark[y] });
    }
    const bands = [];
    let cur = null;
    for (const rr of darkRows) {
        if (!cur) cur = { y0: rr.y, y1: rr.y, total: rr.count };
        else if (rr.y - cur.y1 <= 2) { cur.y1 = rr.y; cur.total += rr.count; }
        else { bands.push(cur); cur = { y0: rr.y, y1: rr.y, total: rr.count }; }
    }
    if (cur) bands.push(cur);

    const topColors = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map((entry) => {
            const k = entry[0], cnt = entry[1];
            const r = (k >> 8) << 4, g = ((k >> 4) & 0xf) << 4, b = (k & 0xf) << 4;
            return { hex: hex3(r, g, b), count: cnt, pct: +((cnt / Math.max(1, nonBgCount)) * 100).toFixed(1) };
        });

    return {
        ok: true,
        canvasW: w,
        canvasH: h,
        backgroundDetected: { r: bgR, g: bgG, b: bgB, hex: hex3(bgR, bgG, bgB) },
        expectedBackgroundHex: '#1a1a2e',
        bgCount,
        nonBgCount,
        coveragePct: +((nonBgCount / n) * 100).toFixed(2),
        modelBBox: nonBgCount > 0 ? { minX, minY, maxX, maxY, w: modelW, h: modelH } : null,
        framing,
        pixelClasses: {
            dark: darkCount,
            mid: midCount,
            bright: brightCount,
            darkPctOfModel: nonBgCount ? +((darkCount / nonBgCount) * 100).toFixed(1) : 0,
            brightPctOfModel: nonBgCount ? +((brightCount / nonBgCount) * 100).toFixed(1) : 0,
        },
        avgColorModel: nonBgCount ? {
            r: Math.round(sumR / nonBgCount),
            g: Math.round(sumG / nonBgCount),
            b: Math.round(sumB / nonBgCount),
            hex: hex3(Math.round(sumR / nonBgCount), Math.round(sumG / nonBgCount), Math.round(sumB / nonBgCount)),
        } : null,
        headRegion: headCount ? {
            avg: {
                r: Math.round(sumHeadR / headCount),
                g: Math.round(sumHeadG / headCount),
                b: Math.round(sumHeadB / headCount),
                hex: hex3(Math.round(sumHeadR / headCount), Math.round(sumHeadG / headCount), Math.round(sumHeadB / headCount)),
            },
            darkPixels: headDarkCount,
            darkPctOfHead: +((headDarkCount / headCount) * 100).toFixed(1),
            rows: { y0: headTop, y1: headBottom },
        } : null,
        topColors,
        darkBandsInHead: bands.map((b) => ({ y0: b.y0, y1: b.y1, darkPx: b.total })),
        darkBandsCount: bands.length,
    };
});

// ------------------------------------------------------------
// 4) Reporte
// ------------------------------------------------------------
const report = { url: URL, capturedAt: new Date().toISOString(), pageErrors, modelInfo, canvasBox, analysis };
writeFileSync(OUT + '/analysis.json', JSON.stringify(report, null, 2));
console.log('Analisis guardado -> reports/avatar-visual/analysis.json');

console.log('\n========== RESUMEN VISUAL DEL AVATAR ==========');
if (!analysis.ok) {
    console.log('No se pudo analizar el canvas: ' + analysis.reason);
} else {
    const a = analysis;
    console.log('Canvas: ' + a.canvasW + 'x' + a.canvasH + 'px');
    console.log('Fondo detectado en el render: ' + a.backgroundDetected.hex + ' rgb(' + a.backgroundDetected.r + ',' + a.backgroundDetected.g + ',' + a.backgroundDetected.b + ') (esperado #1a1a2e)');
    console.log('Cobertura no-fondo: ' + a.coveragePct + '%');
    if (a.modelBBox) {
        const bb = a.modelBBox;
        console.log('BBox del modelo: x[' + bb.minX + '..' + bb.maxX + '] y[' + bb.minY + '..' + bb.maxY + '] (' + bb.w + 'x' + bb.h + 'px)');
    }
    console.log('ENCUADRE: toca borde izq=' + a.framing.touches.left + ' der=' + a.framing.touches.right + ' sup=' + a.framing.touches.top + ' inf=' + a.framing.touches.bottom);
    console.log('ENCUADRE: ¿recortado horizontalmente? ' + a.framing.croppedHoriz + ' | ¿verticalmente? ' + a.framing.croppedVert + ' | ¿llena el frame? ' + a.framing.fillsFrame);
    if (a.framing.modelBBoxPctOfCanvas) {
        console.log('ENCUADRE: bbox del modelo cubre ' + a.framing.modelBBoxPctOfCanvas.wPct + '% del ancho y ' + a.framing.modelBBoxPctOfCanvas.hPct + '% de la altura del canvas');
    }
    console.log('Clases de pixel (modelo): oscuro=' + a.pixelClasses.dark + ' (' + a.pixelClasses.darkPctOfModel + '%), medio=' + a.pixelClasses.mid + ', brillante=' + a.pixelClasses.bright + ' (' + a.pixelClasses.brightPctOfModel + '%)');
    console.log('Color promedio del modelo: ' + a.avgColorModel.hex + ' rgb(' + a.avgColorModel.r + ',' + a.avgColorModel.g + ',' + a.avgColorModel.b + ')');
    if (a.headRegion) {
        console.log('Region de CABEZA (filas ' + a.headRegion.rows.y0 + '..' + a.headRegion.rows.y1 + '): color ' + a.headRegion.avg.hex + ', pixeles oscuros=' + a.headRegion.darkPixels + ' (' + a.headRegion.darkPctOfHead + '%)');
        console.log('Bandas oscuras (candidatas a ojos) en la cabeza: ' + a.darkBandsCount);
        (a.darkBandsInHead || []).forEach((b, i) => console.log('   banda ' + i + ': filas y[' + b.y0 + '..' + b.y1 + '], pixeles oscuros=' + b.darkPx));
    } else {
        console.log('Region de CABEZA: sin píxeles de modelo en el tercio superior');
    }
    console.log('Colores dominantes del modelo:');
    (a.topColors || []).forEach((tc) => console.log('   ' + tc.hex + ' -> ' + tc.pct + '%'));
}
console.log('=================================================');
console.log('Page errors: ' + (pageErrors.length ? pageErrors.join(' | ') : 'ninguno'));

await browser.close();
