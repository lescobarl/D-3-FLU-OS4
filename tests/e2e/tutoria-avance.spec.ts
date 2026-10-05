// ============================================================
// tutoria-avance.spec.ts — SIMULACION REAL del avance de tutoria por minutas.
//
// Encargo del dueno: "asegurate con simulaciones reales que la aplicacion nos
// alcance para dar clases de cualquier materia, incluyendo ingles, que pudieramos
// llevar los avances con las minutas".
//
// Conduce el pipeline REAL de voz (micro falso -> arbitro -> contrato resuelto
// local) sobre la app viva y comprueba que "¿como voy en ingles?" la responde FLU
// EN LOCAL con el avance derivado de las minutas reales de la tienda Dexie
// `minutes`. No sustituye nada del producto (solo se silencia el TTS y se instala
// el micro falso: arnes del repo).
//
// MIDe el hueco de P8.57: el area se reconocIa por el TEXTO, asi que una clase de
// ingles resumida sin la palabra "ingles"/"english" se perdIa. P8.58 la etiqueta
// en la minuta (`tutoring_area`). Los dos tests fijan: (1) la consulta cuenta las
// minutas ETIQUETADAS en local; (2) la via REAL de guardado etiqueta la minuta.
// ============================================================

import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import {
    gotoClean,
    stubLocalSpeech,
    stubSpeechRecognition,
    autoSkipOnboarding,
    readStore,
    clearStore,
    seedActiveUser,
    startConversation,
    speakUntilHeard,
} from './_helpers';

const SHOTS_DIR = path.join(process.cwd(), 'reports', 'tutoria');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

test.beforeEach(async ({ page }) => {
    await autoSkipOnboarding(page);
});

/** Minuta con la forma REAL de la tienda `minutes` (useMinuteKnowledge la lee por userId). */
function minuteRecord(uid: string, seq: number, code: string, snap: Record<string, unknown>) {
    const now = Date.now();
    return {
        id: `e2e-${code}`,
        profileId: uid,
        userId: uid,
        minuteKey: `k-${code}`,
        historyCode: code,
        description: String(snap.titulo || 'Clase'),
        summarySnapshot: {
            titulo: 'Clase',
            participantes: ['Alumno E2E'],
            resumen: '',
            acuerdos: [],
            pendientes: [],
            siguientes_pasos: [],
            tema_sesion: '',
            kind: 'minuta',
            ...snap,
        },
        sequence: seq,
        createdAt: new Date(now - seq * 86400000).toISOString(),
        updatedAt: new Date(now - seq * 86400000).toISOString(),
        sync: { revision: 1, updated_at: new Date(now).toISOString(), deleted: false },
    };
}

async function seedMinutes(page: any, records: unknown[]) {
    await page.evaluate(
        ({ db, rows }: { db: string; rows: unknown[] }) =>
            new Promise<void>((resolve, reject) => {
                const request = indexedDB.open(db);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const database = request.result;
                    const tx = database.transaction(['minutes'], 'readwrite');
                    const os = tx.objectStore('minutes');
                    for (const row of rows) os.put(row);
                    tx.oncomplete = () => {
                        database.close();
                        resolve();
                    };
                    tx.onerror = () => {
                        database.close();
                        reject(tx.error);
                    };
                };
            }),
        { db: 'flu-os3', rows: records },
    );
}

