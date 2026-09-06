// ============================================================
// auditoria-acciones-llm.spec.ts — AUDITORÍA REAL de la RUTA
// CONVERSACIONAL (contract.acciones) contra la app en :5175.
//
// PROPÓSITO (fix "de fondo" conversacional, estilo Siri/Alexa/
// Google): el LLM es el cerebro único que emite TODAS las acciones
// estructuradas en su contrato como `acciones: [{dominio, texto}]`.
// onContractResolved (App.tsx) re-resuelve cada `texto` con el
// árbitro determinista y despacha al MISMO manejador __fluHandle*
// vía dispatchArbiterIntent (RUTA LLM).
//
// Esta spec carga la app REAL (IndexedDB/Dexie 'flu-os3'), inyecta
// un contrato REAL con `acciones` (como lo emitiría el LLM) por el
// MISMO pipeline (window.__fluOnContractResolved), y luego LEE la
// persistencia REAL en IndexedDB para comprobar que cada acción se
// ejecutó y persistió con los campos correctos.
//
// Casos auditados (RUTA LLM / acciones):
//   1. Recordatorio   → store 'reminders'
//   2. Lista compras  → store 'shoppingItems'
//   3. Alarma         → store 'temporalItems' (kind alarm)
//   4. Temporizador   → store 'temporalItems' (kind timer)
//   5. Diario         → store 'diaryEntries'
//   6. Nota           → store 'notes'
//   7. Horario        → store 'horario'
//
// Capturas: reports/auditoria-acciones-llm/.
// ============================================================

import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { gotoClean, stubLocalSpeech, readStore, clearStore, captureScreenshot } from './_helpers';

const SHOTS_DIR = path.join(process.cwd(), 'reports', 'auditoria-acciones-llm');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

/** Conduce un contrato REAL con `acciones` (como lo emitiría el LLM
 * conversacional) por el pipeline real de voz. El transcript se pasa
 * para que el flujo no entre en rawOnly, y `contract.acciones` dispara
 * la RUTA LLM (dispatchArbiterIntent sobre cada acción).
 */
async function driveAcciones(
    page: Page,
    acciones: Array<{ dominio: string; texto: string }>,
    transcript: string,
    respuestaVoz = '',
): Promise<string> {
    let reply = '';
    await page.evaluate(
        ({ acciones: acc, t, rv }) => {
            const fn = (window as any).__fluOnContractResolved;
            if (typeof fn !== 'function') {
                throw new Error('__fluOnContractResolved no disponible');
            }
            return fn({ contract: { acciones: acc, respuesta_voz: rv }, transcript: t }).then(
                (r: any) => r || '',
            );
        },
        { acciones, t: transcript, rv: respuestaVoz },
    ).then((r) => {
        reply = r || '';
    });
    // Esperar a que la persistencia asíncrona (Dexie) se asiente.
    await page.waitForTimeout(700);
    return reply;
}

