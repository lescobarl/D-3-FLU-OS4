import { chromium } from 'playwright';
import sharp from 'sharp';

const DPR = 2;

function colorDist(a, b) {
    return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: DPR });
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Activate workspace tab
    await page.evaluate(() => {
        const tab = document.querySelector('.flu-shell-tabs__tab[aria-controls="flu-tabpanel-workspace"]');
        if (tab) tab.click();
        const ws = document.querySelector('.flu-tab-panel--workspace');
        if (ws) ws.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(800);

    const panel = await page.$('.flu-tab-panel--workspace');
    if (!panel) { console.log('NO PANEL'); await browser.close(); return; }
    const rect = await panel.boundingBox();

    // Geometry reference for correlation (CSS px)
    const geo = await page.evaluate(() => {
        const ws = document.querySelector('.flu-tab-panel--workspace');
        const pick = (sel) => {
            const el = ws.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, height: r.height, left: r.left, right: r.right };
        };
        return {
            panelTop: ws.getBoundingClientRect().top,
            header: pick('.panel-frame__header'),
            titles: pick('.panel-frame__header-titles'),
            toggle: pick('.panel-frame__toggle'),
            body: pick('.panel-frame__body'),
        };
    });

    const capCss = 120; // capture top 120 CSS px of the panel
    const buf = await page.screenshot({
        clip: { x: rect.x, y: rect.y, width: rect.width, height: Math.min(capCss, rect.height) },
        scale: 'device',
    });

    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const W = info.width;
    const H = info.height;
    const C = info.channels;

    // Estimate modal (background) color via quantized histogram
    const hist = new Map();
    for (let i = 0; i < W * H; i++) {
        const idx = i * C;
        const key = (data[idx] >> 4) * 4096 + (data[idx + 1] >> 4) * 256 + (data[idx + 2] >> 4);
        hist.set(key, (hist.get(key) || 0) + 1);
    }
    let bestKey = null, bestN = -1;
    for (const [k, n] of hist) if (n > bestN) { bestN = n; bestKey = k; }
    const bg = [((bestKey >> 12) & 15) * 16 + 8, ((bestKey >> 8) & 15) * 16 + 8, (bestKey & 15) * 16 + 8];
    console.log('Background modal color:', bg, 'count', bestN, '/', W * H);

    const THRESH = 42; // euclidean distance to be considered "content"

    // Per-row content stats (in device px)
    const rowContent = new Array(H).fill(0);   // count of content pixels
    const rowMinX = new Array(H).fill(Infinity);
    const rowMaxX = new Array(H).fill(-1);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const idx = (y * W + x) * C;
            const d = colorDist([data[idx], data[idx + 1], data[idx + 2]], bg);
            if (d > THRESH) {
                rowContent[y]++;
                if (x < rowMinX[y]) rowMinX[y] = x;
                if (x > rowMaxX[y]) rowMaxX[y] = x;
            }
        }
    }

    // ASCII map: one line per 2 CSS px (=4 device px), width compressed to ~110 cols
    const cols = 110;
    const stepY = DPR * 2;
    const stepX = Math.max(1, Math.floor(W / cols));
    console.log('\n=== ASCII CONTENT MAP (panel top ' + capCss + 'px CSS) ===');
    console.log('  y(pix) y(css) | content map (right edge of map = panel right edge)');
    for (let y = 0; y < H; y += stepY) {
        let line = '';
        for (let x = 0; x < W; x += stepX) {
            let found = false;
            for (let dy = 0; dy < stepY && !found; dy += 1) {
                for (let dx = 0; dx < stepX && !found; dx += 1) {
                    const yy = Math.min(y + dy, H - 1);
                    const xx = Math.min(x + dx, W - 1);
                    const idx = (yy * W + xx) * C;
                    if (colorDist([data[idx], data[idx + 1], data[idx + 2]], bg) > THRESH) {
                        found = true;
                    }
                }
            }
            line += found ? '#' : '.';
        }
        const cssY = (y / DPR).toFixed(1);
        const pixY = y;
        let tag = '';
        const t = geo.toggle, hd = geo.header, bd = geo.body;
        if (hd) {
            const relHdTop = (hd.top - geo.panelTop);
            const relHdBot = (hd.bottom - geo.panelTop);
            const relTgTop = (t.top - geo.panelTop);
            const relTgBot = (t.bottom - geo.panelTop);
            const relBdTop = (bd.top - geo.panelTop);
            if (Math.abs((y / DPR) - relHdTop) < 2) tag = ' <== HEADER top';
            if (Math.abs((y / DPR) - relTgTop) < 2) tag = ' <== TOGGLE(arrow) top';
            if (Math.abs((y / DPR) - relTgBot) < 2) tag = ' <== TOGGLE(arrow) bottom';
            if (Math.abs((y / DPR) - relHdBot) < 2) tag = ' <== HEADER bottom / separator line?';
            if (Math.abs((y / DPR) - relBdTop) < 2) tag = ' <== BODY top';
        }
        console.log(String(pixY).padStart(5) + ' ' + cssY.padStart(6) + ' | ' + line + tag);
    }

    // Summary: find empty full-width bands and content bands
    console.log('\n=== ROW SUMMARY (css px) ===');
    const summary = [];
    for (let y = 0; y < H; y += DPR * 2) {
        const cnt = rowContent[y];
        summary.push({ cssY: +(y / DPR).toFixed(1), content: cnt, minX: rowMinX[y] === Infinity ? -1 : Math.round(rowMinX[y] / DPR), maxX: rowMaxX[y] === -1 ? -1 : Math.round(rowMaxX[y] / DPR) });
    }
    // Collapse consecutive identical-ish states
    let last = null, start = 0;
    const bands = [];
    for (let i = 0; i < summary.length; i++) {
        const s = summary[i];
        const state = s.content === 0 ? 'EMPTY' : (s.content < 400 ? 'SPARSE(right-only?)' : 'CONTENT');
        if (last !== state) {
            if (last !== null) bands.push({ from: summary[start].cssY, to: summary[i - 1].cssY, state: last });
            last = state; start = i;
        }
    }
    if (last !== null) bands.push({ from: summary[start].cssY, to: summary[summary.length - 1].cssY, state: last });
    bands.forEach((b) => {
        const extra = b.state === 'SPARSE(right-only?)' ? ' -> only the ⤢ arrow region at far right' : '';
        console.log(`  cssY ${b.from}..${b.to}  ${b.state}${extra}`);
    });

    console.log('\n=== GEOMETRY REFERENCE ===');
    console.log('panel top:', geo.panelTop.toFixed(1));
    console.log('header   :', JSON.stringify(geo.header));
    console.log('titles   :', JSON.stringify(geo.titles));
    console.log('toggle   :', JSON.stringify(geo.toggle));
    console.log('body     :', JSON.stringify(geo.body));

    await page.screenshot({ path: 'reports/workspace-current-top.png' });
    await browser.close();
})();
