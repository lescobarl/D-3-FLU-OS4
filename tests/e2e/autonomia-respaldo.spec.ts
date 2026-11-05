/**
 * P8.47 — LA AUTONOMIA TENIA HUECO DECLARADO: ningun spec e2e la ejercitaba y
 * `npm run e2e:plan` nombraba src/core/autonomy/decisionEngine.ts y backupSystem.ts.
 *
 * Se cierra MIDIENDO el flujo, no declarando un mapeo:
 *   1) CAMINO DE PRODUCTO: la pestaña "Sistema" monta el panel de Sistemas
 *      Autonomos (FluSystemTabView -> AutonomyStatusPanel), que es donde el gancho
 *      `useAutonomyIntegration` arranca los tres sistemas globales (health monitor,
 *      decision engine y backup system). Se assertea que el panel existe y que los
 *      CINCO sistemas declarados se listan.
 *   2) CONDUCTA DEL RESPALDO (API publica real, en el navegador real): crear una
 *      copia de emergencia, CAMBIAR un valor que la copia captura (el idioma en
 *      localStorage) y RESTAURAR: el valor tiene que volver. HALLAZGO de este spec
 *      (medido antes del arreglo): `createEmergencyBackup` + `restoreFromLatestBackup`
 *      devolvian `success: true` con `restoredComponents: []` y el idioma NO volvia
 *      — la copia de emergencia salvaba VACIO ('all' sin expandir) y el rescate lo
 *      declaraba bueno (7.7.c: mentira de respaldo).
 *   3) CONDUCTA DEL MOTOR DE DECISIONES: con el sistema sano, `evaluateAndDecide()`
 *      NO decide (histeresis: "evita cambios bruscos") y por tanto NO escribe el
 *      proveedor: la clave queda intacta, que es la garantia de escritor unico
 *      (setPreferredAIProvider).
 *
 * Los modulos se importan en RUNTIME (dev server de Vite) con especificador por
 * variable: es el codigo REAL servido a la app, no una copia.
 */
import { expect, test } from '@playwright/test';
import { autoSkipOnboarding, gotoClean } from './_helpers';

const RUTA_RESPALDO = '/src/core/autonomy/backupSystem.ts';
const RUTA_MOTOR = '/src/core/autonomy/decisionEngine.ts';
const RUTA_FACTORY = '/src/services/aiServiceFactory.ts';

test.describe('autonomia: panel y respaldo/motor reales (P8.47)', () => {
    test('el panel de Sistemas Autonomos se monta con sus cinco sistemas', async ({ page }) => {
        await autoSkipOnboarding(page);
        await gotoClean(page);

        const panel = page.locator('.flu-autonomy-panel');
        await panel.waitFor({ state: 'attached', timeout: 45000 });
        const nombres = (await panel.locator('.flu-autonomy-panel__system-name').allInnerTexts()).join(' | ');
        for (const sistema of ['Health Monitor', 'Auto Recovery', 'Decision Engine', 'Auto Optimization', 'Backup System']) {
            expect(nombres, 'falta el sistema ' + sistema + ' en el panel').toContain(sistema);
        }
        const estado = await panel.locator('.flu-autonomy-panel__status').first().innerText();
        expect(estado.trim().length).toBeGreaterThan(0);
    });

    test('el respaldo real: crear, cambiar el idioma y restaurar devuelve el valor', async ({ page }) => {
        await autoSkipOnboarding(page);
        await gotoClean(page);

        const resultado = await page.evaluate(async (ruta) => {
            const backup = (await import(/* @vite-ignore */ ruta)) as {
                createEmergencyBackup: () => { components?: string[] } | null;
                restoreFromLatestBackup: () => {
                    success: boolean;
                    restoredComponents: string[];
                    failedComponents: string[];
                    message: string;
                };
            };
            localStorage.setItem('flu-language', 'en');
            const metadata = backup.createEmergencyBackup();
            localStorage.setItem('flu-language', 'both');
            const restaurado = backup.restoreFromLatestBackup();
            return {
                componentesDeLaCopia: metadata?.components || [],
                restaurado,
                idiomaTrasRestaurar: localStorage.getItem('flu-language'),
            };
        }, RUTA_RESPALDO);

        // La copia DECLARA lo que contiene: 'all' expandido, no el literal.
        expect(
            resultado.componentesDeLaCopia.length,
            'la copia no declaro componentes: ' + JSON.stringify(resultado.componentesDeLaCopia),
        ).toBeGreaterThan(1);
        expect(resultado.componentesDeLaCopia).not.toContain('all');
        expect(resultado.restaurado.success, 'restaurar fallo: ' + resultado.restaurado.message).toBe(true);
        expect(resultado.restaurado.failedComponents).toEqual([]);
        expect(
            resultado.restaurado.restoredComponents.length,
            'no restauro ningun componente',
        ).toBeGreaterThan(0);
        expect(
            resultado.idiomaTrasRestaurar,
            'la restauracion no devolvio el idioma capturado en la copia',
        ).toBe('en');
    });

    test('el motor de decisiones no escribe el proveedor sin decision (histeresis)', async ({ page }) => {
        await autoSkipOnboarding(page);
        await gotoClean(page);

        const salida = await page.evaluate(
            async ({ rutaMotor, rutaFactory }) => {
                const motor = (await import(/* @vite-ignore */ rutaMotor)) as {
                    DecisionEngine: {
                        create: (c?: Record<string, unknown>) => { evaluateAndDecide: () => Promise<unknown> };
                    };
                    getRecentAutonomousDecisions: (n?: number) => unknown;
                };
                const factory = (await import(/* @vite-ignore */ rutaFactory)) as {
                    getPreferredAIProvider: () => string;
                };
                const antes = factory.getPreferredAIProvider();
                const engine = motor.DecisionEngine.create({ enabled: true });
                const decision = await engine.evaluateAndDecide();
                return {
                    antes,
                    despues: factory.getPreferredAIProvider(),
                    decision,
                    historial: motor.getRecentAutonomousDecisions(5),
                };
            },
            { rutaMotor: RUTA_MOTOR, rutaFactory: RUTA_FACTORY },
        );

        // Sistema sano: el motor NO propone cambio (histeresis) y no toca la clave.
        expect(salida.decision, 'el motor decidio un cambio con el sistema sano').toBeNull();
        expect(salida.despues, 'el motor escribio el proveedor sin decision').toBe(salida.antes);
        expect(Array.isArray(salida.historial)).toBe(true);
    });
});
