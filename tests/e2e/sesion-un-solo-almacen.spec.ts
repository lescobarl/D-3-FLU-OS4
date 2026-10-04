/**
 * P8.46 — IDIOMA Y ROL DE SESION: UN SOLO ALMACEN.
 *
 * ANTES: `useConfigPersistence` los persistia en localStorage Y el hook
 * `useSessionPersistence` los copiaba dentro del registro de sesion de Dexie
 * (`sessionState`/`ui`), sin que NADIE leyera esa copia (la hidratacion de App solo
 * aplica expandedFrameId y selectedMinuteId): dos almacenes del mismo valor, con
 * divergencia posible (y con el sintoma tipico de "guardo el idioma y vuelve al
 * anterior" cuando el ultimo en cargar gana).
 *
 * AHORA: el registro es localStorage (lo leen consumidores SINCRONOS: el estado
 * inicial del configurador y la copia de seguridad) y el payload de sesion ya no lo
 * lleva. Aqui se mide el artefacto real: el registro mantiene el valor tras RECARGAR
 * y el registro de Dexie NO contiene esos dos campos.
 */
import { expect, test } from '@playwright/test';
import { autoSkipOnboarding, gotoClean, readStore, seedActiveUser } from './_helpers';

const elegirIdioma = async (page: Parameters<typeof readStore>[0], valor: string) => {
    await page.selectOption('select[aria-label="Idioma"]', valor);
    await page.waitForFunction(
        (v) => localStorage.getItem('flu-language') === v,
        valor,
        { timeout: 15000 },
    );
};

test.describe('sesion: idioma y rol con UN solo almacen (P8.46)', () => {
    test('el idioma vive en localStorage y NO se copia al registro de sesion', async ({ page }) => {
        await autoSkipOnboarding(page);
        await gotoClean(page);
        await seedActiveUser(page, 'Luis');

        await elegirIdioma(page, 'en');
        expect(await page.evaluate(() => localStorage.getItem('flu-language'))).toBe('en');

        // El auto-save de sesion escribe en Dexie: el registro NO puede llevar el idioma.
        await page.waitForTimeout(2500);
        const registros = await readStore(page, 'sessionState');
        const ui = registros.find((r) => r?.id === 'ui') || {};
        expect(
            Object.prototype.hasOwnProperty.call(ui, 'language'),
            'el registro de sesion volvio a copiar el idioma (' + JSON.stringify(Object.keys(ui)) + ')',
        ).toBe(false);
        expect(
            Object.prototype.hasOwnProperty.call(ui, 'sessionRole'),
            'el registro de sesion volvio a copiar el rol (' + JSON.stringify(Object.keys(ui)) + ')',
        ).toBe(false);
    });

    test('el idioma se mantiene tras RECARGAR (el registro sigue siendo la fuente)', async ({ page }) => {
        await autoSkipOnboarding(page);
        await gotoClean(page);
        await seedActiveUser(page, 'Luis');

        await elegirIdioma(page, 'both');
        await page.reload({ waitUntil: 'load' });
        await page.waitForSelector('select[aria-label="Idioma"]', { timeout: 45000 });
        await expect
            .poll(async () => page.inputValue('select[aria-label="Idioma"]'), { timeout: 20000 })
            .toBe('both');
    });
});