test.describe('Tutoria — el avance por area sale de las MINUTAS reales (local)', () => {
    test('"¿como voy en ingles?" cuenta la minuta ETIQUETADA y responde en local (sin IA)', async ({ page }) => {
        stubLocalSpeech(page);
        stubSpeechRecognition(page);

        // Cuenta de peticiones al contrato de IA: el avance debe salir EN LOCAL.
        const aiContractCalls: string[] = [];
        await page.route('**/api/gemini/**', (route) => {
            aiContractCalls.push(route.request().url());
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ respuesta_voz: 'IA', contrato: {} }),
            });
        });

        await gotoClean(page);
        await clearStore(page, 'minutes');
        const uid = await seedActiveUser(page, 'Alumno E2E');

        await seedMinutes(page, [
            minuteRecord(uid, 3, '261005-01', {
                titulo: 'Practica de conversacion',
                tema_sesion: 'Practica de conversacion en ingles',
                resumen: 'Repasamos el past simple.',
                pendientes: ['Practicar 10 verbos irregulares'],
            }),
            minuteRecord(uid, 2, '261004-01', {
                titulo: 'Clase de matematicas',
                tema_sesion: 'Clase de matematicas',
                resumen: 'Fracciones equivalentes.',
                pendientes: ['Terminar la tarea'],
            }),
            // Clase de INGLES cuyo texto NO dice "ingles"/"english" pero SI lleva
            // la etiqueta explicita (P8.58): antes se perdia, ahora cuenta.
            minuteRecord(uid, 1, '261003-01', {
                titulo: 'Past simple',
                tema_sesion: 'Past simple',
                resumen: 'We practised irregular verbs and the -ed pronunciation.',
                pendientes: ['Write 5 sentences in the past'],
                tutoring_area: 'Inglés',
                practica: { aciertos: 9, errores: 1 },
            }),
        ]);

        await page.reload({ waitUntil: 'load' });
        await page.waitForSelector('.flu-shell', { timeout: 45000 });
        await startConversation(page);

        await speakUntilHeard(page, 'ok flu como voy en ingles');
        const respuesta = await page
            .waitForFunction(() => {
                const rows = ((window as any).__fluStore?.getState?.().conversationHistory || []).filter(
                    (r: any) => r.role === 'flu',
                );
                return rows.length ? rows[rows.length - 1].text : '';
            }, null, { timeout: 30000 })
            .then((h) => h.jsonValue() as Promise<string>)
            .catch(() => '');

        // eslint-disable-next-line no-console
        console.log('[SIMULACION] respuesta de FLU:', JSON.stringify(respuesta));
        // eslint-disable-next-line no-console
        console.log('[SIMULACION] llamadas al contrato de IA en el turno:', aiContractCalls.length);

        expect(respuesta, 'el area').toContain('Inglés');
        expect(respuesta, 'cuenta la minuta etiquetada (2 sesiones)').toMatch(/2 sesiones/);
        expect(respuesta, 'concordancia con el numero').toContain('2 sesiones registradas');
        expect(respuesta, 'rango de sesiones (primera -> ultima)').toContain('desde el 3 de octubre de 2026');
        expect(respuesta, 'pendiente en curso = el de la ultima sesion').toContain('En curso: Practicar 10 verbos irregulares');
        expect(respuesta, 'lo que ya no figura como pendiente').toContain('Ya no figura como pendiente: Write 5 sentences in the past');
        expect(respuesta, 'nivel por area (bandas aprobadas)').toContain('Nivel: inicial');
        expect(respuesta, 'dominio por destreza (aciertos/errores del tutor)').toContain('Dominio: 9 aciertos y 1 error (90% de acierto)');
        expect(aiContractCalls.length, 'lo resuelve en local, no la IA').toBe(0);
        await page.screenshot({ path: path.join(SHOTS_DIR, 'avance-ingles.png'), animations: 'disabled' });
    });

    test('la via REAL de guardado etiqueta la minuta con su area de tutoria', async ({ page }) => {
        stubLocalSpeech(page);

        // La IA, sustituida en la RED (el motor de texto es OpenAI-compatible): el
        // resto del flujo (handler, borrador, snapshot, addMinute) corre de verdad.
        const MINUTE = {
            titulo: 'Clase de practica',
            participantes: ['Alumno E2E'],
            resumen: 'We practised the past simple and irregular verbs.',
            acuerdos: [],
            pendientes: ['Write 5 sentences'],
            siguientes_pasos: [],
            tema_sesion: 'neutral',
        };
        await page.route('**/chat/completions', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(MINUTE) } }] }) }),
        );
        await page.route('**/api/gemini/**', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MINUTE) }),
        );

        await gotoClean(page);
        await clearStore(page, 'minutes');
        await seedActiveUser(page, 'Alumno E2E');

        await page.evaluate(async () => {
            const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
            const st = (window as any).__fluStore.getState();
            const now = Date.now();
            // La sesion: el usuario PIDIO practicar ingles (de aqui sale el area).
            st.addConversationEntry({ id: 'tut-1', speakerName: 'Alumno E2E', text: 'quiero practicar ingles conversacional', timestamp: now });
            st.addConversationEntry({ id: 'tut-2', speakerName: 'FLU', text: 'Sure, let us practise the past simple.', timestamp: now + 1 });

            const hook = () => (window as any).__fluOnContractResolved;
            await hook()({ contract: { navegacion: { comando: 'GENERAR_RESUMEN' } }, transcript: 'ok flu genera el resumen' });
            await wait(2500);
            await hook()({ contract: { navegacion: { comando: 'GUARDAR_MINUTA' } }, transcript: 'ok flu guarda la minuta' });
            await wait(2500);
        });

        const rows = await readStore(page, 'minutes');
        // eslint-disable-next-line no-console
        console.log('[SIMULACION] minutas persistidas:', rows.length, 'area:', rows[rows.length - 1]?.summarySnapshot?.tutoring_area);
        expect(rows.length, 'debe persistir la minuta').toBeGreaterThan(0);
        const snapshot = rows[rows.length - 1].summarySnapshot || {};
        expect(snapshot.tutoring_area, 'la via real etiqueta el area').toBe('Inglés');
    });
});
