// ============================================================
// minuta-resumen.spec.ts — P8.8: el flujo de minutas no tenia e2e.
//
// Conduce el pipeline REAL de voz (window.__fluOnContractResolved → arbitro
// deterministico → dispatchFluEvent) para (1) GENERAR_RESUMEN y (2)
// GUARDAR_MINUTA, y comprueba que la minuta queda PERSISTIDA en la tienda
// Dexie `minutes` (dueno: src/lib/minuteKnowledgeHelpers.ts +
// src/hooks/useMinuteKnowledge.ts + src/voice/lib/minuteKnowledge.js).
//
// La IA se sustituye en la RED, no en el producto: el motor de texto del
// proyecto es OpenAI-compatible y llama DIRECTO a `.../chat/completions`
// (fetchTextEngine -> buildTextApiUrl). El resto del flujo (handler, borrador,
// snapshot, addMinute) corre de verdad.
// ============================================================

import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { gotoClean, stubLocalSpeech, readStore, clearStore, autoSkipOnboarding, captureScreenshot } from './_helpers';

const SHOTS_DIR = path.join(process.cwd(), 'reports', 'minuta');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

/** Formato OS2 que produce el motor de texto (deepseek.generateMinute). */
const MINUTE = {
    titulo: 'Minuta e2e',
    participantes: ['Ana'],
    resumen: 'Se acordo revisar el plan del trimestre.',
    acuerdos: ['Revisar el plan'],
    pendientes: ['Confirmar fecha'],
    siguientes_pasos: ['Enviar el acta'],
    tema_sesion: 'neutral',
};

test.beforeEach(async ({ page }) => {
    await autoSkipOnboarding(page);
});

test.describe('Minuta — generar el resumen y guardarla persiste en `minutes`', () => {
    test.describe.configure({ mode: 'serial' });

    test('el flujo real de voz deja la minuta persistida', async ({ page }) => {
        stubLocalSpeech(page);

        // La IA, sustituida en la RED con forma OpenAI (el motor de texto del
        // proyecto es OpenAI-compatible y llama directo a /chat/completions).
        const hits: string[] = [];
        await page.route('**/chat/completions', (route) => {
            hits.push(route.request().url());
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(MINUTE) } }] }),
            });
        });
        // Si el proveedor activo fuera el nativo (Gemini), el resumen va por el
        // proxy: se cubre la misma respuesta en formato OS2.
        await page.route('**/api/gemini/**', (route) => {
            hits.push(route.request().url());
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MINUTE) });
        });

        await gotoClean(page);
        await clearStore(page, 'minutes');

        await page.evaluate(async () => {
            const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
            const store = (window as any).__fluStore;
            if (!store?.getState) throw new Error('__fluStore no disponible');
            const st = store.getState();
            const now = Date.now();
            st.addConversationEntry({ id: 'minuta-e2e-1', speakerName: 'Ana', text: 'Hola, revisemos el plan del trimestre', timestamp: now });
            st.addConversationEntry({ id: 'minuta-e2e-2', speakerName: 'FLU', text: 'De acuerdo, lo revisamos', timestamp: now });
            if (store.getState().conversationHistory.length === 0) throw new Error('no se pudo sembrar la conversacion');

            const get = () => (window as any).__fluOnContractResolved;
            const fn1 = get();
            if (typeof fn1 !== 'function') throw new Error('__fluOnContractResolved no disponible');
            await fn1({
                contract: { navegacion: { comando: 'GENERAR_RESUMEN' } },
                transcript: 'ok flu genera el resumen',
            });
            await wait(2500);
            const fn2 = get();
            if (typeof fn2 !== 'function') throw new Error('__fluOnContractResolved ausente tras el resumen');
            await fn2({
                contract: { navegacion: { comando: 'GUARDAR_MINUTA' } },
                transcript: 'ok flu guarda la minuta',
            });
            await wait(2500);
        });

        // La IA se llamo (el stub caso): si no, el test no prueba el flujo.
        expect(hits.length, 'el resumen debe pedir la IA (stub de /chat/completions)').toBeGreaterThan(0);

        const rows = await readStore(page, 'minutes');
        expect(rows.length, 'debe persistir la minuta en `minutes`').toBeGreaterThan(0);

        const ultima = rows[rows.length - 1];
        const snapshot = ultima.summarySnapshot || ultima;
        expect(String(snapshot.titulo || '').trim(), 'la minuta guardada tiene titulo').toBeTruthy();

        await captureScreenshot(page, SHOTS_DIR, 'minuta-guardada.png');
    });
});
