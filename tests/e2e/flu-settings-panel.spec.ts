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

const BASE_URL = '/';

async function gotoClean(page: Page): Promise<string[]> {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.addInitScript(() => {
        localStorage.setItem('flu-onboarding-completed', 'true');
        localStorage.setItem('flu-onboarding-step', JSON.stringify({ stepIndex: 0, captured: {} }));
    });
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('.flu-shell', { timeout: 15000 });
    await page.evaluate(() => localStorage.clear());
    // Esperar el tablist principal
    const tablistSelectors = ['nav[role="tablist"]', '[role="tablist"]', '.flu-shell-tabs'];
    const timeout = 15000;
    const start = Date.now();
    let lastError: any;
    while (Date.now() - start < timeout) {
        for (const sel of tablistSelectors) {
            const loc = page.locator(sel).first();
            const count = await loc.count().catch(() => 0);
            if (count > 0) {
                try {
                    await loc.waitFor({ state: 'attached', timeout: 3000 });
                    await page.waitForTimeout(300);
                    return errors;
                } catch (e) {
                    lastError = e;
                }
            }
        }
        await page.waitForTimeout(200);
    }
    throw lastError || new Error(`gotoClean: timeout waiting for tablist after ${timeout}ms`);
}

/** Navega a la pestaña principal "settings" y luego al grupo "FLU". */
async function openFluSettings(page: Page): Promise<void> {
    // Pestaña principal de Configuración
    const settingsTab = page.locator('#flu-tab-settings');
    await settingsTab.waitFor({ state: 'visible', timeout: 15000 });
    await settingsTab.click();
    await page.waitForTimeout(400);

    // Grupo FLU dentro del panel de settings
    const fluPill = page.locator('.flu-settings-groups__pill', { hasText: 'FLU' }).first();
    await fluPill.waitFor({ state: 'visible', timeout: 15000 });
    await fluPill.click();
    await page.waitForTimeout(400);

    // El panel FLU debe estar presente
    await page.locator('.flu-settings-panel').waitFor({ state: 'visible', timeout: 15000 });
}

test('Fase D: Servicios Externos (APIs) es la sección principal visible', async ({ page }) => {
    await gotoClean(page);
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
    await gotoClean(page);
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
    await gotoClean(page);
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
    const errors = await gotoClean(page);
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
