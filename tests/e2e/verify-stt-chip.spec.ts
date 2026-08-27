import { test, expect } from '@playwright/test';

test('Header chips (Escuchando/Detenido, KB, Chrome SR) + VoiceAssistantBar toggle buttons', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-header', { timeout: 15000 });

    // Take a screenshot to visually verify
    await page.screenshot({ path: 'test-results/stt-chip-verification.png', fullPage: true });

    // ── Header chips ──
    const chipsContainer = page.locator('.app-header-chips');
    await expect(chipsContainer).toBeVisible({ timeout: 5000 });

    // Log all chip texts found in the header
    const chips = chipsContainer.locator('.voice-state-chip');
    const chipCount = await chips.count();
    console.log(`[VERIFY] Found ${chipCount} chips in header`);
    for (let i = 0; i < chipCount; i++) {
        const text = await chips.nth(i).textContent();
        console.log(`[VERIFY] Chip ${i}: "${text}"`);
    }

    // Verify at least 3 chips: status (Escuchando/Detenido), KB, Chrome SR
    expect(chipCount).toBeGreaterThanOrEqual(3);

    // Verify the chips are NOT in the VoiceAssistantBar anymore
    const barChips = page.locator('.voice-bar .voice-state-chip--stream');
    await expect(barChips).toHaveCount(0, { timeout: 3000 });

    // Verify the chips are in the header area
    const headerBox = await chipsContainer.boundingBox();
    console.log(`[VERIFY] Header chips position: x=${headerBox?.x}, y=${headerBox?.y}, width=${headerBox?.width}, height=${headerBox?.height}`);

    // The chips should be in the top portion of the page
    if (headerBox) {
        expect(headerBox.y).toBeLessThan(100); // top of page
    }

    // ── VoiceAssistantBar buttons ──
    const voiceBar = page.locator('.voice-bar');
    await expect(voiceBar).toBeVisible({ timeout: 5000 });

    // "Iniciar conversación" button should be visible
    const startBtn = voiceBar.locator('.voice-bar__button--ghost');
    await expect(startBtn).toBeVisible({ timeout: 3000 });
    const startText = await startBtn.textContent();
    console.log(`[VERIFY] Start button text: "${startText}"`);

    // "Abrir escucha" toggle button should be visible (idle state)
    const toggleBtn = voiceBar.locator('.voice-bar__button--toggle-idle');
    await expect(toggleBtn).toBeVisible({ timeout: 3000 });
    const toggleText = await toggleBtn.textContent();
    console.log(`[VERIFY] Toggle button text (idle): "${toggleText}"`);

    // Verify buttons are in the session cluster (right side)
    const sessionCluster = voiceBar.locator('.voice-bar__cluster--session');
    await expect(sessionCluster).toBeVisible({ timeout: 3000 });
    const clusterBox = await sessionCluster.boundingBox();
    console.log(`[VERIFY] Session cluster position: x=${clusterBox?.x}, y=${clusterBox?.y}, width=${clusterBox?.width}, height=${clusterBox?.height}`);

    // The session cluster should be on the right side of the voice bar
    const barBox = await voiceBar.boundingBox();
    if (clusterBox && barBox) {
        // Session cluster should be in the right half of the voice bar
        expect(clusterBox.x + clusterBox.width / 2).toBeGreaterThan(barBox.x + barBox.width / 2);
        console.log('[VERIFY] Session cluster is on the right side of the voice bar ✓');
    }
});
