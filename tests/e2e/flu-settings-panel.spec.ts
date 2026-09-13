// ============================================================
// flu-settings-panel.spec.ts — Validación E2E REAL de la Fase D:
// reorganización del panel FLU (configurador reducido a APIs/llaves).
//
// Verifica contra la app real en :5175:
//   1. La sección "🔌 Configuración de Servicios Externos" (APIs/llaves)
//      es la PRIMERA y está ABIERTA por defecto (visible).
//   2. El acordeón "🤖 Gobernado por IA" está COLAPSADO por defecto
//      (personalidad + branding estacional ocultos).
//   3. Al expandir "🤖 Gobernado por IA" aparecen "🎭 Configurador de FLU"
//      y "🎨 Branding por Temporalidad".
//   4. Las secciones hermanas (🎤 Palabras de Activación, etc.) siguen
//      presentes fuera del acordeón.
// ============================================================

import { test, expect, type Page } from '@playwright/test';
import { gotoClean, autoSkipOnboarding } from './_helpers';

// Estos specs no validan onboarding: se auto-omite para que su backdrop no
// intercepte los clics (se reabre async por el estado per-user en IndexedDB).
test.beforeEach(async ({ page }) => {
    await autoSkipOnboarding(page);
});

/** Navega a la pestaña principal "settings" y luego al grupo "FLU". */
async function openFluSettings(page: Page): Promise<void> {
    // El onboarding (estado per-user) puede reabrirse y su backdrop bloquea
    // clics; se omite y los clics no dependen de él (force).
    const skip = page.locator('[data-testid="onboarding-skip"]');
    if (await skip.isVisible().catch(() => false)) {
        await skip.click().catch(() => undefined);
        await page.waitForTimeout(300);
    }

    // Pestaña principal de Configuración
    const settingsTab = page.locator('#flu-tab-settings');
    await settingsTab.waitFor({ state: 'attached', timeout: 15000 });
    await settingsTab.click({ force: true, timeout: 15000 });
    await page.waitForTimeout(400);

    // Grupo FLU dentro del panel de settings
    const fluPill = page.locator('.flu-settings-groups__pill', { hasText: 'FLU' }).first();
    await fluPill.waitFor({ state: 'attached', timeout: 15000 });
    await fluPill.click({ force: true, timeout: 15000 });
    await page.waitForTimeout(400);

    // El panel FLU debe estar presente
    await page.locator('.flu-settings-panel').waitFor({ state: 'attached', timeout: 15000 });
}

test('Fase D: Servicios Externos (APIs) es la sección principal visible', async ({ page }) => {
    await gotoClean(page, { waitWorkspaceHub: false });
    await openFluSettings(page);

    const panel = page.locator('.flu-settings-panel');

    // El primer <details> del panel es "Configuración de Servicios Externos"
    const firstDetails = panel.locator('details').first();
    const firstSummaryText = (await firstDetails.locator('summary').innerText()).trim();
    expect(firstSummaryText).toContain('Configuración de Servicios Externos');

    // Debe estar ABIERTO (atributo open) → APIs visibles por defecto
    const isOpen = await firstDetails.getAttribute('open');
    expect(isOpen).not.toBeNull();

    // El contenido de APIs debe ser visible (no oculto por colapso)
    await expect(firstDetails.locator('summary')).toBeVisible();
    // El body del primer details debe estar visible (details abierto muestra su contenido)
    const bodyVisible = await firstDetails.locator('.flu-settings-image-config__body').isVisible();
    expect(bodyVisible).toBe(true);
});

test('Fase D: acordeón "Gobernado por IA" está colapsado por defecto', async ({ page }) => {
    await gotoClean(page, { waitWorkspaceHub: false });
    await openFluSettings(page);

    const panel = page.locator('.flu-settings-panel');

    // Localizar el acordeón "Gobernado por IA"
    const gobernado = panel.locator('details', { hasText: 'Gobernado por IA' }).first();
    await gobernado.waitFor({ state: 'attached', timeout: 15000 });

    // Debe estar COLAPSADO (sin atributo open)
    const isOpen = await gobernado.getAttribute('open');
    expect(isOpen).toBeNull();

    // Su contenido (Configurador de FLU) NO debe ser visible mientras está colapsado
    const configuradorSummary = gobernado.locator('summary', { hasText: 'Configurador de FLU' });
    const configuradorVisible = await configuradorSummary.isVisible().catch(() => false);
    expect(configuradorVisible).toBe(false);
});

test('Fase D: al expandir "Gobernado por IA" aparecen Configurador de FLU y Branding', async ({ page }) => {
    await gotoClean(page, { waitWorkspaceHub: false });
    await openFluSettings(page);

    const panel = page.locator('.flu-settings-panel');
    const gobernado = panel.locator('details', { hasText: 'Gobernado por IA' }).first();
    await gobernado.waitFor({ state: 'attached', timeout: 15000 });

    // Expandir el acordeón haciendo clic en su summary exacto (el que dice "Gobernado por IA")
    const gobernadoSummary = gobernado
        .locator('summary')
        .filter({ hasText: /^🤖\s*Gobernado por IA$/ })
        .first();
    await gobernadoSummary.click();
    await page.waitForTimeout(400);

    // Ahora Configurador de FLU y Branding por Temporalidad deben ser visibles
    const configurador = gobernado.locator('summary', { hasText: 'Configurador de FLU' });
    await configurador.waitFor({ state: 'visible', timeout: 10000 });
    await expect(configurador).toBeVisible();

    const branding = gobernado.locator('summary', { hasText: 'Branding por Temporalidad' });
    await branding.waitFor({ state: 'visible', timeout: 10000 });
    await expect(branding).toBeVisible();
});

test('Fase D: secciones hermanas siguen presentes fuera del acordeón', async ({ page }) => {
    const errors = await gotoClean(page, { waitWorkspaceHub: false });
    await openFluSettings(page);

    const panel = page.locator('.flu-settings-panel');

    // Palabras de Activación debe existir como <details> hermano (fuera del acordeón)
    const palabras = panel.locator('details', { hasText: 'Palabras de Activación' }).first();
    await palabras.waitFor({ state: 'attached', timeout: 15000 });

    // El acordeón "Gobernado por IA" NO debe contener a "Palabras de Activación"
    const gobernado = panel.locator('details', { hasText: 'Gobernado por IA' }).first();
    const gobernadoHasPalabras = await gobernado
        .locator('summary', { hasText: 'Palabras de Activación' })
        .count();
    expect(gobernadoHasPalabras).toBe(0);

    // El panel FLU no debe tener errores de runtime
    expect(errors).toEqual([]);
});
