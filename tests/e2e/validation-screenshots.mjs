// ============================================================
// Validation Screenshots — Rule #0.1 Compliance
// Captures visual evidence of project state for audit trail
// ============================================================
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const BASE_URL = 'http://localhost:5173/';
const OUTPUT_DIR = 'test-results/validation';

async function main() {
    console.log('=== Validation Screenshots ===\n');

    // 1. Run tests and capture output
    console.log('[1/5] Running test suite...');
    try {
        const testOutput = execSync('npx vitest run --reporter=verbose 2>&1', {
            cwd: process.cwd(),
            encoding: 'utf-8',
            timeout: 60000,
        });
        writeFileSync(`${OUTPUT_DIR}/test-output.txt`, testOutput);
        console.log('  ✓ Test output saved');
    } catch (e) {
        writeFileSync(`${OUTPUT_DIR}/test-output.txt`, e.stdout || e.message);
        console.log('  ⚠ Tests had failures (output saved)');
    }

    // 2. Launch browser for visual screenshots
    console.log('[2/5] Launching browser...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    // 3. Navigate to app and capture initial state
    console.log('[3/5] Capturing app screenshots...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {
        console.log('  ⚠ App not running, skipping UI screenshots');
        return;
    });

    // Wait for 3D scene to initialize
    await page.waitForTimeout(3000);

    // Screenshot 1: Full page initial state
    await page.screenshot({
        path: `${OUTPUT_DIR}/01-initial-state.png`,
        fullPage: false,
    });
    console.log('  ✓ 01-initial-state.png');

    // Screenshot 2: Check for console errors
    const consoleErrors = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            consoleErrors.push(msg.text());
        }
    });
    writeFileSync(`${OUTPUT_DIR}/console-errors.json`, JSON.stringify(consoleErrors, null, 2));
    console.log(`  ✓ Console errors logged: ${consoleErrors.length}`);

    // 4. Capture test results summary
    console.log('[4/5] Capturing test results summary...');
    try {
        const summary = execSync('npx vitest run 2>&1', {
            cwd: process.cwd(),
            encoding: 'utf-8',
            timeout: 60000,
        });
        // Extract summary line
        const lines = summary.split('\n').filter(l => l.includes('Tests') || l.includes('Test Files'));
        writeFileSync(`${OUTPUT_DIR}/test-summary.txt`, lines.join('\n'));
        console.log('  ✓ Test summary saved');
    } catch (e) {
        const lines = (e.stdout || '').split('\n').filter(l => l.includes('Tests') || l.includes('Test Files'));
        writeFileSync(`${OUTPUT_DIR}/test-summary.txt`, lines.join('\n') + '\n' + (e.message || ''));
        console.log('  ⚠ Test summary saved (with failures)');
    }

    // 5. Git status
    console.log('[5/5] Capturing git status...');
    try {
        const gitStatus = execSync('git status --short', {
            cwd: process.cwd(),
            encoding: 'utf-8',
        });
        const gitLog = execSync('git log --oneline -3', {
            cwd: process.cwd(),
            encoding: 'utf-8',
        });
        writeFileSync(`${OUTPUT_DIR}/git-status.txt`, `BRANCH: ${execSync('git branch --show-current', { cwd: process.cwd(), encoding: 'utf-8' })}\n\nSTATUS:\n${gitStatus}\n\nLOG:\n${gitLog}`);
        console.log('  ✓ Git status saved');
    } catch (e) {
        console.log('  ⚠ Git status failed');
    }

    await browser.close();
    console.log('\n=== Screenshots complete ===');
    console.log(`Output: ${OUTPUT_DIR}/`);
}

main().catch(console.error);
