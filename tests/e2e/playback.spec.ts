// ============================================================
// FLU Playback - spec de soporte
// ------------------------------------------------------------
// Reproduce el WAV por un cable de audio virtual. La app lo escucha por su
// micrófono predeterminado y ejecuta su camino normal: Chrome SpeechRecognition
// real, VAD, tramos y reglas de conversación. No se sustituye el ASR, no se
// inyecta PCM, no se cancela el TTS y no se siembran filas.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { normalizeForMatch } from '../../src/lib/textUtils.ts';
import { loadSession } from '../../scripts/playback/session.mjs';
import { autoSkipOnboarding, gotoClean, seedActiveUser, stubLocalSpeech } from './_helpers';
import { installPlaybackPlayer } from './playbackHelpers';

const SESSION_PATH = process.env.FLU_PLAYBACK_SESSION || '';
const WAV_FILE = process.env.FLU_PLAYBACK_WAV_FILE || '';
const TAIL_MS = Number(process.env.FLU_PLAYBACK_TAIL_MS || 5000);
const TIMEOUT_MS = Number(process.env.FLU_PLAYBACK_TIMEOUT_MS || 600000);
const REPORT_ROWS = process.env.FLU_PLAYBACK_REPORT_ROWS === '1';
const SETTLE_MS = Number(process.env.FLU_PLAYBACK_SETTLE_MS || 3000);
const SETTLE_MAX_MS = Number(process.env.FLU_PLAYBACK_SETTLE_MAX_MS || 60000);
const OUTPUT_DEVICE = process.env.FLU_PLAYBACK_OUTPUT_DEVICE || '';
const INPUT_DEVICE = process.env.FLU_PLAYBACK_INPUT_DEVICE || '';
const CHROME_CHANNEL = (process.env.FLU_PLAYBACK_CHANNEL || 'chrome') as 'chrome';
const WAV_URL = 'https://playback.local/session.wav';
// Micrófono falso: Chrome lee el WAV directo (sin cable). Evita el doble
// procesado captura->WAV->cable->captura, que hacía perder tramos al ASR.
const FAKE_AUDIO = process.env.FLU_PLAYBACK_FAKE_AUDIO === '1';
const WAV_SECONDS = Number(process.env.FLU_PLAYBACK_WAV_SECONDS || 0);

/**
 * Instrumenta el ciclo de vida del SpeechRecognition REAL (no lo sustituye):
 * cuenta start/onstart/onresult/onerror/onend. Sirve para distinguir "Chrome no
 * arrancó el SR" (sin gesto de usuario) de "el SR arrancó y quedó mudo".
 */
function stubSrLifecycle() {
    return () => {
        const w = window as any;
        w.__srLifecycle = {
            start: 0,
            onstart: 0,
            onresult: 0,
            onerror: 0,
            onend: 0,
            stop: 0,
            abort: 0,
            startThrow: [],
            trace: [],
        };
        const stack = () =>
            String(new Error().stack || '')
                .split('\n')
                .slice(1, 5)
                .map((line) => line.trim().replace(/^at\s+/, ''))
                .join(' <- ');
        const note = (op: string) => {
            if (w.__srLifecycle.trace.length < 12) {
                w.__srLifecycle.trace.push(`${op} @${Date.now() % 100000}: ${stack()}`);
            }
        };
        const C = w.SpeechRecognition || w.webkitSpeechRecognition;
        if (!C) return;
        const origStart = C.prototype.start;
        C.prototype.start = function (...args: any[]) {
            w.__srLifecycle.start += 1;
            note('start');
            try {
                return origStart.apply(this, args);
            } catch (error: any) {
                if (w.__srLifecycle.startThrow.length < 3) {
                    w.__srLifecycle.startThrow.push(String(error?.message || error));
                }
                throw error;
            }
        };
        for (const method of ['stop', 'abort']) {
            const orig = C.prototype[method];
            if (typeof orig !== 'function') continue;
            C.prototype[method] = function (...args: any[]) {
                w.__srLifecycle[method] += 1;
                note(method);
                return orig.apply(this, args);
            };
        }
        // Los eventos NO se instrumentan redefiniendo `onstart`/`onresult`: eso
        // reemplaza el IDL nativo y Chrome deja de invocar el handler (medido:
        // onstart=0 con 189 start()). Se cuentan con addEventListener en cada
        // instancia construida, sin tocar los handlers de la app.
        class Instrumented extends C {
            constructor() {
                super();
                for (const [type, key] of [
                    ['start', 'onstart'],
                    ['result', 'onresult'],
                    ['error', 'onerror'],
                    ['end', 'onend'],
                ]) {
                    this.addEventListener(type, () => {
                        w.__srLifecycle[key] += 1;
                    });
                }
            }
        }
        Object.defineProperty(w, 'SpeechRecognition', { value: Instrumented, configurable: true });
        Object.defineProperty(w, 'webkitSpeechRecognition', { value: Instrumented, configurable: true });
    };
}

