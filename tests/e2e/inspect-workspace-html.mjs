import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Get the workspace panel HTML
    const workspaceHTML = await page.evaluate(() => {
        const panel = document.querySelector('.flu-tab-panel--workspace');
        if (!panel) return 'NO WORKSPACE PANEL FOUND';
        return panel.outerHTML;
    });

    console.log('=== WORKSPACE PANEL HTML ===');
    console.log(workspaceHTML);

    // Also get all text content within the workspace panel
    const textContent = await page.evaluate(() => {
        const panel = document.querySelector('.flu-tab-panel--workspace');
        if (!panel) return 'NO WORKSPACE PANEL FOUND';
        return panel.textContent;
    });

    console.log('\n=== WORKSPACE TEXT CONTENT ===');
    console.log(textContent);

    await browser.close();
})();
