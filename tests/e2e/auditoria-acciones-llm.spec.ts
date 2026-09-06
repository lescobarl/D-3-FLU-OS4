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

const SHOTS_DIR = path.join(process.cwd(), 'reports', 'auditoria-acciones-llm');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const BASE_URL = '/';
const DB_NAME = 'flu-os3';

// ============================================================
// Helpers (patrón idéntico a auditoria-despacho-real)
// ============================================================

async function gotoClean(page: Page): Promise<string[]> {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.addInitScript(() => {
        localStorage.setItem('flu-onboarding-completed', 'true');
        localStorage.setItem('flu-onboarding-step', JSON.stringify({ stepIndex: 0, captured: {} }));
    });
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('.flu-shell', { timeout: 15000 });
    await page.evaluate(() => localStorage.clear());
    const tablistSelectors = ['nav[role="tablist"]', '[role="tablist"]', '.flu-shell-tabs'];
    const timeout = 15000;
    const start = Date.now();
    let lastError: any;
    while (Date.now() - start < timeout) {
        for (const sel of tablistSelectors) {
            const loc = page.locator(sel).first();
            const count = await loc.count().catch(() => 0);
            if (count > 0) {
                try {
                    await loc.waitFor({ state: 'attached', timeout: 3000 });
                    await page.waitForTimeout(200);
                    await page.waitForSelector('.workspace-hub', { timeout: 10000 });
                    return errors;
                } catch (e) {
                    lastError = e;
                }
            }
        }
        await page.waitForTimeout(200);
    }
    throw lastError || new Error(`gotoClean: timeout waiting for tablist after ${timeout}ms`);
}

/** Silencia speechSynthesis y dispara onend (evita cuelgues de speakResponse). */
function stubLocalSpeech(page: Page) {
    return page.addInitScript(() => {
        const noop = () => {};
        const listeners = new Map<string, Set<Function>>();
        const synth = {
            speaking: false,
            pending: false,
            speak(utterance: any) {
                this.speaking = true;
                setTimeout(() => {
                    this.speaking = false;
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
            addEventListener(type: string, cb: Function) {
                if (!listeners.has(type)) listeners.set(type, new Set());
                listeners.get(type)!.add(cb);
            },
            removeEventListener(type: string, cb: Function) {
                listeners.get(type)?.delete(cb);
            },
        };
        Object.defineProperty(window, 'speechSynthesis', {
            value: synth,
            configurable: true,
        });
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
}

/**
 * Conduce un contrato REAL con `acciones` (como lo emitiría el LLM
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

/**
 * Lee TODOS los registros de un store de IndexedDB real ('flu-os3').
 */
async function readStore(page: Page, storeName: string): Promise<any[]> {
    return page.evaluate(
        ({ dbName, store }) => {
            return new Promise<any[]>((resolve, reject) => {
                const request = indexedDB.open(dbName);
                request.onupgradeneeded = (event: any) => {
                    const db = event.target.result as IDBDatabase;
                    if (!db.objectStoreNames.contains(store)) {
                        db.createObjectStore(store, { keyPath: 'id' });
                    }
                };
                request.onsuccess = (event: any) => {
                    const db = event.target.result as IDBDatabase;
                    if (!db.objectStoreNames.contains(store)) {
                        db.close();
                        resolve([]);
                        return;
                    }
                    const tx = db.transaction(store, 'readonly');
                    const os = tx.objectStore(store);
                    const req = os.getAll();
                    req.onsuccess = () => {
                        db.close();
                        resolve(req.result || []);
                    };
                    req.onerror = () => {
                        db.close();
                        reject(req.error);
                    };
                };
                request.onerror = () => reject(request.error);
            });
        },
        { dbName: DB_NAME, store: storeName },
    );
}

/** Limpia un store de IndexedDB real para que cada auditoría parta de cero. */
async function clearStore(page: Page, storeName: string): Promise<void> {
    await page.evaluate(
        ({ dbName, store }) => {
            return new Promise<void>((resolve, reject) => {
                const request = indexedDB.open(dbName);
                request.onsuccess = (event: any) => {
                    const db = event.target.result as IDBDatabase;
                    if (!db.objectStoreNames.contains(store)) {
                        db.close();
                        resolve();
                        return;
                    }
                    const tx = db.transaction(store, 'readwrite');
                    const os = tx.objectStore(store);
                    os.clear();
                    tx.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    tx.onerror = () => {
                        db.close();
                        reject(tx.error);
                    };
                };
                request.onerror = () => reject(request.error);
            });
        },
        { dbName: DB_NAME, store: storeName },
    );
}

async function capture(page: Page, name: string): Promise<string> {
    await page.waitForTimeout(400);
    const file = path.join(SHOTS_DIR, name);
    await page.screenshot({ path: file, animations: 'disabled' });
    return file;
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
        await capture(page, '1-reminder.png');
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
        await capture(page, '2-shopping.png');
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
        await capture(page, '3-alarm.png');
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
        await capture(page, '4-timer.png');
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
        await capture(page, '5-diary.png');
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
        await capture(page, '6-note.png');
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
        await capture(page, '7-horario.png');
    });
});
