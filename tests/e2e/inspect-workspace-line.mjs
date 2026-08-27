import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Ensure workspace tab is active
    await page.evaluate(() => {
        const tabs = document.querySelectorAll('.flu-tab-panel');
        tabs.forEach((t) => {
            if (t.classList.contains('flu-tab-panel--workspace')) t.setAttribute('data-force-active', 'true');
        });
    });

    const panel = await page.evaluate(() => {
        const ws = document.querySelector('.flu-tab-panel--workspace');
        if (!ws) return { error: 'NO WORKSPACE PANEL' };

        const toggle = ws.querySelector('.panel-frame__toggle');
        const toggleRect = toggle ? toggle.getBoundingClientRect() : null;

        const frameContent = ws.querySelector('.frame-content--workspace');
        if (!frameContent) return { error: 'NO frame-content--workspace' };

        const children = [];
        const kids = frameContent.children;
        for (let i = 0; i < kids.length; i++) {
            const el = kids[i];
            const rect = el.getBoundingClientRect();
            const cs = window.getComputedStyle(el);
            const firstChild = el.firstElementChild;
            const childText = (el.textContent || '').trim();
            children.push({
                index: i,
                tag: el.tagName,
                className: (el.className || '').toString(),
                rect: { top: rect.top, bottom: rect.bottom, height: rect.height, left: rect.left, width: rect.width },
                borderTop: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
                marginTop: cs.marginTop,
                paddingTop: cs.paddingTop,
                display: cs.display,
                minHeight: cs.minHeight,
                maxHeight: cs.maxHeight,
                empty: childText === '' || childText === '\u00a0',
                textPreview: childText.slice(0, 40),
                hasScrollChild: !!el.querySelector('.frame-content__response-scroll')
            });
        }

        // Also list ALL elements inside ws that have a visible border-top
        const bordered = [];
        ws.querySelectorAll('*').forEach((el) => {
            const cs = window.getComputedStyle(el);
            const bw = parseFloat(cs.borderTopWidth);
            if (bw > 0 && cs.borderTopStyle !== 'none') {
                const rect = el.getBoundingClientRect();
                if (rect.width > 20 && rect.height >= 0) {
                    bordered.push({
                        tag: el.tagName,
                        className: (el.className || '').toString(),
                        borderTop: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
                        rect: { top: rect.top, bottom: rect.bottom, height: rect.height },
                        text: (el.textContent || '').trim().slice(0, 30)
                    });
                }
            }
        });

        const wsRect = ws.getBoundingClientRect();
        const bodyRect = ws.querySelector('.panel-frame__body');
        return {
            toggle: toggleRect ? { top: toggleRect.top, bottom: toggleRect.bottom, yCenter: toggleRect.top + toggleRect.height / 2 } : null,
            panelRect: { top: wsRect.top, bottom: wsRect.bottom },
            bodyRect: bodyRect ? { top: bodyRect.getBoundingClientRect().top, bottom: bodyRect.getBoundingClientRect().bottom } : null,
            children,
            bordered
        };
    });

    console.log('=== PANEL / TOGGLE ===');
    console.log(JSON.stringify({ toggle: panel.toggle, panelRect: panel.panelRect, bodyRect: panel.bodyRect }, null, 2));

    console.log('\n=== CHILDREN OF .frame-content--workspace ===');
    (panel.children || []).forEach((c) => {
        console.log(`[${c.index}] <${c.tag} class="${c.className}">`);
        console.log(`    rect top=${c.rect.top.toFixed(1)} bottom=${c.rect.bottom.toFixed(1)} h=${c.rect.height.toFixed(1)}`);
        console.log(`    borderTop="${c.borderTop}" marginTop=${c.marginTop} paddingTop=${c.paddingTop}`);
        console.log(`    display=${c.display} minH=${c.minHeight} maxH=${c.maxHeight} empty=${c.empty} text="${c.textPreview}" scrollChild=${c.hasScrollChild}`);
    });

    if (panel.toggle) {
        const cy = panel.toggle.yCenter;
        console.log(`\n=== ELEMENTS WITH VISIBLE border-top (yCenter of toggle = ${cy.toFixed(1)}) ===`);
        (panel.bordered || []).forEach((b) => {
            const match = b.rect.top >= cy - 40 && b.rect.top <= cy + 40 ? '  <-- NEAR TOGGLE HEIGHT' : '';
            console.log(`<${b.tag} class="${b.className}"> borderTop="${b.borderTop}" top=${b.rect.top.toFixed(1)} bottom=${b.rect.bottom.toFixed(1)} text="${b.text}"${match}`);
        });
    }

    // Screenshot of the workspace panel
    const wsHandle = await page.$('.flu-tab-panel--workspace');
    if (wsHandle) {
        await wsHandle.screenshot({ path: 'reports/workspace-line-panel.png' });
        console.log('\nScreenshot saved: reports/workspace-line-panel.png');
    }
    await page.screenshot({ path: 'reports/workspace-line-full.png' });
    console.log('Screenshot saved: reports/workspace-line-full.png');

    await browser.close();
})();
