/**
 * P8.31 - Un turno de MUSICA con la partida activa: lo atiende la musica, NO el
 * motor del juego, y la partida sigue VIVA (queda en pausa y se retoma).
 *
 * POR QUE ESTE SPEC: `src/core/media/musicActions.ts` era el hueco declarado del
 * bloque (cambiado y sin spec en e2eScope) porque ningun spec conducia la entrada
 * de voz. Con el arnes de voz del repo (P8.41: tests/e2e/_helpers.stubSpeechRecognition,
 * micro falso por el MISMO camino que Chrome) la partida se arranca por voz y el turno
 * ajeno se mide en el artefacto real de la app (su log de relay: '[Musica] play_music').
 *
 * INVARIANTE (AGENTS, anexo B.19 / guard gameDoesNotHijackCommands): con partida activa,
 * una orden AJENA no la consume el motor; la partida queda EN PAUSA y se RETOMA con
 * cualquier orden de juego.
 */
import { expect, test } from '@playwright/test';
import {
    autoSkipOnboarding,
    gotoClean,
    readHistoryRows,
    speakUntilHeard,
    startConversation,
    stubLocalSpeech,
    stubSpeechRecognition,
} from './_helpers';

const ARRANQUE = 'Okay Flow vamos a jugar loteria';
const MUSICA = 'Okay Flow pon musica relajante';
const CARTA = 'Okay Flow siguiente carta';

type P = Parameters<typeof readHistoryRows>[0];
const esperarListo = async (page: P) => {
    await page.waitForFunction(
        () => (window as any).__fluStore?.getState?.().conversationState === 'LISTENING',
        null,
        { timeout: 40000 },
    );
};
const respuestas = async (page: P) =>
    (await readHistoryRows(page)).filter((row) => row.role === 'flu');

test.describe('musica con partida activa (P8.31)', () => {
    test('el turno de musica lo atiende la musica y la partida se retoma', async ({ page }) => {
        const relay: string[] = [];
        await page.route('**/__flu_client_log', async (route) => {
            const body = route.request().postData() || '[]';
            try {
                for (const entry of JSON.parse(body)) relay.push(`${entry.tag} ${entry.message}`);
            } catch {
                /* lote no parseable: no es evidencia */
            }
            await route.fulfill({ status: 204, body: '' });
        });
        await autoSkipOnboarding(page);
        await stubLocalSpeech(page);
        await stubSpeechRecognition(page);
        await gotoClean(page);
        await startConversation(page);
        await esperarListo(page);

        // 1) La partida arranca POR VOZ (fast-path determinista del motor de juego).
        await speakUntilHeard(page, ARRANQUE, { expectedUserRows: 1 });
        await expect.poll(async () => (await respuestas(page)).length, { timeout: 60000 }).toBeGreaterThanOrEqual(1);

        // 2) Con la partida activa se pide musica: el turno lo atiende la MUSICA.
        relay.length = 0;
        await speakUntilHeard(page, MUSICA, { expectedUserRows: 2 });
        await expect
            .poll(() => relay.filter((line) => /\[Música\] play_music/.test(line)).length, { timeout: 60000 })
            .toBeGreaterThanOrEqual(1);

        // 3) La partida NO se consumio: sigue VIVA y se RETOMA con una orden de juego.
        const respuestasAntes = (await respuestas(page)).length;
        await speakUntilHeard(page, CARTA, { expectedUserRows: 3 });
        await expect
            .poll(async () => (await respuestas(page)).length, { timeout: 60000 })
            .toBeGreaterThan(respuestasAntes);
    });
});
