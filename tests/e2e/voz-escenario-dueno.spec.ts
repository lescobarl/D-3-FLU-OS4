/**
 * SIMULACION REAL del escenario reportado por el dueño (2026-10-07 15:11-15:13).
 *
 * POR QUE: las validaciones anteriores de la voz eran INYECTADAS (llamaban a las
 * funciones del pipeline directamente), asi que el camino REAL (onresult -> onend ->
 * ingress -> dispatch -> fila) no estaba medido. Aqui la app habla por el micro FALSO
 * del repo (tests/e2e/_helpers.stubSpeechRecognition) y el pipeline corre igual que
 * con Chrome. Cada caso mide lo que el dueño reporto, con el texto y el hablante
 * REALES de la fila del store.
 *
 * Casos medidos:
 *   P1  no se escribe fila ANTES del final (ni con interinos acumulativos ni sin silencio)
 *   P2  no se pierde la CABEZA cuando el final del ASR trae solo la cola
 *   P3  "soy Luis" renombra TODA la participacion (la etiqueta generica desaparece)
 *   P4  latencia final -> fila (rendimiento, medido en ms)
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

type Page = Parameters<typeof readHistoryRows>[0];

const esperarListo = async (page: Page) => {
    await page.waitForFunction(
        () => (window as any).__fluStore?.getState?.().conversationState === 'LISTENING',
        null,
        { timeout: 40000 },
    );
};

const usuarios = async (page: Page) =>
    (await readHistoryRows(page)).filter((row) => row.role === 'user');

test.describe('voz - escenario reportado por el dueño (simulacion REAL)', () => {
    test.beforeEach(async ({ page }) => {
        await autoSkipOnboarding(page);
        await stubLocalSpeech(page);
        await stubSpeechRecognition(page);
        await gotoClean(page);
    });

    test('P1: un interino acumulativo NO abre fila (solo el final la abre)', async ({ page }) => {
        await startConversation(page);
        await esperarListo(page);

        // Chrome entrega interinos ACUMULATIVOS mientras se habla. El dueño reporta
        // que la conversacion se escribe ANTES del corte/silencio.
        await speakViaMic(page, 'Okay flow necesitamos', { final: false });
        await speakViaMic(page, 'Okay flow necesitamos nuestra lechita', { final: false });
        await speakViaMic(page, 'Okay flow necesitamos nuestra lechita y no lo puso ahi', { final: false });
        await page.waitForTimeout(2500);

        const antes = await countUserRows(page);

        // Ahora llega el final (con silencio/corte): aqui SI debe nacer la fila.
        await speakViaMic(page, 'Okay flow necesitamos nuestra lechita y no lo puso ahi', {
            final: true,
            endTurn: true,
        });
        await expect.poll(async () => await countUserRows(page), { timeout: 20000 }).toBeGreaterThanOrEqual(1);

        console.log(`[P1] filas de usuario durante el interino = ${antes} (esperado 0)`);
        expect(antes, 'la fila no puede nacer antes del final').toBe(0);
    });

    test('P2: el final que trae solo la COLA no se come la cabeza', async ({ page }) => {
        await startConversation(page);
        await esperarListo(page);

        // Patron medido en el log del dueño: el interino trae la frase completa y el
        // final del ASR llega con la COLA (Chrome corta por el cambio de hablante).
        await speakViaMic(page, 'Okay flow necesitamos nuestra lechita y no lo pusiste ahi', { final: false });
        await page.waitForTimeout(800);
        await speakViaMic(page, 'y no lo pusiste ahi', { final: true, endTurn: true });

        await expect.poll(async () => await countUserRows(page), { timeout: 20000 }).toBeGreaterThanOrEqual(1);
        const filas = await usuarios(page);
        const texto = filas.map((row) => row.text).join(' | ');
        console.log(`[P2] fila = "${texto}"`);
        expect(texto.toLowerCase(), 'la cabeza de la frase no puede perderse').toContain('necesitamos');
    });

    test('P3: "soy Luis" renombra su participacion (la etiqueta generica desaparece)', async ({ page }) => {
        await seedActiveUser(page, 'Luis', { speakerLabel: 'Hablante 1' });
        await startConversation(page);
        await esperarListo(page);

        await speakUntilHeard(page, 'Okay flow soy luis', { expectedUserRows: 1 });
        await page.waitForTimeout(3000);
        await speakUntilHeard(page, 'Okay flow pon musica relajante', { expectedUserRows: 2 });

        const filas = await usuarios(page);
        const hablantes = filas.map((row) => row.speaker);
        console.log(`[P3] hablantes = ${JSON.stringify(hablantes)}`);
        for (const fila of filas) {
            expect(fila.speaker, `la fila "${fila.text}" debe llevar el nombre`).toBe('Luis');
        }
    });

    test('P3b: "soy Luis" registra el nombre SIN etiqueta sembrada (ruta del texto)', async ({ page }) => {
        // DEFECTO MEDIDO (2026-10-07, RED): tras "Okay flow soy luis" la fila del
        // turno SIGUIENTE vuelve a la etiqueta generica en 1 de cada 2 intentos
        // (log: commit {"name":"Luis"} y la fila acaba en "Hablante 1"). La causa
        // medida es que la decision "aplicar el hablante resuelto a la sesion" esta
        // escrita DOS veces con reglas distintas (useFluVoiceAssistant.js:1469-1471
        // sin la etiqueta que el hablante VENIA usando, y turnSpeakerCommit.js:200-208
        // con ella). test.fail() = se ejecuta y mide; si algun dia PASA, este spec se
        // pone en ROJO y obliga a actualizar el instrumento (la reversa del defecto).
        test.fail(true, 'DEFECTO MEDIDO: el nombre registrado no pega en el turno siguiente (ver comentario)');
        // El dueño lo dice con la voz: no hay etiqueta previa. La ruta del texto
        // (P9.11) debe registrar el participante y firmar sus filas con el nombre.
        await startConversation(page);
        await esperarListo(page);

        await speakUntilHeard(page, 'Okay flow soy luis', { expectedUserRows: 1 });
        await page.waitForTimeout(3000);
        await speakUntilHeard(page, 'Okay flow pon musica relajante', { expectedUserRows: 2 });

        const filas = await usuarios(page);
        const hablantes = filas.map((row) => row.speaker);
        console.log(`[P3b] hablantes = ${JSON.stringify(hablantes)}`);
        expect(hablantes.filter((h) => h === 'Luis').length, `hablantes=${JSON.stringify(hablantes)}`).toBeGreaterThanOrEqual(2);
    });

    test('P4: latencia final -> fila (medicion de rendimiento)', async ({ page }) => {
        await startConversation(page);
        await esperarListo(page);

        const inicio = Date.now();
        await speakViaMic(page, 'Okay flow cuentame algo corto del mar', { final: true, endTurn: true });
        await expect.poll(async () => await countUserRows(page), { timeout: 20000 }).toBeGreaterThanOrEqual(1);
        const ms = Date.now() - inicio;
        console.log(`[P4] final -> fila = ${ms} ms`);
        expect(ms, 'la fila debe nacer en un margen humano').toBeLessThan(8000);
    });
});