// ============================================================
// AUDITORÍA REAL — RUTA LLM (contract.acciones)
// ============================================================
test.describe('🔍 AUDITORÍA REAL de la RUTA CONVERSACIONAL (contract.acciones)', () => {
    test.describe.configure({ mode: 'serial' });

    test('1. Acción reminder: "recuérdame comprar leche" persiste (reminders)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearStore(page, 'reminders');

        const reply = await driveAcciones(
            page,
            [{ dominio: 'reminder', texto: 'recuérdame comprar leche' }],
            'recuérdame comprar leche',
            'Claro, te recuerdo comprar leche.',
        );

        const records = await readStore(page, 'reminders');
        expect(records.length, 'debe existir 1 recordatorio persistido').toBeGreaterThan(0);
        const rec = records[records.length - 1];
        expect(rec.text).toContain('comprar leche');
        expect(rec.status).toBe('pending');
        expect(typeof rec.dueAt).toBe('number');
        expect(rec.dueAt).toBeGreaterThan(Date.now() - 1000);
        // La respuesta conversacional del LLM tiene PRIORIDAD sobre la
        // confirmación del manejador (fix "de fondo").
        expect(reply).toContain('Claro, te recuerdo comprar leche');
        await captureScreenshot(page, SHOTS_DIR, '1-reminder.png');
    });

    test('2. Acción shopping: "agrega leche a la lista de compras" persiste (shoppingItems)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearStore(page, 'shoppingItems');

        const reply = await driveAcciones(
            page,
            [{ dominio: 'reminder', texto: 'agrega leche a la lista de compras' }],
            'agrega leche a la lista de compras',
            'Listo, agregué leche a la lista de compras.',
        );

        const records = await readStore(page, 'shoppingItems');
        expect(records.length).toBeGreaterThan(0);
        const item = records[records.length - 1];
        expect(item.label.toLowerCase()).toContain('leche');
        expect(item.checked).toBe(false);
        expect(reply).toContain('Listo, agregué leche a la lista de compras');
        await captureScreenshot(page, SHOTS_DIR, '2-shopping.png');
    });

    test('3. Acción alarm: "pon una alarma a las 7 de la mañana" persiste (temporalItems kind=alarm)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearStore(page, 'temporalItems');

        const reply = await driveAcciones(
            page,
            [{ dominio: 'temporal', texto: 'pon una alarma a las 7 de la mañana' }],
            'pon una alarma a las 7 de la mañana',
            'Perfecto, alarma a las 7 de la mañana.',
        );

        const records = await readStore(page, 'temporalItems');
        expect(records.length).toBeGreaterThan(0);
        const item = records[records.length - 1];
        expect(item.kind).toBe('alarm');
        expect(item.status).toBe('pending');
        expect(item.trigger?.timeOfDay).toBe('07:00');
        expect(typeof item.nextAt).toBe('number');
        expect(reply).toContain('Perfecto, alarma a las 7 de la mañana');
        await captureScreenshot(page, SHOTS_DIR, '3-alarm.png');
    });

    test('4. Acción timer: "pon un temporizador de 5 minutos" persiste (temporalItems kind=timer)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearStore(page, 'temporalItems');

        const reply = await driveAcciones(
            page,
            [{ dominio: 'temporal', texto: 'pon un temporizador de 5 minutos' }],
            'pon un temporizador de 5 minutos',
            'Temporizador de 5 minutos iniciado.',
        );

        const records = await readStore(page, 'temporalItems');
        expect(records.length).toBeGreaterThan(0);
        const item = records[records.length - 1];
        expect(item.kind).toBe('timer');
        expect(item.status).toBe('pending');
        expect(item.trigger?.durationMs).toBe(5 * 60 * 1000);
        expect(reply).toContain('Temporizador de 5 minutos iniciado');
        await captureScreenshot(page, SHOTS_DIR, '4-timer.png');
    });

    test('5. Acción diary: "escribe en el diario hoy fue un gran día" persiste (diaryEntries)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearStore(page, 'diaryEntries');

        const reply = await driveAcciones(
            page,
            [{ dominio: 'diary', texto: 'escribe en el diario hoy fue un gran día' }],
            'escribe en el diario hoy fue un gran día',
            'Qué bonito, lo anoté en tu diario.',
        );

        const records = await readStore(page, 'diaryEntries');
        expect(records.length).toBeGreaterThan(0);
        const entry = records[records.length - 1];
        expect(entry.content).toContain('hoy fue un gran día');
        expect(entry.date).toBeTruthy();
        expect(reply).toContain('Qué bonito, lo anoté en tu diario');
        await captureScreenshot(page, SHOTS_DIR, '5-diary.png');
    });

    test('6. Acción note: "apunta comprar pan" persiste (notes)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearStore(page, 'notes');

        const reply = await driveAcciones(
            page,
            [{ dominio: 'note', texto: 'apunta comprar pan' }],
            'apunta comprar pan',
            'Anotado: comprar pan.',
        );

        const records = await readStore(page, 'notes');
        expect(records.length).toBeGreaterThan(0);
        const note = records[records.length - 1];
        expect(note.label).toContain('comprar pan');
        expect(reply).toContain('Anotado: comprar pan');
        await captureScreenshot(page, SHOTS_DIR, '6-note.png');
    });

    test('7. Acción horario: "agrega matemáticas el lunes a las 8 al horario" persiste (horario)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearStore(page, 'horario');

        const reply = await driveAcciones(
            page,
            [{ dominio: 'horario', texto: 'agrega matemáticas el lunes a las 8 al horario' }],
            'agrega matemáticas el lunes a las 8 al horario',
            'Agregué matemáticas el lunes a las 8 al horario.',
        );

        const records = await readStore(page, 'horario');
        expect(records.length).toBeGreaterThan(0);
        const entry = records[records.length - 1];
        expect(entry.materia.toLowerCase()).toContain('matemáticas');
        expect(entry.dia).toBe(1); // lunes
        expect(entry.inicio).toBe('08:00');
        expect(reply).toContain('Agregué matemáticas el lunes a las 8 al horario');
        await captureScreenshot(page, SHOTS_DIR, '7-horario.png');
    });
});
