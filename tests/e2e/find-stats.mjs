import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);

// Search entire DOM for 'mensajes' or 'minutas'
const found = await page.evaluate(() => {
    const body = document.body;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
    const results = [];
    let node;
    while (node = walker.nextNode()) {
        const text = node.textContent.trim();
        if (text && (text.includes('mensajes') || text.includes('minutas'))) {
            results.push({ text, tag: node.parentElement.tagName, className: node.parentElement.className });
        }
    }
    return results;
});

console.log('=== Found mensajes/minutas ===');
if (found.length === 0) {
    console.log('NONE - successfully removed');
} else {
    found.forEach(f => console.log(JSON.stringify(f)));
}

// Also check header stats
const headerStats = await page.evaluate(() => {
    const el = document.querySelector('.app-header-stats');
    return el ? el.innerHTML : 'NOT FOUND';
});
console.log('Header stats HTML:', headerStats);

await browser.close();
