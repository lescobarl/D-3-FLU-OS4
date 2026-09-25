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
import { gotoClean, stubLocalSpeech, readStore, clearStore, captureScreenshot, autoSkipOnboarding, readAgenda, clearAgenda, seedActiveUser } from './_helpers';

// Este spec NO valida el onboarding: su overlay se reabre async (estado
// per-user en IndexedDB) y su backdrop intercepta clics. Se auto-omite para que
// los flujos lleguen a ejecutarse de verdad.
test.beforeEach(async ({ page }) => {
    await autoSkipOnboarding(page);
});

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

    test('1. Acción reminder: "recuérdame comprar leche a las 18:00" persiste (agenda)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearAgenda(page);

        await driveAcciones(
            page,
            [{ dominio: 'reminder', texto: 'recuérdame comprar leche a las 18:00' }],
            'recuérdame comprar leche a las 18:00',
            'Claro, te recuerdo comprar leche.',
        );

        const records = await readAgenda(page, 'recordatorio');
        expect(records.length, 'debe existir 1 recordatorio persistido').toBeGreaterThan(0);
        const rec = records[records.length - 1];
        expect(rec.label).toContain('comprar leche');
        expect(rec.status).toBe('pending');
        expect(typeof rec.trigger.at).toBe('number');
        expect(rec.trigger.at).toBeGreaterThan(Date.now() - 1000);
        await captureScreenshot(page, SHOTS_DIR, '1-reminder.png');
    });

    // La persistencia (arriba) es lo que valida este test. La PRIORIDAD la tiene
    // el MANEJADOR, no el LLM: la regla esta documentada en App.tsx
    // (onContractResolved: "su confirmacion reemplaza a la del LLM") y existe por
    // una razon medida -- el manejador conoce la hora y el tipo reales, el LLM no.
    // Antes esto era un fixme porque un comentario obsoleto decia lo contrario.
    test('1b. La confirmacion del manejador gana sobre respuesta_voz (regla unica)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearAgenda(page);
        const reply = await driveAcciones(
            page,
            [{ dominio: 'reminder', texto: 'recuérdame comprar leche a las 18:00' }],
            'recuérdame comprar leche a las 18:00',
            'Claro, te recuerdo comprar leche.',
        );
        expect(reply).not.toContain('Claro, te recuerdo comprar leche');
        expect(reply.length).toBeGreaterThan(0);
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
        // El ack del manejador es la autoridad (dice lo que se escribio de verdad):
        // la `respuesta_voz` del LLM ('Listo, agregué leche...') NO gana.
        expect(reply).toContain('Agregué a la lista de compras');
        expect(reply).toContain('leche');
        expect(reply).not.toContain('Listo, agregué leche a la lista de compras');
        await captureScreenshot(page, SHOTS_DIR, '2-shopping.png');
    });

    test('3. Acción alarm: "pon una alarma a las 7 de la mañana" persiste (temporalItems kind=alarm)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearAgenda(page);

        const reply = await driveAcciones(
            page,
            [{ dominio: 'temporal', texto: 'pon una alarma a las 7 de la mañana' }],
            'pon una alarma a las 7 de la mañana',
            'Perfecto, alarma a las 7 de la mañana.',
        );

        const records = await readAgenda(page, 'alarma');
        expect(records.length).toBeGreaterThan(0);
        const item = records[records.length - 1];
        expect(item.kind).toBe('alarma');
        expect(item.status).toBe('pending');
        // Una alarma es un instante ABSOLUTO: `timeOfDay` solo existe para los
        // triggers weekly/daily (agendaModel.ts: AgendaTrigger). Se valida el
        // instante real, como ya hace auditoria-despacho-real.spec.ts.
        expect(item.trigger?.type).toBe('absolute');
        const when = new Date(item.trigger.at);
        expect(when.getHours()).toBe(7);
        expect(when.getMinutes()).toBe(0);
        // El ack del manejador gana (sabe la hora real); el `respuesta_voz` no.
        expect(reply).not.toContain('Perfecto, alarma a las 7 de la mañana');
        expect(reply.length).toBeGreaterThan(0);
        await captureScreenshot(page, SHOTS_DIR, '3-alarm.png');
    });

    test('4. Acción timer: "pon un temporizador de 5 minutos" persiste (temporalItems kind=timer)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearAgenda(page);

        const reply = await driveAcciones(
            page,
            [{ dominio: 'temporal', texto: 'pon un temporizador de 5 minutos' }],
            'pon un temporizador de 5 minutos',
            'Temporizador de 5 minutos iniciado.',
        );

        const records = await readAgenda(page, 'alarma');
        expect(records.length).toBeGreaterThan(0);
        const item = records[records.length - 1];
        expect(item.trigger?.type).toBe('countdown');
        expect(item.status).toBe('pending');
        expect(item.trigger?.durationMs).toBe(5 * 60 * 1000);
        // El ack del manejador gana (regla unica, App.tsx); el `respuesta_voz` del LLM no.
        expect(reply).not.toContain('Temporizador de 5 minutos iniciado');
        expect(reply.length).toBeGreaterThan(0);
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
        // El ack del manejador gana (regla unica, App.tsx); el `respuesta_voz` del LLM no.
        expect(reply).not.toContain('Qué bonito, lo anoté en tu diario');
        expect(reply.length).toBeGreaterThan(0);
        await captureScreenshot(page, SHOTS_DIR, '5-diary.png');
    });

    test('6. Acción note: "apunta comprar pan" persiste (notes)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
    await seedActiveUser(page, 'Usuario E2E');
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
        // El ack del manejador gana (regla unica, App.tsx); el `respuesta_voz` del LLM no.
        expect(reply).not.toContain('Anotado: comprar pan');
        expect(reply.length).toBeGreaterThan(0);
        await captureScreenshot(page, SHOTS_DIR, '6-note.png');
    });

    test('7. Acción horario: "agrega matemáticas el lunes a las 8 al horario" persiste (horario)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearAgenda(page);

        const reply = await driveAcciones(
            page,
            [{ dominio: 'horario', texto: 'agrega matemáticas el lunes a las 8 al horario' }],
            'agrega matemáticas el lunes a las 8 al horario',
            'Agregué matemáticas el lunes a las 8 al horario.',
        );

        const records = await readAgenda(page, 'clase');
        expect(records.length).toBeGreaterThan(0);
        const entry = records[records.length - 1];
        expect(entry.label.toLowerCase()).toContain('matemáticas');
        expect(entry.trigger?.daysOfWeek?.[0]).toBe(1); // lunes
        expect(entry.trigger?.timeOfDay).toBe('08:00');
        // El ack del manejador gana (regla unica, App.tsx); el `respuesta_voz` del LLM no.
        expect(reply).not.toContain('Agregué matemáticas el lunes a las 8 al horario');
        expect(reply.length).toBeGreaterThan(0);
        await captureScreenshot(page, SHOTS_DIR, '7-horario.png');
    });

    test('8. Acción reminder SIN trigger (dominio LLM) persiste (reminders)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearAgenda(page);

        await driveAcciones(
            page,
            [{ dominio: 'reminder', texto: 'tomar el medicamento a las 12:00' }],
            'tomar el medicamento a las 12:00',
            'Listo, te lo recuerdo a las 12:00.',
        );

        const records = await readAgenda(page, 'recordatorio');
        expect(records.length, 'debe existir 1 recordatorio persistido').toBeGreaterThan(0);
        const rec = records[records.length - 1];
        // El parser normaliza la etiqueta quitando articulos («tomar el
        // medicamento» -> «tomar  medicamento»), igual que en el resto de la
        // agenda; se asevera el contenido, no el articulo.
        expect(rec.label).toContain('medicamento');
        expect(rec.label).toContain('tomar');
        expect(rec.status).toBe('pending');
        expect(typeof rec.trigger.at).toBe('number');
        await captureScreenshot(page, SHOTS_DIR, '8-reminder-sin-trigger.png');
    });

    test('9. Acción note "incluye en la nota del súper ..." agrega a la nota Super', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await seedActiveUser(page, 'Usuario E2E');
        await clearStore(page, 'notes');

        await driveAcciones(
            page,
            [
                {
                    dominio: 'note',
                    texto: 'incluye en la nota del súper que también traiga una computadora',
                },
            ],
            'incluye en la nota del súper que también traiga una computadora',
            'Listo, lo agregué a la nota del súper.',
        );

        const records = await readStore(page, 'notes');
        expect(records.length).toBeGreaterThan(0);
        const note = records[records.length - 1];
        expect(note.label).toContain('Super:');
        expect(String(note.label).toLowerCase()).toContain('computadora');
        await captureScreenshot(page, SHOTS_DIR, '9-note-super.png');
    });
});
