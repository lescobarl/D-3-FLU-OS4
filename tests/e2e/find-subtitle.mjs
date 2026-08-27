import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const result = await page.evaluate(() => {
        // Find ANY element with "subtitle" or "subtitulo" in className or id
        const all = document.querySelectorAll('[class*="subtitle" i], [class*="subtitulo" i], [id*="subtitle" i], [id*="subtitulo" i]');
        const results = [];
        all.forEach(el => {
            results.push({
                tag: el.tagName,
                className: el.className,
                id: el.id,
                text: el.textContent?.trim().substring(0, 100),
                html: el.outerHTML.substring(0, 200)
            });
        });
        return results;
    });

    console.log('=== ELEMENTS WITH "subtitle" IN CLASS/ID ===');
    console.log(JSON.stringify(result, null, 2));

    // Also find ALL strong elements in the workspace panel
    const strongs = await page.evaluate(() => {
        const panel = document.querySelector('.flu-tab-panel--workspace');
        if (!panel) return [];
        const strongs = panel.querySelectorAll('strong');
        return Array.from(strongs).map(s => ({
            text: s.textContent?.trim().substring(0, 100),
            className: s.className,
            html: s.outerHTML.substring(0, 200)
        }));
    });

    console.log('\n=== ALL <strong> IN WORKSPACE PANEL ===');
    console.log(JSON.stringify(strongs, null, 2));

    // Find ALL elements with class containing "title"
    const titles = await page.evaluate(() => {
        const panel = document.querySelector('.flu-tab-panel--workspace');
        if (!panel) return [];
        const all = panel.querySelectorAll('[class*="title" i]');
        return Array.from(all).map(el => ({
            tag: el.tagName,
            className: el.className,
            text: el.textContent?.trim().substring(0, 100)
        }));
    });

    console.log('\n=== ALL "title" ELEMENTS IN WORKSPACE ===');
    console.log(JSON.stringify(titles, null, 2));

    await browser.close();
})();
