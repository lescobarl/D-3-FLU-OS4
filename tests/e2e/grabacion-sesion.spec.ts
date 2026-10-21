// ============================================================
// grabacion-sesion.spec.ts — la grabación de diagnóstico es una
// OPCIÓN con bandera propia (como los logs).
//
// Valida contra la app REAL:
//   • Apagada por defecto (no graba nada).
//   • `__fluDev.recorder.enable()` la enciende y persiste la bandera.
//   • El pipeline de voz REAL (micrófono falso -> ingress -> dispatch)
//     alimenta eventos mientras está encendida.
//   • `disable()` la apaga y NO borra lo ya grabado (se puede descargar).
// ============================================================
import { expect, test } from '@playwright/test';
import { autoSkipOnboarding, gotoClean, seedActiveUser, speakUntilHeard, startConversation, stubLocalSpeech, stubSpeechRecognition } from './_helpers';

test.beforeEach(async ({ page }) => {
    await autoSkipOnboarding(page);
});

test('la grabación de sesión se enciende y apaga con su bandera, sin borrar lo grabado', async ({ page }) => {
    // Arranque en frío (avatar/WASM) + conversación real: margen explícito.
    test.setTimeout(150000);
    stubLocalSpeech(page);
    stubSpeechRecognition(page);
    await gotoClean(page);
    await seedActiveUser(page, 'Alumno E2E');
    // La activación de usuario se aplica al recargar; después se abre la escucha
    // (mismo patrón que tutoria-avance: sin esto el micro falso no tiene sesión).
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.flu-shell', { timeout: 45000 });
    await startConversation(page);

    // Apagada por defecto: el audio es sensible, nadie lo graba sin encenderla.
    const inicial = await page.evaluate(() => {
        const api = (window as any).__fluDev?.recorder;
        return { existe: Boolean(api), enabled: api?.enabled?.() ?? null };
    });
    expect(inicial.existe, '__fluDev.recorder debe existir en dev').toBe(true);
    expect(inicial.enabled, 'apagada por defecto').toBe(false);

    // Encender y persistir la bandera.
    const encendida = await page.evaluate(() => {
        const api = (window as any).__fluDev.recorder;
        api.enable();
        return { enabled: api.enabled(), flag: localStorage.getItem('flu.recorder') };
    });
    expect(encendida.enabled).toBe(true);
    expect(encendida.flag).toBe('1');

    // Hablar por el pipeline REAL: ingress -> fila de usuario.
    await speakUntilHeard(page, 'ok flu hola', { expectedUserRows: 1 });

    // La grabación debe tener eventos del pipeline (ingress/log/trace).
    await page.waitForFunction(
        () => Number((window as any).__fluDev?.recorder?.status?.().events || 0) > 0,
        null,
        { timeout: 30000 },
    );
    const conEventos = await page.evaluate(() => (window as any).__fluDev.recorder.status());

    // Apagar: la bandera cambia y lo grabado se conserva para descargar.
    const apagada = await page.evaluate(() => {
        const api = (window as any).__fluDev.recorder;
        api.disable();
        return { enabled: api.enabled(), flag: localStorage.getItem('flu.recorder'), events: api.status().events };
    });
    expect(apagada.enabled).toBe(false);
    expect(apagada.flag).toBe('0');
    expect(apagada.events).toBeGreaterThan(0);
    expect(apagada.events).toBe(conEventos.events);
});
