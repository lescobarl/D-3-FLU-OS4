// ============================================================
// FLU Playback - helpers de navegador
// ------------------------------------------------------------
// Micrófono virtual, SR mudo y observación de la caja. No toca producto:
// solo sustituye la FUENTE del audio y lee el store dev de la app.
// ============================================================
import type { Page } from '@playwright/test';

/**
 * Instala un `getUserMedia` que devuelve un MediaStream construido desde un WAV.
 * El audio NO arranca hasta que la página llama `__fluPlayback.start()`, para
 * que el primer segundo no se pierda antes de LISTENING.
 *
 * La URL se pasa como argumento de `page.addInitScript` para que Playwright la
 * serialice en la página (el closure no viaja).
 */
export function stubWavMicrophone() {
    return (url: string) => {
        const w = window as any;
        let streamPromise: Promise<MediaStream> | null = null;
        let source: AudioBufferSourceNode | null = null;
        let context: AudioContext | null = null;

        w.__fluPlayback = {
            ready: false,
            started: false,
            ended: false,
            duration: 0,
            startedAt: 0,
            elapsed: 0,
            error: '',
            start: async () => {},
            stop: () => {},
            status: () => ({
                ready: w.__fluPlayback.ready,
                started: w.__fluPlayback.started,
                ended: w.__fluPlayback.ended,
                duration: w.__fluPlayback.duration,
                elapsed: w.__fluPlayback.elapsed,
                // Posición REAL del WAV en el reloj de audio: si el AudioContext
                // se estrangula, el guion debe seguir al audio, no al reloj de
                // pared (medido 2026-10-31: 0,5x => finales adelantados).
                position: typeof w.__fluPlayback.audioPosition === 'function'
                    ? w.__fluPlayback.audioPosition()
                    : 0,
                error: w.__fluPlayback.error,
                fetchInfo: w.__fluPlayback.fetchInfo || null,
            }),
        };

        const build = async () => {
            const Ctx = w.AudioContext || w.webkitAudioContext;
            if (!Ctx) throw new Error('AudioContext no disponible');
            const ctx = new Ctx();
            context = ctx;
            await ctx.resume().catch(() => undefined);
            const response = await fetch(url);
            if (!response.ok) throw new Error(`No se pudo leer el WAV: ${response.status}`);
            const buffer = await response.arrayBuffer();
            w.__fluPlayback.fetchInfo = {
                status: response.status,
                contentType: response.headers.get('content-type'),
                bytes: buffer.byteLength,
                head: Array.from(new Uint8Array(buffer).slice(0, 12)),
            };
            let audio: AudioBuffer;
            try {
                audio = await ctx.decodeAudioData(buffer);
            } catch (error) {
                const info = w.__fluPlayback.fetchInfo;
                w.__fluPlayback.error = `decodeAudioData: ${String(error)} | ${JSON.stringify(info)}`;
                throw error;
            }
            const src = ctx.createBufferSource();
            src.buffer = audio;
            source = src;
            const destination = ctx.createMediaStreamDestination();
            src.connect(destination);
            w.__fluPlayback.ready = true;
            w.__fluPlayback.duration = audio.duration;
            let startedAtAudio = 0;
            w.__fluPlayback.audioPosition = () => {
                if (!w.__fluPlayback.started) return 0;
                const avanzado = ctx.currentTime - startedAtAudio;
                return Math.max(0, Math.min(w.__fluPlayback.duration, avanzado));
            };
            w.__fluPlayback.start = async () => {
                if (w.__fluPlayback.started) return;
                await ctx.resume().catch(() => undefined);
                startedAtAudio = ctx.currentTime;
                src.start();
                w.__fluPlayback.started = true;
                w.__fluPlayback.startedAt = performance.now();
                src.onended = () => {
                    w.__fluPlayback.ended = true;
                    w.__fluPlayback.elapsed = performance.now() - w.__fluPlayback.startedAt;
                };
            };
            w.__fluPlayback.stop = () => {
                try {
                    source?.stop();
                } catch {
                    /* ya terminó */
                }
                try {
                    void context?.close();
                } catch {
                    /* cerrado */
                }
                w.__fluPlayback.ended = true;
            };
            return destination.stream;
        };

        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        (navigator.mediaDevices as any).getUserMedia = async (constraints: MediaStreamConstraints) => {
            if (constraints && constraints.audio) {
                if (!streamPromise) {
                    streamPromise = build().catch((error) => {
                        if (!w.__fluPlayback.error) w.__fluPlayback.error = String(error);
                        throw error;
                    });
                }
                return streamPromise;
            }
            return original(constraints);
        };
    };
}

