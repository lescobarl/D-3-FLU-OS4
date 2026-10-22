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
            w.__fluPlayback.start = async () => {
                if (w.__fluPlayback.started) return;
                await ctx.resume().catch(() => undefined);
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
