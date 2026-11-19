// ============================================================
// flu-settings-panel.spec.ts — Configuración plana y uniforme.
//
// Verifica contra la app real:
//   1. La primera sección es "Servicios externos" y nace CERRADA.
//   2. Todas las filas de primer nivel tienen la MISMA altura y separación.
//   3. "Configurador de FLU" y "Mis temporadas" son filas de primer nivel
//      (no hay "Gobernado por IA" anidando acordeones).
//   4. Las secciones hermanas siguen fuera de cualquier acordeón.
// ============================================================

import { test, expect, type Page } from '@playwright/test';
import { gotoClean, autoSkipOnboarding } from './_helpers';

test.beforeEach(async ({ page }) => {
    await autoSkipOnboarding(page);
});

/** Navega a Configuración y espera el panel plano. */
async function openSettings(page: Page): Promise<void> {
    await page
        .evaluate(() => {
            const b = document.querySelector('[data-testid="onboarding-skip"]');
            if (b instanceof HTMLElement) b.click();
        })
        .catch(() => undefined);
    await page.waitForTimeout(300);

    const settingsTab = page.locator('#flu-tab-settings');
    await settingsTab.waitFor({ state: 'attached', timeout: 45000 });
    await settingsTab.click({ force: true, timeout: 15000 });
    await page.waitForTimeout(400);

    await page.locator('.flu-settings-panel').waitFor({ state: 'attached', timeout: 15000 });
}

test('Configuración: Servicios externos es la primera y nace cerrada', async ({ page }) => {
    await gotoClean(page, { waitWorkspaceHub: false });
    await openSettings(page);

    const panel = page.locator('.flu-settings-panel');
    const firstDetails = panel.locator('details').first();
    const firstSummaryText = (await firstDetails.locator('summary').innerText()).trim();

    expect(firstSummaryText).toContain('Servicios externos');
    expect(await firstDetails.getAttribute('open')).toBeNull();
    expect(await firstDetails.locator('.flu-settings-image-config__body').isVisible()).toBe(false);
});

test('Configuración: todas las filas de primer nivel miden igual', async ({ page }) => {
    await gotoClean(page, { waitWorkspaceHub: false });
    await openSettings(page);

    const rows = page.locator('.flu-settings-panel > .flu-settings-image-config > summary');
    const count = await rows.count();
    expect(count).toBeGreaterThan(5);

    const boxes: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (let i = 0; i < count; i += 1) {
        const box = await rows.nth(i).boundingBox();
        expect(box).not.toBeNull();
        boxes.push(box!);
    }

    const heights = boxes.map((box) => Math.round(box.height * 10) / 10);
    expect(new Set(heights).size, `alturas distintas: ${heights.join(', ')}`).toBe(1);

    const gaps = boxes.slice(1).map((box, i) => Math.round((box.y - (boxes[i].y + boxes[i].height)) * 10) / 10);
    expect(new Set(gaps).size, `separaciones distintas: ${gaps.join(', ')}`).toBe(1);
});

test('Configuración: Configurador y Mis temporadas son de primer nivel', async ({ page }) => {
    await gotoClean(page, { waitWorkspaceHub: false });
    await openSettings(page);

    const panel = page.locator('.flu-settings-panel');
    expect(await panel.locator('details', { hasText: 'Gobernado por IA' }).count()).toBe(0);

    const configurador = panel.locator('details', { hasText: 'Configurador de FLU' }).first();
    const temporadas = panel.locator('details', { hasText: 'Mis temporadas' }).first();
    await configurador.waitFor({ state: 'attached', timeout: 15000 });
    await temporadas.waitFor({ state: 'attached', timeout: 15000 });

    expect(await configurador.getAttribute('open')).toBeNull();
    expect(await temporadas.getAttribute('open')).toBeNull();
});

test('Configuración: secciones hermanas fuera de cualquier acordeón', async ({ page }) => {
    const errors = await gotoClean(page, { waitWorkspaceHub: false });
    await openSettings(page);

    const panel = page.locator('.flu-settings-panel');
    const palabras = panel.locator('details', { hasText: 'Palabras de Activación' }).first();
    await palabras.waitFor({ state: 'attached', timeout: 15000 });

    const configurador = panel.locator('details', { hasText: 'Configurador de FLU' }).first();
    expect(await configurador.locator('summary', { hasText: 'Palabras de Activación' }).count()).toBe(0);
    expect(errors).toEqual([]);
});

test('Configuraci�n: labels y controles comparten familia y tama�o', async ({ page }) => {
    await gotoClean(page, { waitWorkspaceHub: false });
    await openSettings(page);

    const firstDetails = page.locator('.flu-settings-panel details').first();
    await firstDetails.locator('summary').click();
    await page.waitForTimeout(250);

    const styles = await page.evaluate(() => {
        const panel = document.querySelector('.flu-settings-panel');
        if (!panel) return [];
        const nodes = Array.from(
            panel.querySelectorAll(
                '.flu-settings-image-config__field > span, .flu-settings-image-config__section-label, .flu-settings-image-config input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]), .flu-settings-image-config select, .flu-settings-image-config textarea, .flu-settings-hint, .flu-settings-slider-label, .flu-settings-slider-value, .flu-settings-sub-title',
            ),
        );
        return nodes
            .filter((node) => node instanceof HTMLElement && node.offsetParent !== null)
            .map((node) => {
                const style = getComputedStyle(node);
                return { family: style.fontFamily, size: style.fontSize, tag: node.tagName, cls: node.className, text: (node.textContent || '').trim().slice(0, 40) };
            });
    });

    expect(styles.length).toBeGreaterThan(3);
    expect(new Set(styles.map((item) => item.family)).size, JSON.stringify(styles)).toBe(1);
    expect(new Set(styles.map((item) => item.size)).size, JSON.stringify(styles)).toBe(1);
});