/** SR mudo: arranca y nunca emite, para el escenario de Chrome callado. */
export function stubMuteRecognition() {
    return () => {
        class MuteRecognition {
            lang = '';
            interimResults = true;
            continuous = true;
            maxAlternatives = 1;
            onstart: any = null;
            onresult: any = null;
            onerror: any = null;
            onend: any = null;
            start() {
                setTimeout(() => {
                    if (typeof this.onstart === 'function') this.onstart();
                }, 0);
            }
            stop() {}
            abort() {}
        }
        (window as any).SpeechRecognition = MuteRecognition;
        (window as any).webkitSpeechRecognition = MuteRecognition;
    };
}

/**
 * SR guionizado para `--sr script`: reemite por `onresult` los finales REALES de
 * la sesión (`chrome-raw`, reubicados a la posición del WAV) mientras el VAD y el
 * motor de conversación corren sobre el PCM real del WAV.
 *
 * Motivo (medido 2026-10-26): la Web Speech API de Chrome no consume el dispositivo
 * falso (`--use-file-for-fake-audio-capture`): `audiostart` → `audioend` a los ~8 s →
 * `error:no-speech`, con el WAV de la sesión y con x8 de ganancia. Sin texto no hay
 * filas que medir. Este modo sustituye SOLO al reconocedor; audio, VAD, tramos,
 * cierre y filas son los del producto.
 *
 * La línea de tiempo es la POSICIÓN del WAV en el reloj de audio
 * (`__fluPlayback.status().position`), no el reloj de pared: el AudioContext
 * puede estrangularse (medido 2026-10-31: 0,5x) y un guion por pared adelanta
 * los finales respecto de su habla. Cada final llega como sesión de
 * reconocimiento de UN resultado (`resultIndex: 0`, `results[0].isFinal === true`),
 * la forma legítima que Chrome usa al inicio de una sesión.
 *
 * @param events Guion `{ atMs, text }` (ms desde WAV t=0), ordenado por el helper.
 */
export function stubScriptedRecognition() {
    return (events: Array<{ atMs: number; text: string }>) => {
        const w = window as any;
        const pending = [...(events || [])]
            .map((event) => ({
                atMs: Math.max(0, Number(event?.atMs) || 0),
                text: String(event?.text || '').trim(),
                emitted: false,
            }))
            .filter((event) => event.text)
            .sort((a, b) => a.atMs - b.atMs);
        const state: { planned: number; emitted: Array<{ t: number; text: string }>; errors: string[] } = {
            planned: pending.length,
            emitted: [],
            errors: [],
        };
        w.__fluScript = state;
        let active: any = null;

        const deliverDue = () => {
            const playback = w.__fluPlayback;
            if (!playback?.started || !playback?.startedAt || !active) return;
            // La línea de tiempo es la del AUDIO (posición del WAV), no la de
            // pared: con el AudioContext estrangulado, `performance.now()` se
            // adelanta y los finales caen antes de su habla.
            const elapsed = typeof playback.audioPosition === 'function'
                ? playback.audioPosition() * 1000
                : performance.now() - Number(playback.startedAt);
            for (const item of pending) {
                if (item.emitted || item.atMs > elapsed) continue;
                item.emitted = true;
                state.emitted.push({ t: Math.round(elapsed), text: item.text });
                try {
                    active.dispatchFinal(item.text);
                } catch (error) {
                    state.errors.push(String(error));
                }
            }
        };
        window.setInterval(deliverDue, 100);

        class ScriptedRecognition {
            lang = '';
            interimResults = true;
            continuous = true;
            maxAlternatives = 1;
            onstart: any = null;
            onresult: any = null;
            onerror: any = null;
            onend: any = null;
            started = false;
            start() {
                if (this.started) {
                    throw new DOMException('recognition has already started', 'InvalidStateError');
                }
                this.started = true;
                active = this;
                setTimeout(() => {
                    if (!this.started) return;
                    if (typeof this.onstart === 'function') this.onstart({ type: 'start' });
                }, 0);
            }
            dispatchFinal(text: string) {
                if (!this.started || typeof this.onresult !== 'function') return;
                const alternative: any = { transcript: text, confidence: 0.9 };
                const result: any = [alternative];
                result.isFinal = true;
                this.onresult({ type: 'result', resultIndex: 0, results: [result] });
            }
            stop() {
                if (!this.started) return;
                this.started = false;
                if (active === this) active = null;
                setTimeout(() => {
                    if (this.started) return;
                    if (typeof this.onend === 'function') this.onend({ type: 'end' });
                }, 0);
            }
            abort() {
                this.stop();
            }
        }
        (window as any).SpeechRecognition = ScriptedRecognition;
        (window as any).webkitSpeechRecognition = ScriptedRecognition;
    };
}

