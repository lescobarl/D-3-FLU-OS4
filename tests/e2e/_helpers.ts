// ============================================================
// _helpers.ts — Helpers compartidos de los specs E2E
// ============================================================
// Antes estos helpers estaban duplicados (~150 líneas) en cada
// spec (gotoClean/stubLocalSpeech/readStore/clearStore/capture).
// Fuente única por intención (AGENTS.md): se mantienen aquí
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
 * Carga la app limpia: navega, espera el shell y limpia el localStorage. El
 * onboarding NO se precarga por localStorage (su estado vive SOLO en Dexie):
 * el backdrop se omite con el boton skip dentro del bucle. Devuelve los pageerror.
 */
export async function gotoClean(page: Page, options: GotoCleanOptions = {}): Promise<string[]> {
    const { waitWorkspaceHub = true } = options;
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('.flu-shell', { timeout: 45000 });
    // Limpia el estado volatil. El onboarding ya no se conserva/evita por
    // localStorage: su estado vive en Dexie (tabla onboardingStates).
    await page.evaluate(() => {
        localStorage.clear();
    });
    // El onboarding puede aparecer async (estado per-user en IndexedDB): su
    // backdrop bloquea la interacción, así que se omite dentro del bucle.
    const tablistSelectors = ['nav[role="tablist"]', '[role="tablist"]', '.flu-shell-tabs'];
    const timeout = 45000;
    const start = Date.now();
    let lastError: any;
    while (Date.now() - start < timeout) {
        // Clic IN-PAGE, no con la accion de Playwright: autoSkipOnboarding retira
        // el boton por su cuenta (intervalo cada 150 ms), asi que `skip.click()`
        // puede quedarse esperando la accionabilidad de un boton que ya no existe
        // -> cuelga hasta agotar el timeout del test, y Playwright lo reporta como
        // "Target page, context or browser has been closed" (P8.24). Evaluado en
        // la pagina: si el boton ya no esta, no pasa nada.
        await page
            .evaluate(() => {
                const b = document.querySelector('[data-testid="onboarding-skip"]');
                if (b instanceof HTMLElement) b.click();
            })
            .catch(() => undefined);
        await page.waitForTimeout(300);
        for (const sel of tablistSelectors) {
            const loc = page.locator(sel).first();
            const count = await loc.count().catch(() => 0);
            if (count > 0) {
                try {
                    await loc.waitFor({ state: 'attached', timeout: 3000 });
                    await page.waitForTimeout(200);
                    if (waitWorkspaceHub) {
                        await page.waitForSelector('.workspace-hub', { timeout: 30000 });
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
 * Auto-omite el onboarding mientras esté visible, sin bloquear la UI.
 * Pensado para specs que NO validan el onboarding: su estado per-user (Dexie)
 * puede reabrirlo async y su backdrop intercepta clics.
 *
 * Debe llamarse ANTES de gotoClean para que el init script aplique en esa
 * navegación. Los specs de onboarding NO deben usarlo.
 */
export async function autoSkipOnboarding(page: Page): Promise<void> {
    await page.addInitScript(() => {
        window.setInterval(() => {
            const btn = document.querySelector('[data-testid="onboarding-skip"]');
            if (btn instanceof HTMLElement) btn.click();
        }, 150);
    });
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

/**
 * La agenda UNIFICADA (fluDatabase v21/v22) es la unica tabla de eventos:
 * `reminders`, `horario` y `temporalItems` se declararon null y Dexie las
 * borro. Los specs leen `agenda` filtrando por `kind` en vez de abrir una
 * tabla muerta (devolvia 0 filas y hacia fallar aserciones validas).
 */
export async function readAgenda(page: Page, kind?: string): Promise<any[]> {
    const rows = await readStore(page, 'agenda');
    return kind ? rows.filter((r) => r?.kind === kind) : rows;
}

/** Limpia la agenda unificada. */
export async function clearAgenda(page: Page): Promise<void> {
    await clearStore(page, 'agenda');
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

/**
 * Siembra un usuario ACTIVO por las rutas REALES de la app: escribe el
 * participante en Dexie y lo activa desde el picker del header
 * (handleSelectActiveUser), que es quien marca la sesion como lista.
 *
 * Por que existe: sin usuario activo la app NO lee ni escribe datos
 * per-usuario (notas, agenda, documentos, historial, busqueda) -- es un rechazo
 * deliberado del producto, no un bug. Un spec que valide esos dominios sin
 * sembrar usuario mide ese rechazo y falla por una razon que no es la suya.
 *
 * Debe llamarse DESPUES de gotoClean: la app ya creo el esquema Dexie y el
 * picker existe. Devuelve el id del usuario activado.
 */
export async function seedActiveUser(
    page: Page,
    name = 'Usuario E2E',
    options: { speakerLabel?: string } = {},
): Promise<string> {
  const id = await page.evaluate(
    async ({ db, n, speakerLabel }) => {
      const now = Date.now();
      const uid = (crypto as { randomUUID: () => string }).randomUUID();
      const sync = { revision: 1, updated_at: new Date(now).toISOString(), deleted: false };
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(db);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction(['participants', 'onboardingStates'], 'readwrite');
          tx.objectStore('participants').put({
            id: uid, name: n, role: 'adulto', createdAt: now, updatedAt: now, sync,
            ...(speakerLabel ? { speakerLabel } : {}),
          });
          tx.objectStore('onboardingStates').put({
            id: uid, stepIndex: 99, completed: true, captured: { name: n }, startedAt: now, updatedAt: now,
          });
          tx.oncomplete = () => { database.close(); resolve(); };
          tx.onerror = () => { database.close(); reject(tx.error); };
        };
      });
      return uid;
    },
    { db: DB_NAME, n: name, speakerLabel: options.speakerLabel || '' },
  );
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.flu-shell', { timeout: 45000 });
  const picker = page.locator('[data-testid="user-picker-select"]');
  await picker.waitFor({ state: 'attached', timeout: 30000 });
  await picker.selectOption(id);
  await page.waitForFunction((uid) => localStorage.getItem('flu-active-user') === uid, id, {
    timeout: 15000,
  });
  return id;
}

/**
 * P8.41 - Micro falso: sustituye SpeechRecognition ANTES de cargar la app, de modo
 * que el pipeline REAL (onresult -> onend -> ingress -> dispatch) corre igual que
 * con Chrome y la prueba puede "hablar" de forma determinista. Sin esto, la suite
 * solo podia inyectar contratos ya resueltos y NO miraba el camino de la voz: por
 * eso el duplicado de fila paso verde dos sesiones.
 */
export function stubSpeechRecognition(page: Page) {
    return page.addInitScript(() => {
        class FakeRecognition {
            lang = '';
            interimResults = true;
            continuous = true;
            maxAlternatives = 1;
            onstart: any = null;
            onresult: any = null;
            onerror: any = null;
            onend: any = null;
            onspeechstart: any = null;
            onaudiostart: any = null;
            onspeechend: any = null;
            onaudioend: any = null;
            constructor() {
                (window as any).__fluFakeMic = this;
            }
            start() {
                setTimeout(() => {
                    if (typeof this.onstart === 'function') this.onstart();
                }, 0);
            }
            stop() {
                setTimeout(() => {
                    if (typeof this.onend === 'function') this.onend();
                }, 0);
            }
            abort() {
                this.stop();
            }
            emit(transcript: string, isFinal: boolean) {
                const results = [{ isFinal: Boolean(isFinal), length: 1, 0: { transcript, confidence: 0.93 } }];
                if (typeof this.onresult === 'function') {
                    this.onresult({ resultIndex: 0, results, type: 'result' });
                }
            }
            endTurn() {
                if (typeof this.onend === 'function') this.onend();
            }
        }
        (window as any).SpeechRecognition = FakeRecognition;
        (window as any).webkitSpeechRecognition = FakeRecognition;
    });
}

/** "Habla" por el micro falso (una entrega de Chrome: interino o final). */
export async function speakViaMic(
    page: Page,
    text: string,
    { final = true, endTurn = false }: { final?: boolean; endTurn?: boolean } = {},
): Promise<void> {
    await page.evaluate(
        ({ t, f, e }) => {
            const mic = (window as any).__fluFakeMic;
            if (!mic) throw new Error('stubSpeechRecognition no instalado');
            mic.emit(t, f);
            if (e) setTimeout(() => mic.endTurn(), 250);
        },
        { t: text, f: final, e: endTurn },
    );
}

/** Arranca la conversacion (boton de saludo) como en la app real. */
export async function startConversation(page: Page): Promise<void> {
    await page.waitForSelector('.flu-shell', { timeout: 45000 });
    const clicked = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('button,[role="button"]'));
        const btn = nodes.find((node) => /iniciar/i.test(String(node.getAttribute('aria-label') || node.textContent || '')));
        if (!btn) return false;
        (btn as HTMLElement).click();
        return true;
    });
    if (!clicked) throw new Error('startConversation: no se encontro el boton de iniciar');
    // El micro (falso) existe cuando la app creo el reconocimiento: la escucha esta viva.
    await page.waitForFunction(() => Boolean((window as any).__fluFakeMic), null, { timeout: 30000 });
}

/** Filas del historial de conversacion (usuario y FLU) con su hablante. */
export async function readHistoryRows(
    page: Page,
): Promise<Array<{ role: string; speaker: string; text: string }>> {
    return page.evaluate(() => {
        const state = (window as any).__fluStore?.getState?.() || {};
        const rows = state.conversationHistory || [];
        return rows.map((row: any) => ({
            role: String(row.role || ''),
            speaker: String(row.speakerName || row.speaker || ''),
            text: String(row.text || ''),
        }));
    });
}

/** Filas de usuario visibles en el historial (store de la app). */
export async function countUserRows(page: Page): Promise<number> {
    return page.evaluate(
        () =>
            ((window as any).__fluStore?.getState?.().conversationHistory || []).filter(
                (row: any) => row.role === 'user',
            ).length,
    );
}

/**
 * "Habla" hasta que el historial alcance el numero de filas de usuario esperado.
 * La app ignora lo que oye mientras habla (supresion de eco) o mientras arranca, asi
 * que un unico emit puede perderse: se reintenta con la MISMA locucion, que el modelo
 * de id por locucion trata como la misma (no abre fila nova).
 */
export async function speakUntilHeard(
    page: Page,
    text: string,
    { expectedUserRows = 1, timeoutMs = 60000 }: { expectedUserRows?: number; timeoutMs?: number } = {},
): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    let intentos = 0;
    while (Date.now() < deadline) {
        intentos += 1;
        // `endTurn: true` = la locucion TERMINA (Chrome cierra la sesion). Es el
        // CIERRE REAL del turno: la fila de conversacion se escribe al cierre
        // (silencio/onend), no en cada `final` de SEGMENTO de Chrome.
        await speakViaMic(page, text, { endTurn: true });
        const oida = await page
            .waitForFunction(
                (n) =>
                    ((window as any).__fluStore?.getState?.().conversationHistory || []).filter(
                        (row: any) => row.role === 'user',
                    ).length >= n,
                expectedUserRows,
                { timeout: 10000 },
            )
            .then(() => true)
            .catch(() => false);
        if (oida) return intentos;
        await page.waitForTimeout(500);
    }
    throw new Error('speakUntilHeard: la locucion no fue oida tras ' + intentos + ' intentos');
}
