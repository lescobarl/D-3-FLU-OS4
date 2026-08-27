import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);

// Search entire DOM for 'cerrando' or 'cer rando'
const found = await page.evaluate(() => {
    const body = document.body;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
    const results = [];
    let node;
    while (node = walker.nextNode()) {
        const text = node.textContent.trim();
        if (text && (text.includes('cerrando') || text.includes('cer rando') || text.includes('escucha'))) {
            results.push({
                text: text.substring(0, 80),
                tag: node.parentElement.tagName,
                className: node.parentElement.className,
                parentClasses: node.parentElement.parentElement ? node.parentElement.parentElement.className : '',
                grandParentClasses: node.parentElement.parentElement?.parentElement ? node.parentElement.parentElement.parentElement.className : ''
            });
        }
    }
    return results;
});

console.log('=== Found cerrando/escucha ===');
if (found.length === 0) {
    console.log('NONE');
} else {
    found.forEach((f, i) => {
        console.log(`[${i}] text="${f.text}"`);
        console.log(`    tag=${f.tag} class="${f.className}"`);
        console.log(`    parent="${f.parentClasses}"`);
        console.log(`    grandparent="${f.grandParentClasses}"`);
    });
}

// Also check what's inside .voice-controls__transcript-text
const voiceTranscript = await page.evaluate(() => {
    const el = document.querySelector('.voice-controls__transcript-text');
    return el ? el.textContent : 'NOT FOUND';
});
console.log('\nVoiceControls transcript:', voiceTranscript);

// Check what's inside .conversation-live-phrase__scroll
const livePhrase = await page.evaluate(() => {
    const el = document.querySelector('.conversation-live-phrase__scroll');
    return el ? el.textContent : 'NOT FOUND';
});
console.log('Live phrase scroll:', livePhrase);

// Check what's inside .frame-content__response-scroll (latestResponse)
const responseScroll = await page.evaluate(() => {
    const el = document.querySelector('.frame-content__response-scroll');
    return el ? el.textContent : 'NOT FOUND';
});
console.log('Response scroll:', responseScroll);

await browser.close();
