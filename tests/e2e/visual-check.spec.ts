// Quick visual check — screenshot + element positions
import { test, expect } from '@playwright/test';

test('Visual inspection: screenshot + FLU position', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/');
    await page.waitForSelector('.app-header', { timeout: 15000 });

    // Take screenshot
    await page.screenshot({ path: 'test-results/visual-inspection.png', fullPage: true });

    // Helper to safely get bounding box
    async function safeBox(locator: any) {
        try {
            const count = await locator.count();
            if (count === 0) return null;
            return await locator.first().boundingBox();
        } catch { return null; }
    }

    async function safeText(locator: any) {
        try {
            const count = await locator.count();
            if (count === 0) return '(none)';
            return (await locator.first().textContent())?.trim() || '(empty)';
        } catch { return '(error)'; }
    }

    // Header
    const hBox = await safeBox(page.locator('.app-header'));
    console.log(`[VISUAL] Header: x=${hBox?.x}, y=${hBox?.y}, w=${hBox?.width}, h=${hBox?.height}`);

    // Chips in header
    const chips = page.locator('.app-header-chips .voice-state-chip');
    const chipCount = await chips.count();
    console.log(`[VISUAL] Found ${chipCount} chips in header`);
    for (let i = 0; i < chipCount; i++) {
        const text = await chips.nth(i).textContent();
        console.log(`[VISUAL] Chip ${i}: "${text?.trim()}"`);
    }

    // Voice bar
    const vbBox = await safeBox(page.locator('.voice-bar'));
    console.log(`[VISUAL] VoiceBar: x=${vbBox?.x}, y=${vbBox?.y}, w=${vbBox?.width}, h=${vbBox?.height}`);

    // Toggle button
    const toggleBtn = page.locator('.voice-bar__button--toggle-idle');
    if (await toggleBtn.count() > 0) {
        const box = await toggleBtn.first().boundingBox();
        const color = await toggleBtn.first().evaluate((el: Element) => getComputedStyle(el).color);
        const bg = await toggleBtn.first().evaluate((el: Element) => getComputedStyle(el).background);
        console.log(`[VISUAL] Toggle button: x=${box?.x}, y=${box?.y}, w=${box?.width}, h=${box?.height}`);
        console.log(`[VISUAL] Toggle button color: ${color}`);
        console.log(`[VISUAL] Toggle button background: ${bg}`);
    }

    // Avatar column (FLU position)
    const avatarCol = page.locator('.app-avatar-column');
    if (await avatarCol.count() > 0) {
        const box = await avatarCol.first().boundingBox();
        console.log(`[VISUAL] Avatar column (FLU): x=${box?.x}, y=${box?.y}, w=${box?.width}, h=${box?.height}`);
    }

    // Flu bridge avatar area
    const fluArea = page.locator('.flu-bridge-avatar-area');
    if (await fluArea.count() > 0) {
        const box = await fluArea.first().boundingBox();
        console.log(`[VISUAL] Flu bridge avatar area: x=${box?.x}, y=${box?.y}, w=${box?.width}, h=${box?.height}`);
    }

    // Panels column
    const panelsCol = page.locator('.app-panels-column');
    if (await panelsCol.count() > 0) {
        const box = await panelsCol.first().boundingBox();
        console.log(`[VISUAL] Panels column: x=${box?.x}, y=${box?.y}, w=${box?.width}, h=${box?.height}`);
    }

    // Workspace tab panel (Pizarron) — should be active by default now
    const wsPanel = page.locator('.flu-tab-panel--workspace.is-active');
    if (await wsPanel.count() > 0) {
        const box = await wsPanel.first().boundingBox();
        const bg = await wsPanel.first().evaluate((el: Element) => getComputedStyle(el).background);
        console.log(`[VISUAL] Workspace panel (Pizarron): x=${box?.x}, y=${box?.y}, w=${box?.width}, h=${box?.height}`);
        console.log(`[VISUAL] Workspace panel background: ${bg}`);
    }

    // App main
    const mBox = await safeBox(page.locator('.app-main'));
    console.log(`[VISUAL] App main: x=${mBox?.x}, y=${mBox?.y}, w=${mBox?.width}, h=${mBox?.height}`);

    // Verify Pizarron tab is active by default
    const activeTab = page.locator('.flu-shell-tabs__tab.is-active');
    const activeLabel = await safeText(activeTab);
    console.log(`[VISUAL] Active tab: "${activeLabel}"`);

    expect(activeLabel).toBe('Pizarron');
});
