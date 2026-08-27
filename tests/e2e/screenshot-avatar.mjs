// Take screenshot of current avatar state
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
// Wait for the 3D scene to render
await page.waitForTimeout(2000);
await page.screenshot({ path: 'test-results/avatar-current.png', fullPage: false });
await browser.close();
console.log('Screenshot saved: test-results/avatar-current.png');
