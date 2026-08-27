// Check browser console for errors
import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('console', msg => {
        if (msg.type() === 'error' || msg.type() === 'warning') {
            errors.push({ type: msg.type(), text: msg.text() });
        }
    });
    page.on('pageerror', err => {
        errors.push({ type: 'pageerror', text: err.message, stack: err.stack?.split('\n').slice(0, 5).join('\n') });
    });

    await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);

    console.log('=== CONSOLE ERRORS ===');
    if (errors.length === 0) {
        console.log('No errors found');
    } else {
        errors.forEach((e, i) => {
            console.log(`\n--- Error ${i + 1} ---`);
            console.log(`Type: ${e.type}`);
            console.log(`Text: ${e.text}`);
            if (e.stack) console.log(`Stack: ${e.stack}`);
        });
    }

    // Also check for Gemini API key
    const hasApiKey = await page.evaluate(() => {
        return !!localStorage.getItem('flu-text-api-key');
    });
    console.log(`\n=== GEMINI API KEY ===`);
    console.log(`Has API key in localStorage: ${hasApiKey}`);

    // Check the app state
    const appState = await page.evaluate(() => {
        const header = document.querySelector('.app-header');
        const chips = document.querySelectorAll('.app-header-chips .voice-state-chip');
        const avatar = document.querySelector('.flu-bridge-avatar-area');
        const conversationTab = document.querySelector('.flu-tab-panel--conversation');
        return {
            hasHeader: !!header,
            chipCount: chips.length,
            hasAvatar: !!avatar,
            hasConversationTab: !!conversationTab,
        };
    });
    console.log(`\n=== APP STATE ===`);
    console.log(JSON.stringify(appState, null, 2));

    await browser.close();
})();
