import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // Activate the workspace tab if it's not active
    await page.evaluate(() => {
        const tab = document.querySelector('.flu-shell-tabs__tab[aria-controls="flu-tabpanel-workspace"]');
        if (tab) tab.click();
    });
    await page.waitForTimeout(500);

    const result = await page.evaluate(() => {
        const panel = document.querySelector('.flu-tab-panel--workspace');
        if (!panel) return { error: 'NO WORKSPACE PANEL FOUND' };
        const out = [];
        const describe = (el, label) => {
            if (!el) return;
            const r = el.getBoundingClientRect();
            const cs = window.getComputedStyle(el);
            out.push({
                label,
                tag: el.tagName,
                cls: (el.className && el.className.toString ? el.className.toString() : el.className) || '',
                top: Math.round(r.top * 10) / 10,
                height: Math.round(r.height * 10) / 10,
                display: cs.display,
                flexDir: cs.flexDirection,
                justifyContent: cs.justifyContent,
                alignItems: cs.alignItems,
                gap: cs.gap,
                padding: cs.padding,
                margin: cs.margin,
                minHeight: cs.minHeight,
                lineHeight: cs.lineHeight,
                borderTop: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
                borderBottom: cs.borderBottomWidth + ' ' + cs.borderBottomStyle + ' ' + cs.borderBottomColor,
                textContent: (el.textContent || '').trim().slice(0, 40),
            });
        };

        const tabPanel = document.querySelector('.flu-shell__tab-content .flu-tab-panel--workspace');
        describe(tabPanel, 'tab-panel--workspace');
        const section = panel.closest('.flu-shell__tab-content');
        describe(section, 'flu-shell__tab-content');

        const frame = panel.querySelector('.panel-frame');
        describe(frame, 'panel-frame');
        const header = panel.querySelector('.panel-frame__header');
        describe(header, 'panel-frame__header');
        const titles = panel.querySelector('.panel-frame__header-titles');
        describe(titles, 'header-titles');
        const titleEl = panel.querySelector('.panel-frame__title');
        describe(titleEl, 'panel-frame__title');
        const actions = panel.querySelector('.panel-frame__header-actions');
        describe(actions, 'header-actions');
        const toggle = panel.querySelector('.panel-frame__toggle');
        describe(toggle, 'panel-frame__toggle');
        const body = panel.querySelector('.panel-frame__body');
        describe(body, 'panel-frame__body');

        // Walk ALL children of header with geometry to find wasted space
        out.push({ label: '--- header children order ---' });
        if (header) {
            Array.from(header.children).forEach((child, i) => {
                describe(child, 'header-child[' + i + ']');
            });
        }

        return out;
    });

    console.log(JSON.stringify(result, null, 2));
    await browser.close();
})();
