/**
 * D1 (dueño unico de "¿habla FLU?") - con el flag GLOBAL de TTS PEGADO
 * (`speechSynthesis.speaking === true`), el turno LLEGA a la IA.
 *
 * POR QUE ESTE SPEC: el hook preguntaba "¿habla FLU?" con `isSpeechBusy()`, que
 * incluye el flag global del motor TTS —del que su propio codigo documenta que
 * "quedaba pegado y silenciaba la escucha"— mientras la supresion de eco usaba
 * `isFluSpeaking()` (la promesa propia, acotada por watchdog). Con el flag pegado
 * la locucion se transcribia y NO obtenia respuesta (medido: 1 fila de usuario /
 * 0 respuestas ANTES; 1/1 DESPUES). Aqui se fuerza ese estado y se exige respuesta.
 */
import { test, expect } from '@playwright/test';
import {
    autoSkipOnboarding,
    gotoClean,
    readHistoryRows,
    speakViaMic,
    startConversation,
    stubSpeechRecognition,
} from './_helpers';

const FRASE = 'Okay Flow platicame de los volcanes de islandia';

test('D1: el flag global de TTS pegado no se traga el turno', async ({ page }) => {
    await page.addInitScript(() => {
        const noop = () => {};
        // TTS con el flag GLOBAL pegado: `speaking` NUNCA vuelve a false.
        const synth = {
            speaking: true,
            pending: true,
            speak(utterance: any) {
                setTimeout(() => {
                    try {
                        if (typeof utterance?.onend === 'function') utterance.onend();
                    } catch {
                        /* noop */
                    }
                }, 5);
            },
            cancel: noop,
            pause: noop,
            resume: noop,
            getVoices: () => [],
            onvoiceschanged: null,
            addEventListener: noop,
            removeEventListener: noop,
        };
        Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
        (window as any).SpeechSynthesisUtterance = class {
            text = '';
            lang = '';
            rate = 1;
            pitch = 1;
            volume = 1;
            voice: any = null;
            onend: any = null;
            onerror: any = null;
            constructor(text?: string) {
                this.text = text || '';
            }
        };
    });
    await autoSkipOnboarding(page);
    await stubSpeechRecognition(page);
    await gotoClean(page);
    await startConversation(page);
    await page.waitForFunction(
        () => (window as any).__fluStore?.getState?.().conversationState === 'LISTENING',
        null,
        { timeout: 40000 },
    );

    for (let i = 0; i < 6; i += 1) {
        await speakViaMic(page, FRASE);
        const ok = await page
            .waitForFunction(
                (n) =>
                    ((window as any).__fluStore?.getState?.().conversationHistory || []).filter(
                        (r: any) => r.role === 'flu',
                    ).length >= n,
                1,
                { timeout: 8000 },
            )
            .then(() => true)
            .catch(() => false);
        if (ok) break;
        await page.waitForTimeout(800);
    }

    const filas = await readHistoryRows(page);
    const usuarios = filas.filter((r) => r.role === 'user').length;
    const respuestas = filas.filter((r) => r.role === 'flu').length;
    console.log('SIM-D1 filas usuario=' + usuarios + ' respuestas=' + respuestas);
    expect(usuarios).toBeGreaterThanOrEqual(1); // la locucion SI se transcribio
    expect(respuestas).toBeGreaterThanOrEqual(1); // y SI obtuvo respuesta
});
