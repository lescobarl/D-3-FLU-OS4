import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Get ALL text nodes inside the workspace panel with their CSS styles
    const details = await page.evaluate(() => {
        const panel = document.querySelector('.flu-tab-panel--workspace');
        if (!panel) return 'NO WORKSPACE PANEL FOUND';

        const results = [];
        const walker = document.createTreeWalker(
            panel,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let node;
        while (node = walker.nextNode()) {
            const text = node.textContent.trim();
            if (text) {
                const parent = node.parentElement;
                const rect = parent.getBoundingClientRect();
                const style = window.getComputedStyle(parent);
                results.push({
                    text: text,
                    tag: parent.tagName,
                    className: parent.className,
                    fontSize: style.fontSize,
                    fontWeight: style.fontWeight,
                    color: style.color,
                    display: style.display,
                    position: style.position,
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height
                });
            }
        }
        return results;
    });

    console.log('=== ALL VISIBLE TEXT NODES IN WORKSPACE PANEL ===');
    details.forEach((d, i) => {
        console.log(`[${i}] "${d.text}"`);
        console.log(`    tag=${d.tag} class="${d.className}"`);
        console.log(`    font=${d.fontSize} weight=${d.fontWeight} color=${d.color}`);
        console.log(`    pos=(${d.left},${d.top}) size=${d.width}x${d.height}`);
    });

    // Also check for any pseudo-elements
    const pseudoElements = await page.evaluate(() => {
        const panel = document.querySelector('.flu-tab-panel--workspace');
        if (!panel) return [];

        const results = [];
        const elements = panel.querySelectorAll('*');
        elements.forEach(el => {
            const before = window.getComputedStyle(el, '::before');
            const after = window.getComputedStyle(el, '::after');
            const beforeContent = before.content;
            const afterContent = after.content;
            if (beforeContent && beforeContent !== 'none' && beforeContent !== '') {
                results.push({
                    element: `${el.tagName}.${el.className}`,
                    pseudo: '::before',
                    content: beforeContent,
                    fontSize: before.fontSize
                });
            }
            if (afterContent && afterContent !== 'none' && afterContent !== '') {
                results.push({
                    element: `${el.tagName}.${el.className}`,
                    pseudo: '::after',
                    content: afterContent,
                    fontSize: after.fontSize
                });
            }
        });
        return results;
    });

    console.log('\n=== PSEUDO-ELEMENTS ===');
    pseudoElements.forEach(p => {
        console.log(`${p.element} ${p.pseudo}: content="${p.content}" font-size=${p.fontSize}`);
    });

    await browser.close();
})();