test.skip(!SESSION_PATH || !WAV_FILE, 'FLU Playback se ejecuta con npm run playback');
test.setTimeout(TIMEOUT_MS);
test.use({
    channel: CHROME_CHANNEL,
    headless: process.env.FLU_PLAYBACK_HEADED !== '1',
    permissions: ['microphone'],
    // Sin esto, Chrome marca la ventana del playback como ocluida/oculta (esta
    // detras del portal real) y SpeechRecognition no llega a emitir `onstart`:
    // `start` se llama 806 veces y el motor nunca se abre (medido 2026-11-16).
    launchOptions: {
        args: [
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling',
            '--disable-features=CalculateNativeWinOcclusion',
            ...(FAKE_AUDIO
                ? [
                      '--use-fake-ui-for-media-stream',
                      '--use-fake-device-for-media-stream',
                      `--use-file-for-fake-audio-capture=${WAV_FILE}`,
                      '--autoplay-policy=no-user-gesture-required',
                  ]
                : []),
        ],
    },
});

const session: any = SESSION_PATH ? loadSession(SESSION_PATH) : null;
const recordedLanguage = String(
    session?.manifest?.language || session?.meta?.language || '',
).toLowerCase();
const uiLanguage = recordedLanguage.startsWith('en')
    ? 'en'
    : recordedLanguage.startsWith('es')
      ? 'es'
      : '';

