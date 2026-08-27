import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    bypassCSP: true,
});
const page = await context.newPage();
await page.route('**/*', (route) => route.continue());

// Use the actual OS3 dev server
await page.goto('http://localhost:5173/?nocache=' + Date.now(), { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Click last tab (settings)
const tabs = await page.locator('button.flu-shell-tab, [class*="shell-tab"]').all();
if (tabs.length > 0) {
    await tabs[tabs.length - 1].click();
}
await page.waitForTimeout(2000);

await page.screenshot({ path: 'screenshot-config-fixed.png', fullPage: false });
console.log('Screenshot saved to screenshot-config-fixed.png');
await browser.close();
