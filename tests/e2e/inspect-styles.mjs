import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Click last tab (settings)
const tabs = await page.locator('button.flu-shell-tab, [class*="shell-tab"]').all();
if (tabs.length > 0) {
    await tabs[tabs.length - 1].click();
}
await page.waitForTimeout(2000);

// Inspect the configurator
const inspect = await page.evaluate(() => {
    const results = {};
    // Find the configurator
    const config = document.querySelector('.flu-settings-image-config');
    if (config) {
        // Get all text elements inside the configurator
        const labels = config.querySelectorAll('span, label, div');
        const sample = [];
        for (let i = 0; i < Math.min(15, labels.length); i++) {
            const el = labels[i];
            const style = window.getComputedStyle(el);
            const text = (el.textContent || '').trim().slice(0, 30);
            if (text) {
                sample.push({
                    text,
                    className: el.className,
                    fontSize: style.fontSize,
                    color: style.color,
                    textTransform: style.textTransform,
                    fontWeight: style.fontWeight,
                    fontFamily: style.fontFamily.slice(0, 30),
                });
            }
        }
        results.configurator = sample;
    }

    // Find the .panel-card parent
    const panelCard = document.querySelector('.flu-settings-panel');
    if (panelCard) {
        const parent = panelCard.closest('.panel-card');
        results.panelCardFound = !!parent;
        results.panelCardClass = parent ? parent.className : null;
    }

    return results;
});

console.log(JSON.stringify(inspect, null, 2));
await browser.close();
