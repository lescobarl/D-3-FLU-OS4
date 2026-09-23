// ============================================================
// onboarding-registro-usuario.spec.ts — Bug #1: un participante
// NUEVO registrado por el onboarding (p. ej. 'Adán') debe quedar
// como usuario activo y aparecer en el selector del header
// (aria-label="Elegir usuario") y en las sugerencias del onboarding.
//
// La spec conduce el flujo REAL de la UI: carga la app limpia,
// contesta el onboarding por el overlay (input + select de rol),
// espera el registro y luego LEE el picker real del header y el
// ACTIVE_USER persistido para afirmar que 'Adán' es el activo y
// está en la lista. Sin literales copiados: todo se lee del DOM y
// de IndexedDB reales.
// ============================================================

import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { gotoClean, stubLocalSpeech, readStore, captureScreenshot } from './_helpers';

const SHOTS_DIR = path.join(process.cwd(), 'reports', 'onboarding-registro-usuario');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

async function completeOnboarding(page: Page, name: string): Promise<void> {
    // Paso 1 — captura del nombre: input libre.
    await page.waitForSelector('[data-testid="onboarding-input"]', { timeout: 15000 });
    await page.fill('[data-testid="onboarding-input"]', name);
    await page.click('[data-testid="onboarding-submit"]');
    // Paso 2 — captura del rol (select con opciones niño/adulto).
    await page.waitForSelector('[data-testid="onboarding-options"]', { timeout: 10000 });
    await page.selectOption('[data-testid="onboarding-options"]', 'niño');
    await page.click('[data-testid="onboarding-submit"]');
    // El onboarding se cierra al completar.
    await page.waitForSelector('.flu-onboarding', { state: 'hidden', timeout: 15000 });
}

test.describe('Bug #1 — participante nuevo del onboarding en el selector', () => {
    test.describe.configure({ mode: 'serial' });

    test('registra "Adán" por el onboarding: queda activo, visible en el picker y sugerido', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearParticipants(page);

        // Vuelve a cargar con el registro limpio: el onboarding pide el nombre.
        await page.reload({ waitUntil: 'load' });
        await page.waitForSelector('.flu-shell', { timeout: 15000 });
        await page.waitForSelector('[data-testid="onboarding-input"]', { timeout: 15000 });

        await completeOnboarding(page, 'Adán');

        // 1) El picker real del header termina listando a Adán (registro + activación
        //    son asíncronos: se espera a que el DOM converja).
        const picker = page.locator('[data-testid="user-picker-select"]');
        await picker.waitFor({ state: 'visible', timeout: 10000 });
        await expect
            .poll(
                async () =>
                    picker
                        .locator('option')
                        .allTextContents()
                        .then((texts) => texts.some((t) => t.toLowerCase().includes('adán'))),
                { timeout: 10000 },
            )
            .toBe(true);

        // 2) El usuario activo del picker NO está vacío y es el participante registrado.
        await expect.poll(() => picker.inputValue(), { timeout: 10000 }).not.toBe('');
        const selectedId = await picker.inputValue();
        const selectedLabel = await picker.locator(`option[value="${selectedId}"]`).textContent();
        expect(selectedLabel?.toLowerCase(), 'el activo debe ser el participante registrado').toContain('adán');

        // 3) ACTIVE_USER persistido apunta al mismo id (no a otro participante).
        await expect
            .poll(() => page.evaluate(() => localStorage.getItem('flu-active-user')), {
                timeout: 10000,
            })
            .toBe(selectedId);

        // 4) El participante quedó en el registro Dexie con su nombre y rol.
        const records = await readStore(page, 'participants');
        const adan = records.find((r) => r.name.toLowerCase() === 'adán');
        expect(adan, 'debe existir el participante Adán en IndexedDB').toBeTruthy();
        expect(adan.id).toBe(selectedId);
        expect(adan.role).toBeTruthy();

        // 5) Al volver a abrir el onboarding, Adán figura en las sugerencias.
        await page.reload({ waitUntil: 'load' });
        await page.waitForSelector('.flu-shell', { timeout: 15000 });
        await page.waitForSelector('[data-testid="onboarding-input"]', { timeout: 15000 });
        const suggestion = page.locator('[data-testid="onboarding-user-suggestions"] button', {
            hasText: 'Adán',
        });
        await suggestion.waitFor({ state: 'visible', timeout: 10000 });

        await captureScreenshot(page, SHOTS_DIR, 'participante-registrado-en-picker.png');
    });
});

async function clearParticipants(page: Page): Promise<void> {
    await page.evaluate(() => {
        return new Promise<void>((resolve) => {
            const request = indexedDB.open('flu-os3');
            request.onsuccess = (event: any) => {
                const database = event.target.result as IDBDatabase;
                const names = ['participants', 'onboardingStates'];
                const tx = database.transaction(names, 'readwrite');
                names.forEach((name) => {
                    if (database.objectStoreNames.contains(name)) tx.objectStore(name).clear();
                });
                tx.oncomplete = () => {
                    database.close();
                    resolve();
                };
                tx.onerror = () => {
                    database.close();
                    resolve();
                };
            };
            request.onerror = () => resolve();
        });
    });
}
