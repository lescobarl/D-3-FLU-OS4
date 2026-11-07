// ============================================================
// FLU Playback - spec de soporte
// ------------------------------------------------------------
// SOLO reproduce el WAV de una sesión como micrófono virtual. No sustituye
// el ASR, no inyecta transcripciones y no siembra resultados. La app escucha
// el audio con su motor normal (en playback, el motor local ya existente).
// ============================================================
import { expect, test } from '@playwright/test';
import { loadSession } from '../../scripts/playback/session.mjs';
import { autoSkipOnboarding, gotoClean, seedActiveUser } from './_helpers';
import { stubWavMicrophone } from './playbackHelpers';

const SESSION_PATH = process.env.FLU_PLAYBACK_SESSION || '';
const LEAD_IN_MS = Number(process.env.FLU_PLAYBACK_LEAD_IN_MS || 0);
const TAIL_MS = Number(process.env.FLU_PLAYBACK_TAIL_MS || 5000);
const TIMEOUT_MS = Number(process.env.FLU_PLAYBACK_TIMEOUT_MS || 600000);
const WAV_URL = 'https://playback.local/session.wav';

test.skip(!SESSION_PATH, 'FLU Playback se ejecuta con npm run playback');
test.setTimeout(TIMEOUT_MS);
test.use({ headless: process.env.FLU_PLAYBACK_HEADED !== '1' });

const session: any = SESSION_PATH ? loadSession(SESSION_PATH) : null;

test(`FLU Playback (${SESSION_PATH ? session.sessionId : 'sin sesión'})`, async ({ page }) => {
    if (!session) throw new Error('Falta FLU_PLAYBACK_SESSION');
    if (!session.audioPath.toLowerCase().endsWith('.wav')) {
        throw new Error('FLU Playback solo reproduce audio.wav');
    }

    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await autoSkipOnboarding(page);
    // La app usa su motor local ya existente para oír el WAV. No hay
    // SpeechRecognition falso ni guion de texto: solo audio.
    await page.addInitScript(() => {
        (window as any).__FLU_PLAYBACK_LOCAL_ASR = true;
    });
    await page.route(WAV_URL, (route) =>
        route.fulfill({
            path: session.audioPath,
            contentType: 'audio/wav',
            headers: { 'Access-Control-Allow-Origin': '*' },
        }),
    );
    await page.addInitScript(stubWavMicrophone(), WAV_URL);

    await gotoClean(page);
    await seedActiveUser(page, 'Usuario Playback');
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
        { timeout: 60000 },
    );
    if (LEAD_IN_MS > 0) await page.waitForTimeout(LEAD_IN_MS);

    await page.waitForFunction(
        () => (window as any).__fluPlayback?.status?.()?.ready === true,
        null,
        { timeout: 60000 },
    );
    await page.evaluate(async () => {
        await (window as any).__fluPlayback?.start?.();
    });

    await page.waitForFunction(
        () => {
            const status = (window as any).__fluPlayback?.status?.();
            if (!status) return false;
            if (status.ended) return true;
            return (
                Number(status.duration) > 0 &&
                Number(status.position) >= Number(status.duration) - 0.25
            );
        },
        null,
        { timeout: TIMEOUT_MS - 60000 },
    );
    await page.waitForTimeout(TAIL_MS);
    await page.evaluate(() => (window as any).__fluPlayback?.stop?.());

    expect(errors, `pageerrors: ${errors.join(' | ')}`).toEqual([]);
});
