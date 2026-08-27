/**
 * OS4 Visual Audit — compares current app against OS3 reference
 * Run: node tests/e2e/audit-os4-visual.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const PORT = 5173;
const URL = `http://localhost:${PORT}/`;

async function audit() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        locale: 'es-MX',
    });
    const page = await context.newPage();

    console.log(`Navigating to ${URL}...`);
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(3000);

    // Take full screenshot
    await page.screenshot({ path: 'test-results/audit-full.png', fullPage: false });
    console.log('✓ Screenshot saved: test-results/audit-full.png');

    // --- 1. Check for blocking prompt ---
    const hasDialog = await page.evaluate(() => {
        // Check if there's any prompt-like element visible
        const prompts = document.querySelectorAll('[class*="prompt"], [class*="modal"], [class*="overlay"]');
        return prompts.length > 0;
    });
    console.log(`[CHECK] Blocking dialog visible: ${hasDialog ? '❌ YES' : '✓ NO'}`);

    // --- 2. Check layout structure ---
    const layout = await page.evaluate(() => {
        const container = document.querySelector('.app-container');
        const header = document.querySelector('.app-header');
        const main = document.querySelector('.app-main');
        const avatarCol = document.querySelector('.app-avatar-column');
        const panelsCol = document.querySelector('.app-panels-column');
        const bridge = document.querySelector('.flu-bridge-container');
        const avatarArea = document.querySelector('.flu-bridge-avatar-area');
        const voiceBar = document.querySelector('.voice-bar');
        const voiceControls = document.querySelector('.voice-controls');
        const shellTabs = document.querySelector('.flu-shell-tabs');
        const settingsPanel = document.querySelector('.flu-settings-panel');

        return {
            container: !!container,
            header: !!header,
            main: !!main,
            avatarColumn: !!avatarCol,
            panelsColumn: !!panelsCol,
            fluBridge: !!bridge,
            avatarArea: !!avatarArea,
            voiceBar: !!voiceBar,
            voiceControls: !!voiceControls,
            shellTabs: !!shellTabs,
            settingsPanel: !!settingsPanel,
            // Dimensions
            avatarColWidth: avatarCol ? avatarCol.getBoundingClientRect().width : 0,
            mainDisplay: main ? getComputedStyle(main).display : 'none',
            mainFlexDirection: main ? getComputedStyle(main).flexDirection : 'none',
        };
    });
    console.log('\n--- Layout Structure ---');
    for (const [key, val] of Object.entries(layout)) {
        const status = val ? '✓' : '❌';
        console.log(`  ${status} ${key}: ${val}`);
    }

    // --- 3. Check CSS variables are defined ---
    const cssVars = await page.evaluate(() => {
        const root = document.documentElement;
        const vars = [
            '--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-card',
            '--text-primary', '--text-secondary',
            '--accent-cyan', '--accent-green', '--accent-red',
            '--border-color', '--font-sans', '--font-mono',
            '--radius-sm', '--radius-md',
        ];
        const results = {};
        for (const v of vars) {
            const val = getComputedStyle(root).getPropertyValue(v).trim();
            results[v] = val || '(not set)';
        }
        return results;
    });
    console.log('\n--- CSS Variables ---');
    for (const [key, val] of Object.entries(cssVars)) {
        const status = val && val !== '(not set)' ? '✓' : '❌';
        console.log(`  ${status} ${key}: ${val}`);
    }

    // --- 4. Check header content ---
    const headerContent = await page.evaluate(() => {
        const header = document.querySelector('.app-header');
        if (!header) return { error: 'no header' };
        const title = header.querySelector('.app-title');
        const badge = header.querySelector('.app-title-badge');
        const chips = header.querySelector('.app-header-chips');
        const sessionChips = header.querySelectorAll('.session-chip');
        const voiceStateChip = header.querySelector('.voice-state-chip');
        return {
            title: title?.textContent?.trim() || null,
            badge: badge?.textContent?.trim() || null,
            hasChips: !!chips,
            sessionChipCount: sessionChips.length,
            hasVoiceStateChip: !!voiceStateChip,
        };
    });
    console.log('\n--- Header Content ---');
    for (const [key, val] of Object.entries(headerContent)) {
        console.log(`  ${key}: ${val}`);
    }

    // --- 5. Check settings panel for API key prompt ---
    const settingsCheck = await page.evaluate(() => {
        const details = document.querySelectorAll('.flu-settings-image-config');
        const results = [];
        details.forEach((d, i) => {
            const summary = d.querySelector('summary')?.textContent?.trim() || '';
            const inputs = d.querySelectorAll('input[type="text"], input[type="password"]');
            const inputDetails = [];
            inputs.forEach(inp => {
                inputDetails.push({
                    placeholder: inp.placeholder || '',
                    value: inp.value || '',
                });
            });
            results.push({ index: i, summary, inputs: inputDetails });
        });
        return results;
    });
    console.log('\n--- Settings Panel ---');
    for (const s of settingsCheck) {
        console.log(`  Section ${s.index}: "${s.summary}"`);
        for (const inp of s.inputs) {
            console.log(`    Input: placeholder="${inp.placeholder}", value="${inp.value}"`);
        }
    }

    // --- 6. Check for any error messages ---
    const errors = await page.evaluate(() => {
        const errorEls = document.querySelectorAll('[class*="error"], [class*="Error"]');
        return Array.from(errorEls).map(el => ({
            text: el.textContent?.trim()?.substring(0, 100),
            class: el.className,
        }));
    });
    console.log('\n--- Error Messages ---');
    if (errors.length === 0) {
        console.log('  ✓ No error elements found');
    } else {
        errors.forEach(e => console.log(`  ❌ ${e.class}: "${e.text}"`));
    }

    // --- 7. Check console errors ---
    const consoleErrors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') {
            consoleErrors.push(msg.text());
        }
    });
    await page.waitForTimeout(1000);
    console.log('\n--- Console Errors ---');
    if (consoleErrors.length === 0) {
        console.log('  ✓ No console errors');
    } else {
        consoleErrors.forEach(e => console.log(`  ❌ ${e.substring(0, 200)}`));
    }

    // --- 8. Check avatar visibility ---
    const avatarCheck = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        const viewer = document.querySelector('.flu-bridge-avatar-area');
        return {
            hasCanvas: !!canvas,
            viewerWidth: viewer ? viewer.getBoundingClientRect().width : 0,
            viewerHeight: viewer ? viewer.getBoundingClientRect().height : 0,
        };
    });
    console.log('\n--- Avatar ---');
    console.log(`  Canvas: ${avatarCheck.hasCanvas ? '✓' : '❌'}`);
    console.log(`  Viewer area: ${avatarCheck.viewerWidth}x${avatarCheck.viewerHeight}`);

    // --- 9. Check tabs ---
    const tabs = await page.evaluate(() => {
        const tabEls = document.querySelectorAll('.flu-shell-tabs__tab, [class*="tab"]');
        return Array.from(tabEls).map(t => ({
            text: t.textContent?.trim(),
            active: t.classList.contains('flu-shell-tabs__tab--active'),
        }));
    });
    console.log('\n--- Tabs ---');
    tabs.forEach(t => console.log(`  ${t.active ? '▶' : ' '} "${t.text}"`));

    // Write report
    const report = {
        layout,
        cssVars,
        headerContent,
        settingsCheck,
        errors,
        consoleErrors,
        avatarCheck,
        tabs,
    };
    writeFileSync('test-results/audit-report.json', JSON.stringify(report, null, 2));
    console.log('\n✓ Report saved: test-results/audit-report.json');

    await browser.close();
    console.log('\n=== Audit Complete ===');
}

audit().catch(err => {
    console.error('Audit failed:', err.message);
    process.exit(1);
});
