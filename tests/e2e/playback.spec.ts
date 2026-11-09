// ============================================================
// FLU Playback - spec de soporte
// ------------------------------------------------------------
// Reproduce el WAV por un cable de audio virtual. La app lo escucha por su
// micrófono predeterminado y ejecuta su camino normal: Chrome SpeechRecognition
// real, VAD, tramos y reglas de conversación. No se sustituye el ASR, no se
// inyecta PCM, no se cancela el TTS y no se siembran filas.
// ============================================================
import { expect, test } from '@playwright/test';
import { loadSession } from '../../scripts/playback/session.mjs';
import { autoSkipOnboarding, gotoClean, seedActiveUser } from './_helpers';
import { installPlaybackPlayer, seedRecordedParticipants } from './playbackHelpers';

const SESSION_PATH = process.env.FLU_PLAYBACK_SESSION || '';
const WAV_FILE = process.env.FLU_PLAYBACK_WAV_FILE || '';
const TAIL_MS = Number(process.env.FLU_PLAYBACK_TAIL_MS || 5000);
const TIMEOUT_MS = Number(process.env.FLU_PLAYBACK_TIMEOUT_MS || 600000);
const REPORT_ROWS = process.env.FLU_PLAYBACK_REPORT_ROWS === '1';
const SETTLE_MS = Number(process.env.FLU_PLAYBACK_SETTLE_MS || 3000);
const SETTLE_MAX_MS = Number(process.env.FLU_PLAYBACK_SETTLE_MAX_MS || 60000);
const OUTPUT_DEVICE = process.env.FLU_PLAYBACK_OUTPUT_DEVICE || '';
const INPUT_DEVICE = process.env.FLU_PLAYBACK_INPUT_DEVICE || '';
const CHROME_CHANNEL = (process.env.FLU_PLAYBACK_CHANNEL || 'chrome') as 'chrome';
const WAV_URL = 'https://playback.local/session.wav';

test.skip(!SESSION_PATH || !WAV_FILE, 'FLU Playback se ejecuta con npm run playback');
test.setTimeout(TIMEOUT_MS);
test.use({
    channel: CHROME_CHANNEL,
    headless: process.env.FLU_PLAYBACK_HEADED !== '1',
    permissions: ['microphone'],
});

const session: any = SESSION_PATH ? loadSession(SESSION_PATH) : null;
const recordedLanguage = String(
    session?.manifest?.language || session?.meta?.language || '',
).toLowerCase();
const uiLanguage = recordedLanguage.startsWith('en')
    ? 'en'
    : recordedLanguage.startsWith('es')
      ? 'es'
      : '';

test(`FLU Playback (${SESSION_PATH ? session.sessionId : 'sin sesión'})`, async ({ page }) => {
    if (!session) throw new Error('Falta FLU_PLAYBACK_SESSION');

    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await autoSkipOnboarding(page);
    await page.route(WAV_URL, (route) =>
        route.fulfill({
            path: WAV_FILE,
            contentType: 'audio/wav',
            headers: { 'Access-Control-Allow-Origin': '*' },
        }),
    );
    await page.addInitScript(installPlaybackPlayer(), {
        url: WAV_URL,
        outputQuery: OUTPUT_DEVICE,
        inputQuery: INPUT_DEVICE,
    });

    await gotoClean(page);
    // PRE-FLIGHT (medido 2026-11-10): el routing se comprobaba DESPUÉS de arrancar la app y
    // esperar LISTENING (hasta 180 s) para acabar diciendo que el micrófono no es el cable.
    // Se prepara ANTES: si VoiceMeeter no está enrutado, falla en segundos con el motivo
    // exacto (qué dispositivo ve y cuál espera) en vez de dejar al dueño esperando.
    await page.evaluate(async () => {
        await (window as any).__fluPlayback?.prepare?.();
    });
    if (uiLanguage) {
        await page.evaluate((lang) => localStorage.setItem('flu-language', lang), uiLanguage);
    }
    if (session.hasBaseStart && session.baseStartParticipants.length > 0) {
        await seedRecordedParticipants(page, session.baseStartParticipants);
    } else {
        await seedActiveUser(page, 'Usuario Playback');
    }
    await page.waitForSelector('.flu-shell', { timeout: 45000 });

    const clicked = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('button,[role="button"]'));
        const button = nodes.find((node) =>
            /iniciar/i.test(String(node.getAttribute('aria-label') || node.textContent || '')),
        );
        if (!button) return false;
        (button as HTMLElement).click();
        return true;
    });
    if (!clicked) throw new Error('No se encontró el botón Iniciar');

    await page.waitForFunction(
        () => (window as any).__fluStore?.getState?.().conversationState === 'LISTENING',
        null,
        { timeout: 180000 },
    );

    // La app ya está escuchando por el cable. Se reproduce el WAV por la salida
    // del cable: Chrome SpeechRecognition lo oye como si fuera el usuario.
    await page.evaluate(async () => {
        await (window as any).__fluPlayback?.start?.();
    });

    await page.waitForFunction(
        () => {
            const status = (window as any).__fluPlayback?.status?.();
            if (!status) return false;
            if (status.ended === true) return true;
            return Number(status.duration) > 0 && Number(status.position) >= Number(status.duration) - 0.25;
        },
        null,
        { timeout: TIMEOUT_MS - 60000 },
    );
    await page.waitForTimeout(TAIL_MS);

    await page.evaluate(
        async ({ quietMs, maxMs }) => {
            const w = window as any;
            await w.__fluWhenRecognitionIdle?.();
            let last = '';
            let stableSince = Date.now();
            const started = Date.now();
            while (Date.now() - started < maxMs) {
                const snapshot = JSON.stringify(w.__fluStore?.getState?.().conversationHistory || []);
                if (snapshot !== last) {
                    last = snapshot;
                    stableSince = Date.now();
                } else if (Date.now() - stableSince >= quietMs) {
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
        },
        { quietMs: SETTLE_MS, maxMs: SETTLE_MAX_MS },
    );
    await page.evaluate(() => (window as any).__fluPlayback?.stop?.());

    if (REPORT_ROWS) {
        const rows = await page.evaluate(() => {
            const store = (window as any).__fluStore?.getState?.();
            return Array.isArray(store?.conversationHistory) ? store.conversationHistory : [];
        });
        console.log('[playback rows]', JSON.stringify(rows));
    }

    expect(errors, `pageerrors: ${errors.join(' | ')}`).toEqual([]);
});
