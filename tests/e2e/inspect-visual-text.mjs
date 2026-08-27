import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Get ALL text content from the ENTIRE page, not just workspace panel
    const allText = await page.evaluate(() => {
        const results = [];
        const walker = document.createTreeWalker(
            document.body,
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
                    id: parent.id,
                    fontSize: style.fontSize,
                    fontWeight: style.fontWeight,
                    visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
                    top: Math.round(rect.top),
                    left: Math.round(rect.left)
                });
            }
        }
        return results;
    });

    console.log('=== ALL VISIBLE TEXT ON PAGE ===');
    allText.filter(t => t.visible).forEach((d, i) => {
        console.log(`[${i}] "${d.text}" at (${d.left},${d.top}) ${d.tag}.${d.className} font=${d.fontSize}`);
    });

    // Also dump the full page HTML structure around the workspace
    const workspaceSection = await page.evaluate(() => {
        const panel = document.querySelector('.flu-tab-panel--workspace');
        if (!panel) return 'NO PANEL';
        // Get the parent chain
        let el = panel;
        const chain = [];
        while (el && el !== document.body) {
            chain.unshift({
                tag: el.tagName,
                id: el.id,
                className: el.className,
                childCount: el.children.length
            });
            el = el.parentElement;
        }
        return chain;
    });

    console.log('\n=== WORKSPACE PARENT CHAIN ===');
    workspaceSection.forEach(d => {
        console.log(`${d.tag}#${d.id}.${d.className} children=${d.childCount}`);
    });

    await browser.close();
})();
