/**
 * P8.41 - Una locucion = una fila = una ejecucion (camino REAL de la voz).
 *
 * POR QUE ESTE SPEC: hasta hoy NINGUN spec e2e conducia la entrada de voz (0 de 11):
 * todos inyectaban contratos ya resueltos, asi que el camino real (onresult ->
 * onend -> ingress -> dispatch -> fila) NO estaba cubierto y el duplicado de fila
 * paso verde durante dos sesiones. Aqui la app habla por un micro FALSO
 * (SpeechRecognition sustituido antes de cargar), con lo que el pipeline real corre
 * igual que con Chrome y la prueba puede entregar la misma locucion dos veces.
 *
 * INVARIANTE: una locucion entregada dos veces con el turno vivo -> UNA fila y UNA
 * respuesta; dos locuciones distintas -> DOS filas. Y (A3) si la etiqueta de
 * diarizacion esta registrada en el participante activo, la fila lleva su NOMBRE.
 */
import { expect, test } from '@playwright/test';
import {
    autoSkipOnboarding,
    countUserRows,
    gotoClean,
    readHistoryRows,
    seedActiveUser,
    speakUntilHeard,
    speakViaMic,
    startConversation,
    stubLocalSpeech,
    stubSpeechRecognition,
} from './_helpers';

const FRASE = 'Okay Flow platicame de los volcanes de islandia';
const OTRA = 'Okay Flow pon musica relajante';

const esperarListo = async (page: Parameters<typeof readHistoryRows>[0]) => {
    await page.waitForFunction(
        () => (window as any).__fluStore?.getState?.().conversationState === 'LISTENING',
        null,
        { timeout: 40000 },
    );
};
const usuarios = async (page: Parameters<typeof readHistoryRows>[0]) =>
    (await readHistoryRows(page)).filter((row) => row.role === 'user');
const respuestas = async (page: Parameters<typeof readHistoryRows>[0]) =>
    (await readHistoryRows(page)).filter((row) => row.role === 'flu');

test.describe('voz - una locucion = una fila = una ejecucion (P8.41)', () => {
    test.beforeEach(async ({ page }) => {
        await autoSkipOnboarding(page);
        await stubLocalSpeech(page);
        await stubSpeechRecognition(page);
        await gotoClean(page);
    });

    test('la MISMA locucion entregada dos veces con el turno vivo deja UNA fila', async ({ page }) => {
        await startConversation(page);
        await esperarListo(page);
        await speakUntilHeard(page, FRASE);

        // La MISMA locucion vuelve a llegar (reentrega del ASR) mientras el turno vive.
        await speakViaMic(page, FRASE);
        await expect
            .poll(async () => (await respuestas(page)).length, { timeout: 45000 })
            .toBeGreaterThanOrEqual(1);

        const filas = await usuarios(page);
        expect(filas).toHaveLength(1);
        expect(filas[0].text.toLowerCase()).toContain('volcanes');
    });

    test('una locucion DISTINTA si abre fila nueva (el turno avanza)', async ({ page }) => {
        await startConversation(page);
        await esperarListo(page);
        await speakUntilHeard(page, FRASE, { expectedUserRows: 1 });
        await esperarListo(page);

        await speakUntilHeard(page, OTRA, { expectedUserRows: 2 });
        expect(await countUserRows(page)).toBe(2);
    });

    test('A3: la etiqueta de diarizacion registrada estampa el NOMBRE (P8.40)', async ({ page }) => {
        await seedActiveUser(page, 'Luis', { speakerLabel: 'Hablante 1' });
        await startConversation(page);
        await esperarListo(page);

        await speakUntilHeard(page, FRASE, { expectedUserRows: 1 });

        // El nombre se estampa en el commit de RESOLUCION (el commit temprano solo
        // muestra el texto): se espera la respuesta y se mide despues.
        await expect
            .poll(async () => (await respuestas(page)).length, { timeout: 45000 })
            .toBeGreaterThanOrEqual(1);

        const filas = await usuarios(page);
        expect(filas).toHaveLength(1);
        expect(filas[0].speaker).toBe('Luis');
    });
});
