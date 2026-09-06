// ============================================================
// _helpers.ts — Helpers compartidos de los specs E2E
// ============================================================
// Antes estos helpers estaban duplicados (~150 líneas) en cada
// spec (gotoClean/stubLocalSpeech/readStore/clearStore/capture).
// Fuente única por intención (CLAUDE.md §10.4): se mantienen aquí
// y cada spec los importa. La variante por spec que SÍ es distinta
// (espera de workspace-hub, nombre de carpeta de capturas) se
// expresa con parámetros, no con copias.
// ============================================================

import type { Page } from '@playwright/test';
import * as path from 'path';

export const BASE_URL = '/';
export const DB_NAME = 'flu-os3';

export interface GotoCleanOptions {
    /** Esperar además el pizarrón (.workspace-hub) tras el tablist. */
    waitWorkspaceHub?: boolean;
}

/**
 * Carga la app limpia: precarga el onboarding completado (para que el
 * portal no bloquee), navega, espera el shell y luego limpia el
 * localStorage ya montado. Devuelve los pageerror capturados.
 */
export async function gotoClean(page: Page, options: GotoCleanOptions = {}): Promise<string[]> {
    const { waitWorkspaceHub = true } = options;
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
                    if (waitWorkspaceHub) {
                        await page.waitForSelector('.workspace-hub', { timeout: 10000 });
                    }
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

/**
 * Silencia speechSynthesis y dispara onend en cada utterance para que
 * speakResponse() resuelva (evita cuelgues de los flujos con voz).
 */
export function stubLocalSpeech(page: Page) {
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

/** Lee TODOS los registros de un store de IndexedDB real (por defecto 'flu-os3'). */
export async function readStore(page: Page, storeName: string, dbName: string = DB_NAME): Promise<any[]> {
    return page.evaluate(
        ({ db, store }) => {
            return new Promise<any[]>((resolve, reject) => {
                const request = indexedDB.open(db);
                request.onupgradeneeded = (event: any) => {
                    const database = event.target.result as IDBDatabase;
                    if (!database.objectStoreNames.contains(store)) {
                        database.createObjectStore(store, { keyPath: 'id' });
                    }
                };
                request.onsuccess = (event: any) => {
                    const database = event.target.result as IDBDatabase;
                    if (!database.objectStoreNames.contains(store)) {
                        database.close();
                        resolve([]);
                        return;
                    }
                    const tx = database.transaction(store, 'readonly');
                    const os = tx.objectStore(store);
                    const req = os.getAll();
                    req.onsuccess = () => {
                        database.close();
                        resolve(req.result || []);
                    };
                    req.onerror = () => {
                        database.close();
                        reject(req.error);
                    };
                };
                request.onerror = () => reject(request.error);
            });
        },
        { db: dbName, store: storeName },
    );
}

/** Vacía un store de IndexedDB real para que cada auditoría parta de cero. */
export async function clearStore(page: Page, storeName: string, dbName: string = DB_NAME): Promise<void> {
    await page.evaluate(
        ({ db, store }) => {
            return new Promise<void>((resolve, reject) => {
                const request = indexedDB.open(db);
                request.onsuccess = (event: any) => {
                    const database = event.target.result as IDBDatabase;
                    if (!database.objectStoreNames.contains(store)) {
                        database.close();
                        resolve();
                        return;
                    }
                    const tx = database.transaction(store, 'readwrite');
                    const os = tx.objectStore(store);
                    os.clear();
                    tx.oncomplete = () => {
                        database.close();
                        resolve();
                    };
                    tx.onerror = () => {
                        database.close();
                        reject(tx.error);
                    };
                };
                request.onerror = () => reject(request.error);
            });
        },
        { db: dbName, store: storeName },
    );
}

/** Captura una prueba visual tras una breve espera de reconciliación. */
export async function captureScreenshot(
    page: Page,
    dir: string,
    name: string,
    settleMs = 400,
): Promise<string> {
    await page.waitForTimeout(settleMs);
    const file = path.join(dir, name);
    await page.screenshot({ path: file, animations: 'disabled' });
    return file;
}
