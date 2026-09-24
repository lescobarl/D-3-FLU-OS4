// ============================================================
// auditoria-despacho-real.spec.ts — AUDITORÍA REAL del despacho
// determinista (Point F / §Estructura) contra la app en :5175.
//
// PROPÓSITO (a petición explícita del usuario):
//   "olvida tus pruebas, haz una auditoría de los casos que
//    implementaste y valida con datos reales y el escenario real
//    que funcionan."
//
// Esta spec NO usa unit tests ni parsers aislados. Carga la app
// REAL (con su IndexedDB/Dexie real 'flu-os3'), inyecta el
// transcript REAL por el MISMO pipeline de voz
// (window.__fluOnContractResolved → normalizeCommandForDeterministic
//  → resolveDeterministicCommand → despacho al manejador), y luego
// LEE la persistencia REAL en IndexedDB para comprobar que el
// registro se creó con los campos correctos.
//
// Casos auditados (los implementados en el refactor estructural):
//   1. Recordatorio   → store 'reminders'
//   2. Lista compras  → store 'shoppingItems'
//   3. Alarma         → store 'temporalItems' (kind alarm)
//   4. Temporizador   → store 'temporalItems' (kind timer)
//   5. Diario         → store 'diaryEntries'
//   6. Nota           → store 'notes'
//   7. Horario        → store 'horario'
//
// Capturas: reports/auditoria-despacho-real/.
// ============================================================

import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { gotoClean, stubLocalSpeech, readStore, clearStore, captureScreenshot, autoSkipOnboarding, readAgenda, clearAgenda } from './_helpers';

// Este spec NO valida el onboarding: su overlay se reabre async (estado
// per-user en IndexedDB) y su backdrop intercepta clics. Se auto-omite para que
// los flujos lleguen a ejecutarse de verdad.
test.beforeEach(async ({ page }) => {
    await autoSkipOnboarding(page);
});

const SHOTS_DIR = path.join(process.cwd(), 'reports', 'auditoria-despacho-real');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

/**
 * Conduce el transcript REAL por el pipeline real de voz.
 * contract vacío + transcript → el gate determinista (App.tsx) lo
 * normaliza, lo resuelve con el árbitro y despacha al manejador.
 */
async function driveTranscript(page: Page, transcript: string): Promise<string> {
    let reply = '';
    await page.evaluate(
        ({ t }) => {
            const fn = (window as any).__fluOnContractResolved;
            if (typeof fn !== 'function') {
                throw new Error('__fluOnContractResolved no disponible');
            }
            return fn({ contract: {}, transcript: t }).then((r: any) => r || '');
        },
        { t: transcript },
    ).then((r) => {
        reply = r || '';
    });
    // Esperar a que la persistencia asíncrona (Dexie) se asiente.
    await page.waitForTimeout(600);
    return reply;
}

