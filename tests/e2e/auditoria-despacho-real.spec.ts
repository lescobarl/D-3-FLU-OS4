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

const SHOTS_DIR = path.join(process.cwd(), 'reports', 'auditoria-despacho-real');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const BASE_URL = '/';
const DB_NAME = 'flu-os3';

// ============================================================
// Helpers (patrón idéntico a pizarron-funcionalidades)
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

/**
 * Lee TODOS los registros de un store de IndexedDB real ('flu-os3').
 * Devuelve el array de registros persistidos.
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
// AUDITORÍA REAL
// ============================================================
test.describe('🔍 AUDITORÍA REAL del despacho determinista (Point F)', () => {
    test.describe.configure({ mode: 'serial' });

    test('1. Recordatorio: "recuérdame comprar leche" persiste en IndexedDB (reminders)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearStore(page, 'reminders');

        const reply = await driveTranscript(page, 'recuérdame comprar leche');

        const records = await readStore(page, 'reminders');
        expect(records.length, 'debe existir 1 recordatorio persistido').toBeGreaterThan(0);
        const rec = records[records.length - 1];
        expect(rec.text).toContain('comprar leche');
        expect(rec.status).toBe('pending');
        expect(typeof rec.dueAt).toBe('number');
        expect(rec.dueAt).toBeGreaterThan(Date.now() - 1000);
        expect(reply).toContain('Recordatorio creado');
        await capture(page, '1-recordatorio.png');
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
        await capture(page, '2-compras.png');
    });

    test('3. Alarma: "pon una alarma a las 7 de la mañana" persiste (temporalItems kind=alarm)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearStore(page, 'temporalItems');

        const reply = await driveTranscript(page, 'pon una alarma a las 7 de la mañana');

        const records = await readStore(page, 'temporalItems');
        expect(records.length).toBeGreaterThan(0);
        const item = records[records.length - 1];
        expect(item.kind).toBe('alarm');
        expect(item.status).toBe('pending');
        expect(item.trigger?.timeOfDay).toBe('07:00');
        expect(typeof item.nextAt).toBe('number');
        expect(reply).toBeTruthy();
        await capture(page, '3-alarma.png');
    });

    test('4. Temporizador: "pon un temporizador de 5 minutos" persiste (temporalItems kind=timer)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearStore(page, 'temporalItems');

        const reply = await driveTranscript(page, 'pon un temporizador de 5 minutos');

        const records = await readStore(page, 'temporalItems');
        expect(records.length).toBeGreaterThan(0);
        const item = records[records.length - 1];
        expect(item.kind).toBe('timer');
        expect(item.status).toBe('pending');
        expect(item.trigger?.durationMs).toBe(5 * 60 * 1000);
        expect(reply).toBeTruthy();
        await capture(page, '4-temporizador.png');
    });

    test('5. Diario: "escribe en el diario hoy fue un gran día" persiste (diaryEntries)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearStore(page, 'diaryEntries');

        const reply = await driveTranscript(page, 'escribe en el diario hoy fue un gran día');

        const records = await readStore(page, 'diaryEntries');
        expect(records.length).toBeGreaterThan(0);
        const entry = records[records.length - 1];
        expect(entry.content).toContain('hoy fue un gran día');
        expect(entry.date).toBeTruthy();
        await capture(page, '5-diario.png');
    });

    test('6. Nota: "apunta comprar pan" persiste (notes)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearStore(page, 'notes');

        const reply = await driveTranscript(page, 'apunta comprar pan');

        const records = await readStore(page, 'notes');
        expect(records.length).toBeGreaterThan(0);
        const note = records[records.length - 1];
        expect(note.label).toContain('comprar pan');
        await capture(page, '6-nota.png');
    });

    test('7. Horario: "agrega matemáticas el lunes a las 8 al horario" persiste (horario)', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearStore(page, 'horario');

        const reply = await driveTranscript(page, 'agrega matemáticas el lunes a las 8 al horario');

        const records = await readStore(page, 'horario');
        expect(records.length).toBeGreaterThan(0);
        const entry = records[records.length - 1];
        expect(entry.materia.toLowerCase()).toContain('matemáticas');
        expect(entry.dia).toBe(1); // lunes
        expect(entry.inicio).toBe('08:00');
        expect(reply).toContain('agregué');
        await capture(page, '7-horario.png');
    });
});