/**
 * Observa `currentTranscript` (la caja de última frase) sin tocar la UI.
 * Registra solo cambios, con tiempo relativo, para poder ver congelaciones.
 */
export async function startUiObserver(page: Page): Promise<void> {
    await page.evaluate(() => {
        const store = (window as any).__fluStore;
        const started = performance.now();
        const out: Array<{ t: number; text: string }> = [];
        let last: string | null = null;
        const timer = window.setInterval(() => {
            const text = String(store?.getState?.().currentTranscript || '');
            if (text !== last) {
                out.push({ t: Math.round(performance.now() - started), text });
                last = text;
            }
        }, 100);
        (window as any).__fluPlaybackUi = { out, timer, started };
    });
}

/** Detiene el observador y devuelve la traza de caja. */
export async function stopUiObserver(page: Page): Promise<Array<{ t: number; text: string }>> {
    return page.evaluate(() => {
        const ui = (window as any).__fluPlaybackUi;
        if (!ui) return [];
        window.clearInterval(ui.timer);
        return ui.out || [];
    });
}

/** Filas de conversación del store real, normalizadas para el reporte. */
export async function readPlaybackRows(page: Page): Promise<Array<{ role: string; speaker: string; text: string }>> {
    return page.evaluate(() => {
        const rows = (window as any).__fluStore?.getState?.().conversationHistory || [];
        return rows.map((row: any) => ({
            role: String(row.role || ''),
            speaker: String(row.speakerName || row.speaker || ''),
            text: String(row.text || ''),
        }));
    });
}

/** Enciende el recorder de la app y captura la base inicial. */
export async function enablePlaybackRecorder(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const recorder = (window as any).__fluDev?.recorder;
        recorder?.enable?.();
        await recorder?.captureBase?.().catch?.(() => undefined);
    });
}

/** Cierra el recorder para que el sink escriba WAV/manifiesto/turnos. */
export async function finalizePlaybackRecorder(page: Page): Promise<void> {
    await page.evaluate(async () => {
        await (window as any).__fluDev?.recorder?.finalize?.().catch?.(() => undefined);
    });
}

/**
 * Siembra SOLO los participantes del snapshot base-start. No usa el base final.
 * Se usa en modo restore-start; clean-room no siembra participantes de la sesión.
 */
export async function seedBaseStartParticipants(page: Page, participants: any[]): Promise<string> {
    if (!Array.isArray(participants) || participants.length === 0) {
        throw new Error('restore-start sin participantes base-start');
    }
    const normalized = participants.map((p) => ({
        id: String(p.id),
        name: String(p.name || 'Participante'),
        role: String(p.role || ''),
        speakerLabel: String(p.speakerLabel || ''),
        voiceVectorModel: String(p.voiceVectorModel || ''),
        voiceAnchorVerified: p.voiceAnchorVerified === true,
        voiceVector: Array.isArray(p.voiceVector) ? p.voiceVector : null,
    }));
    await page.evaluate(
        async ({ db, parts }: { db: string; parts: any[] }) => {
            const now = Date.now();
            const sync = { revision: 1, updated_at: new Date(now).toISOString(), deleted: false };
            await new Promise<void>((resolve, reject) => {
                const request = indexedDB.open(db);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const database = request.result;
                    const tx = database.transaction(['participants', 'onboardingStates'], 'readwrite');
                    for (const p of parts) {
                        tx.objectStore('participants').put({ ...p, createdAt: now, updatedAt: now, sync });
                        tx.objectStore('onboardingStates').put({
                            id: p.id,
                            stepIndex: 99,
                            completed: true,
                            captured: { name: p.name },
                            startedAt: now,
                            updatedAt: now,
                        });
                    }
                    tx.oncomplete = () => {
                        database.close();
                        resolve();
                    };
                    tx.onerror = () => {
                        database.close();
                        reject(tx.error);
                    };
                };
            });
        },
        { db: 'flu-os3', parts: normalized },
    );
    // La app crea el picker al cargar: tras sembrar la base hay que recargar para
    // que el store de participantes la vea (misma ruta que seedActiveUser).
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.flu-shell', { timeout: 45000 });
    const preferred = normalized.find((p) => p.voiceAnchorVerified) || normalized[0];
    const picker = page.locator('[data-testid="user-picker-select"]');
    await picker.waitFor({ state: 'attached', timeout: 30000 });
    await picker.selectOption(preferred.id);
    await page.waitForFunction(
        (uid: string) => localStorage.getItem('flu-active-user') === uid,
        preferred.id,
        { timeout: 15000 },
    );
    return preferred.id;
}
