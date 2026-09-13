// ============================================================
// video-config.spec.ts — E2E del módulo de configuración de Video (12)
// ------------------------------------------------------------
// Verifica que en Ajustes → 🎬 Video la clave y el modelo de fal.ai sean
// editables y persistan entre recargas, con el modelo barato por defecto.
// ============================================================
import { test, expect, type Page } from '@playwright/test';
import { gotoClean, autoSkipOnboarding } from './_helpers';

test.beforeEach(async ({ page }) => {
    await autoSkipOnboarding(page);
});

async function openFlu(page: Page): Promise<void> {
    const skip = page.locator('[data-testid="onboarding-skip"]');
    if (await skip.isVisible().catch(() => false)) {
        await skip.click().catch(() => undefined);
        await page.waitForTimeout(300);
    }
    const settingsTab = page.locator('#flu-tab-settings');
    await settingsTab.waitFor({ state: 'attached', timeout: 15000 });
    await settingsTab.click({ force: true });
    await page.waitForTimeout(400);
    const fluPill = page.locator('.flu-settings-groups__pill', { hasText: 'FLU' }).first();
    await fluPill.waitFor({ state: 'attached', timeout: 15000 });
    await fluPill.click({ force: true });
    await page.waitForTimeout(400);
}

test('Video (fal.ai): clave y modelo editables y persisten', async ({ page }) => {
    test.setTimeout(90000);
    await gotoClean(page);
    await openFlu(page);

    const key = page.locator('[data-testid="video-falai-key"]');
    const model = page.locator('[data-testid="video-falai-model"]');
    await key.waitFor({ state: 'attached', timeout: 15000 });

    // Título sin "(fal.ai)" (ya está en el subtítulo).
    await expect(page.locator('.flu-settings-section__title', { hasText: '🎬 Video' })).toHaveCount(1);
    await expect(page.getByText('Video (fal.ai)', { exact: true })).toHaveCount(0);

    // Botón Mostrar/Ocultar en la clave.
    await key.locator('xpath=following-sibling::button').click();
    expect(await key.getAttribute('type')).toBe('text');
    await key.locator('xpath=following-sibling::button').click();

    // Default barato ya configurado (Wan 2.5, $0.05/s).
    expect(await model.inputValue()).toBe('fal-ai/wan-25-preview/text-to-video');

    await key.fill('key-id:key-secret');
    await model.fill('fal-ai/kling-video/v1.6');
    await page.waitForTimeout(500);

    const ls = await page.evaluate(() => ({
        k: localStorage.getItem('flu-falai-api-key'),
        m: localStorage.getItem('flu-falai-video-model'),
    }));
    expect(ls.k).toBe('key-id:key-secret');
    expect(ls.m).toBe('fal-ai/kling-video/v1.6');

    await page.reload({ waitUntil: 'load' });
    await openFlu(page);
    await page.waitForTimeout(400);
    expect(await page.locator('[data-testid="video-falai-key"]').inputValue()).toBe('key-id:key-secret');
    expect(await page.locator('[data-testid="video-falai-model"]').inputValue()).toBe('fal-ai/kling-video/v1.6');
});
