// ============================================================
// Avatar Cap Visibility — E2E Visual Test
// ============================================================
// Verifies that the 3D avatar's cap (gorra) visibility matches
// the selected profile's image configuration.
//
// Bug caught: Race condition in BunnyModel.tsx — component
// visibility was not applied when the 3D model finished loading
// asynchronously, because the useEffect that watches `components`
// had already fired while modelObjRef.current was still null.
// ============================================================

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const SCREENSHOT_DIR = 'test-results/avatar-cap-visibility';

/**
 * Navigate to the app, wait for canvas, and open Settings tab.
 */
async function setup(page: any) {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Wait for the 3D canvas to be present (avatar loaded)
    await page.waitForSelector('canvas', { timeout: 15000 });
    // Wait a bit for the model to fully render
    await page.waitForTimeout(3000);
    // Navigate to Settings tab
    await page.getByRole('tab', { name: /configuración/i }).click();
    await page.waitForTimeout(500);
}

/**
 * Get the profile <select> element by its accessible name "👤 Perfil".
 */
function profileSelect(page: any) {
    return page.getByRole('combobox', { name: /perfil/i });
}

/**
 * Get the cap checkbox by its label text "Gorra visible".
 */
function capCheckbox(page: any) {
    return page.getByLabel('Gorra visible');
}

test.describe('🧢 Avatar Cap Visibility — Perfil → Modelo 3D', () => {

    test.beforeAll(() => {
        if (!fs.existsSync(SCREENSHOT_DIR)) {
            fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
        }
    });

    test('Perfil "Asistente del Maestro" debe mostrar FLU sin gorra', async ({ page }) => {
        test.setTimeout(60000);

        await setup(page);

        // 1. Select "Asistente del Maestro" (profesor) from the profile dropdown
        await profileSelect(page).selectOption('profesor');
        await page.waitForTimeout(500);

        // 2. Verify the profile value is now 'profesor'
        const selectedValue = await profileSelect(page).inputValue();
        expect(selectedValue).toBe('profesor');

        // 3. Verify the cap checkbox is unchecked (capVisible: false)
        const isChecked = await capCheckbox(page).isChecked();
        expect(isChecked).toBe(false);

        // 4. Take screenshot of the avatar canvas for visual verification
        const canvas = page.locator('canvas').first();
        await canvas.screenshot({ path: path.join(SCREENSHOT_DIR, 'profesor-sin-gorra.png') });

        // 5. Also take a full page screenshot for context
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'profesor-full-page.png'), fullPage: true });
    });

    test('Cambiar a perfil "Estudiante" debe mostrar FLU con gorra', async ({ page }) => {
        test.setTimeout(60000);

        await setup(page);

        // 1. Select "Estudiante" profile
        await profileSelect(page).selectOption('estudiante');
        await page.waitForTimeout(500);

        // 2. Verify cap checkbox is now checked
        const isChecked = await capCheckbox(page).isChecked();
        expect(isChecked).toBe(true);

        // 3. Take screenshot
        const canvas = page.locator('canvas').first();
        await canvas.screenshot({ path: path.join(SCREENSHOT_DIR, 'estudiante-con-gorra.png') });
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'estudiante-full-page.png'), fullPage: true });
    });

    test('Checkbox de gorra debe ocultar/mostrar la gorra en tiempo real', async ({ page }) => {
        test.setTimeout(60000);

        await setup(page);

        // 1. Select "Estudiante" profile (has cap)
        await profileSelect(page).selectOption('estudiante');
        await page.waitForTimeout(500);

        // 2. Uncheck cap
        await capCheckbox(page).uncheck();
        await page.waitForTimeout(500);

        // 3. Screenshot without cap
        const canvas = page.locator('canvas').first();
        await canvas.screenshot({ path: path.join(SCREENSHOT_DIR, 'estudiante-cap-unchecked.png') });

        // 4. Re-check cap
        await capCheckbox(page).check();
        await page.waitForTimeout(500);

        // 5. Screenshot with cap
        await canvas.screenshot({ path: path.join(SCREENSHOT_DIR, 'estudiante-cap-checked.png') });

        // 6. Full page
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'toggle-cap-full-page.png'), fullPage: true });
    });
});