// ============================================================
// AUDITORÍA REAL
// ============================================================
test.describe('🔍 AUDITORÍA REAL del despacho determinista (Point F)', () => {
    test.describe.configure({ mode: 'serial' });

    test('1. Recordatorio: "recuérdame comprar leche a las 18:00" persiste en la agenda unificada', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearAgenda(page);

        const reply = await driveTranscript(page, 'recuérdame comprar leche a las 18:00');

        const records = await readAgenda(page, 'recordatorio');
        expect(records.length, 'debe existir 1 recordatorio persistido').toBeGreaterThan(0);
        const rec = records[records.length - 1];
        expect(rec.label).toContain('comprar leche');
        expect(rec.status).toBe('pending');
        expect(typeof rec.trigger.at).toBe('number');
        expect(rec.trigger.at).toBeGreaterThan(Date.now() - 1000);
        expect(reply).toMatch(/comprar leche/i);
        await captureScreenshot(page, SHOTS_DIR, '1-recordatorio.png');
    });

    test('2. Lista de compras: "agrega leche a la lista de compras" persiste (shoppingItems)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearStore(page, 'shoppingItems');

        const reply = await driveTranscript(page, 'agrega leche a la lista de compras');

        const records = await readStore(page, 'shoppingItems');
        expect(records.length).toBeGreaterThan(0);
        const item = records[records.length - 1];
        expect(item.label.toLowerCase()).toContain('leche');
        expect(item.checked).toBe(false);
        expect(reply).toContain('Agregué a la lista de compras');
        await captureScreenshot(page, SHOTS_DIR, '2-compras.png');
    });

    test('3. Alarma: "pon una alarma a las 7 de la mañana" persiste (temporalItems kind=alarm)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearAgenda(page);

        const reply = await driveTranscript(page, 'pon una alarma a las 7 de la mañana');

        const records = await readAgenda(page, 'alarma');
        expect(records.length).toBeGreaterThan(0);
        const item = records[records.length - 1];
        expect(item.kind).toBe('alarma');
        expect(item.status).toBe('pending');
        // La agenda unificada guarda la alarma como trigger ABSOLUTO (at), no
        // como timeOfDay: se valida el instante real (07:00 futuro).
        const when = new Date(item.trigger.at);
        expect(when.getHours()).toBe(7);
        expect(when.getMinutes()).toBe(0);
        expect(item.trigger.at).toBeGreaterThan(Date.now() - 1000);
        expect(item.trigger?.type).toBeTruthy();
        expect(reply).toBeTruthy();
        await captureScreenshot(page, SHOTS_DIR, '3-alarma.png');
    });

    test('4. Temporizador: "pon un temporizador de 5 minutos" persiste (temporalItems kind=timer)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearAgenda(page);

        const reply = await driveTranscript(page, 'pon un temporizador de 5 minutos');

        const records = await readAgenda(page, 'alarma');
        expect(records.length).toBeGreaterThan(0);
        const item = records[records.length - 1];
        expect(item.trigger?.type).toBe('countdown');
        expect(item.status).toBe('pending');
        expect(item.trigger?.durationMs).toBe(5 * 60 * 1000);
        expect(reply).toBeTruthy();
        await captureScreenshot(page, SHOTS_DIR, '4-temporizador.png');
    });

    test('5. Diario: "escribe en el diario hoy fue un gran día" persiste (diaryEntries)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearStore(page, 'diaryEntries');

        await driveTranscript(page, 'escribe en el diario hoy fue un gran día');

        const records = await readStore(page, 'diaryEntries');
        expect(records.length).toBeGreaterThan(0);
        const entry = records[records.length - 1];
        expect(entry.content).toContain('hoy fue un gran día');
        expect(entry.date).toBeTruthy();
        await captureScreenshot(page, SHOTS_DIR, '5-diario.png');
    });

    test('6. Nota: "apunta comprar pan" persiste (notes)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearStore(page, 'notes');

        await driveTranscript(page, 'apunta comprar pan');

        const records = await readStore(page, 'notes');
        expect(records.length).toBeGreaterThan(0);
        const note = records[records.length - 1];
        expect(note.label).toContain('comprar pan');
        await captureScreenshot(page, SHOTS_DIR, '6-nota.png');
    });

    test('7. Horario: "agrega matemáticas el lunes a las 8 al horario" persiste (horario)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearAgenda(page);

        const reply = await driveTranscript(page, 'agrega matemáticas el lunes a las 8 al horario');

        const records = await readAgenda(page, 'clase');
        expect(records.length).toBeGreaterThan(0);
        const entry = records[records.length - 1];
        expect(entry.label.toLowerCase()).toContain('matemáticas');
        expect(entry.trigger?.daysOfWeek?.[0]).toBe(1); // lunes
        expect(entry.trigger?.timeOfDay).toBe('08:00');
        expect(reply).toContain('agregué');
        await captureScreenshot(page, SHOTS_DIR, '7-horario.png');
    });
});