test(`FLU Playback (${SESSION_PATH ? session.sessionId : 'sin sesión'})`, async ({ page }) => {
    if (!session) throw new Error('Falta FLU_PLAYBACK_SESSION');
    const runStartedAt = Date.now();

    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await autoSkipOnboarding(page);
    // El TTS de FLU (alarma/recordatorio) suspende el micrófono hasta `onend`.
    // En Chrome automatizado el `onend` no llega y la escucha no se reanuda. El
    // helper del resto de la suite emula el fin sin cambiar las reglas de la
    // app: la app sigue ejecutando su TTS. (El tope `total=1440128` de `MicPcm`
    // NO es un micrófono muerto: es `passiveBufferMs`=30 s del buffer PCM.)
    await stubLocalSpeech(page);
    // Diagnóstico del ciclo de vida del SR real (solo observa; no lo sustituye).
    await page.addInitScript(stubSrLifecycle());
    if (!FAKE_AUDIO) {
        await page.route(WAV_URL, (route) =>
            route.fulfill({
                path: WAV_FILE,
                contentType: 'audio/wav',
                headers: { 'Access-Control-Allow-Origin': '*' },
            }),
        );
        await page.addInitScript(installPlaybackPlayer(), {
            url: WAV_URL,
            outputQuery: OUTPUT_DEVICE,
            inputQuery: INPUT_DEVICE,
        });
    }

    await gotoClean(page);
    await page.bringToFront();
    // PRE-FLIGHT (medido 2026-11-10): el routing se comprobaba DESPUÉS de arrancar la app y
    // esperar LISTENING (hasta 180 s) para acabar diciendo que el micrófono no es el cable.
    // Se prepara ANTES: si VoiceMeeter no está enrutado, falla en segundos con el motivo
    // exacto (qué dispositivo ve y cuál espera) en vez de dejar al dueño esperando.
    if (!FAKE_AUDIO) {
        await page.evaluate(async () => {
            await (window as any).__fluPlayback?.prepare?.();
        });
    }
    if (uiLanguage) {
        await page.evaluate((lang) => localStorage.setItem('flu-language', lang), uiLanguage);
    }
    // ARRANQUE SIN ONBOARDING: usuario activo sembrado (participants +
    // onboardingStates completado + flu-active-user). Los participantes grabados
    // (anclas) no son necesarios para validar la transcripción y su ruta abre
    // picker/onboarding.
    await seedActiveUser(page, 'Usuario Playback');
    await page.waitForSelector('.flu-shell', { timeout: 45000 });

    // El TTS de una alarma/recordatorio suspende el micrófono hasta `onend`.
    // En el playback esa alarma estorba: se borra lógicamente de `agenda`
    // (deleted + canceled + sync) y se recarga para que la app no la dispare.
    await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('flu-os3');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        const tx = db.transaction('agenda', 'readwrite');
        const store = tx.objectStore('agenda');
        const rows = await new Promise<any[]>((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        const now = Date.now();
        for (const row of rows) {
            store.put({
                ...row,
                status: 'canceled',
                deleted: true,
                updatedAt: now,
                sync: {
                    ...(row.sync || {}),
                    revision: Number(row.sync?.revision || 0) + 1,
                    updated_at: new Date(now).toISOString(),
                    deleted: true,
                },
            });
        }
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.flu-shell', { timeout: 45000 });
    await page.bringToFront();

    const focus = await page.evaluate(() => ({
        visibility: document.visibilityState,
        focus: document.hasFocus(),
        activation: Boolean((navigator as any).userActivation?.hasBeenActive),
    }));
    console.log('[playback focus]', JSON.stringify(focus));

    // GESTO REAL: `HTMLElement.click()` dentro de evaluate no crea activación de
    // usuario y Chrome no arranca SpeechRecognition (cero onstart -> el motor no
    // se abre -> cero locuciones). Playwright.click sí produce el gesto.
    const iniciar = page.getByRole('button', { name: /iniciar/i }).first();
    await iniciar.click({ timeout: 30000 });

    await page.waitForFunction(
        () => (window as any).__fluStore?.getState?.().conversationState === 'LISTENING',
        null,
        { timeout: 180000 },
    );

    // El motor conversacional solo se abre con `onstart` del SR. Si Chrome no lo
    // emite, se falla en 60 s con el motivo, no tras consumir los minutos del audio.
    const esperarSr = async () => {
        try {
            await page.waitForFunction(
                () => {
                    const sr = (window as any).__srLifecycle;
                    return Number(sr?.onstart || 0) > 0 || Number(sr?.onresult || 0) > 0;
                },
                null,
                { timeout: 60000 },
            );
        } catch {
            const motivo = await page.evaluate(() => ({
                srLifecycle: (window as any).__srLifecycle || null,
                visibility: document.visibilityState,
                focus: document.hasFocus(),
                activation: Boolean((navigator as any).userActivation?.hasBeenActive),
            }));
            throw new Error(
                `SpeechRecognition no arrancó en 60 s (el motor no se abre). ` +
                    `Diagnóstico: ${JSON.stringify(motivo)}. Console: ${JSON.stringify(consoleErrors.slice(-5))}`,
            );
        }
    };

    if (FAKE_AUDIO) {
        // El micrófono falso de Chrome ya entrega el WAV desde el arranque.
        await esperarSr();
        await page.waitForTimeout(Math.max(0, WAV_SECONDS * 1000) + TAIL_MS);
    } else {
        // La app puede recargar la página al sembrar participantes/idioma; el
        // prepare es idempotente y debe repetirse sobre la página FINAL antes de
        // reproducir. Sin esto, `start` ve `state.ready=false` de la página nueva.
        await page.evaluate(async () => {
            await (window as any).__fluPlayback?.prepare?.();
        });
        // La app ya está escuchando por el cable. Se reproduce el WAV por la salida
        // del cable: Chrome SpeechRecognition lo oye como si fuera el usuario.
        await page.evaluate(async () => {
            await (window as any).__fluPlayback?.start?.();
        });
        await esperarSr();
        await page.waitForFunction(
            () => {
                const status = (window as any).__fluPlayback?.status?.();
                if (!status) return false;
                if (status.ended === true) return true;
                return Number(status.duration) > 0 && Number(status.position) >= Number(status.duration) - 0.25;
            },
            null,
            { timeout: TIMEOUT_MS - 60000 },
        );
        await page.waitForTimeout(TAIL_MS);
    }

    await page.evaluate(
        async ({ quietMs, maxMs }) => {
            const w = window as any;
            await w.__fluWhenRecognitionIdle?.();
            let last = '';
            let stableSince = Date.now();
            const started = Date.now();
            while (Date.now() - started < maxMs) {
                const snapshot = JSON.stringify(w.__fluStore?.getState?.().conversationHistory || []);
                if (snapshot !== last) {
                    last = snapshot;
                    stableSince = Date.now();
                } else if (Date.now() - stableSince >= quietMs) {
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
        },
        { quietMs: SETTLE_MS, maxMs: SETTLE_MAX_MS },
    );
    await page.evaluate(() => (window as any).__fluPlayback?.stop?.());

    const diag = await page.evaluate(() => {
        const state = (window as any).__fluStore?.getState?.() || {};
        const rows = Array.isArray(state.conversationHistory) ? state.conversationHistory : [];
        return {
            conversationState: state.conversationState,
            srLifecycle: (window as any).__srLifecycle || null,
            playback: (window as any).__fluPlayback?.status?.() || null,
            rows: rows.map((row: any) => ({
                role: row.role,
                speaker: row.speakerName || row.speaker || '',
                text: String(row.text || ''),
                sessionId: String(row.sessionId || ''),
                id: String(row.id || ''),
                timestamp: Number(row.timestamp) || 0,
                tramo: row.meta?.tramo || null,
                sampleRate: Number(row.meta?.sampleRate) || 48000,
            })),
        };
    });
    console.log('[playback diag]', JSON.stringify(diag));

    // El spec NO puede pasar en verde sin haber escuchado: si el WAV se
    // reprodujo pero la app no escribió ni una fila del usuario, el escenario
    // no se validó y el fallo debe ser visible con su diagnóstico.
    const transcribed = diag.rows.filter(
        (row: { role: string; text: string }) => row.role === 'user' && row.text.trim(),
    );
    expect(
        transcribed.length,
        `El WAV se reprodujo pero la app no transcribió nada. Diagnóstico: ${JSON.stringify(diag)}`,
    ).toBeGreaterThan(0);

    // BARRERA MEDIDA sobre la corrida REAL: el log del dueño trae el tramo de
    // cada locución; el store trae el texto de la fila.
    const logPath = path.join(process.cwd(), 'debug.log');
    expect(fs.existsSync(logPath), `sin log: ${logPath}`).toBe(true);
    expect(
        fs.statSync(logPath).mtimeMs,
        'el log no se escribió durante la corrida',
    ).toBeGreaterThanOrEqual(runStartedAt - 60_000);
    const cierres = new Map<string, { inicio: number; fin: number; sampleRate: number }>();
    let lastSession = '';
    for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
        const marca = line.indexOf('conversacion.locucion.cerrada :: ');
        if (marca < 0) continue;
        try {
            const data = JSON.parse(
                line.slice(marca + 'conversacion.locucion.cerrada :: '.length),
            );
            if (!data?.tramo || !data?.locutionId) continue;
            cierres.set(String(data.locutionId), {
                inicio: Number(data.tramo.inicio),
                fin: Number(data.tramo.fin),
                sampleRate: Number(data.tramo.sampleRate) || 48000,
            });
            if (data.sessionId) lastSession = String(data.sessionId);
        } catch {
            // Línea partida por el relay: no es una fila medible.
        }
    }
    const runRows = transcribed
        .filter((row: any) => row.sessionId === lastSession && cierres.has(row.id))
        .map((row: any) => ({ ...row, span: cierres.get(row.id)! }))
        .sort((a: any, b: any) => a.span.inicio - b.span.inicio);
    expect(
        runRows.length,
        `la corrida no escribió filas (sesión ${lastSession})`,
    ).toBeGreaterThan(0);

    const ventanas = new Set<string>();
    for (const row of runRows) {
        const span =
            (Number(row.span.fin) - Number(row.span.inicio)) / Number(row.span.sampleRate || 48000);
        const clave = `${row.span.inicio}-${row.span.fin}`;
        expect(ventanas.has(clave), `misma ventana de audio en dos filas: ${clave}`).toBe(false);
        ventanas.add(clave);
        if (span >= 5) {
            expect(
                String(row.text).length / span,
                `fila rancia: ${String(row.text).length} chars en ${span.toFixed(1)} s`,
            ).toBeGreaterThanOrEqual(2);
        }
    }
    for (let i = 0; i < runRows.length; i += 1) {
        for (let j = i + 1; j < runRows.length; j += 1) {
            const antes = normalizeForMatch(String(runRows[i].text));
            const despues = normalizeForMatch(String(runRows[j].text));
            if (antes.length >= 20 && despues.startsWith(antes)) {
                expect(
                    false,
                    `fila ${j + 1} repite la frase de la fila ${i + 1}: "${despues.slice(0, 80)}"`,
                ).toBe(true);
            }
        }
    }

    if (REPORT_ROWS) {
        console.log('[playback rows]', JSON.stringify(diag.rows));
    }

    expect(errors, `pageerrors: ${errors.join(' | ')}`).toEqual([]);
});
