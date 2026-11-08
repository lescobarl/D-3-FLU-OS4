// ============================================================
// FLU Playback - helpers de escenario
// ------------------------------------------------------------
// 1) Reproduce el WAV por la salida de un cable de audio virtual; la app lo
//    escucha por el micrófono predeterminado (su camino real).
// 2) Reconstruye los participantes del snapshot `base-start` por las rutas
//    REALES de la app.
// NO sustituye el micrófono, el ASR ni la captura: no toca `getUserMedia`.
// ============================================================
import type { Page } from '@playwright/test';
import { DB_NAME } from './_helpers';

/**
 * Init script de Playwright que expone `window.__fluPlayback`.
 * `prepare()` valida el cable y carga el WAV; `start()` lo reproduce por la
 * salida virtual. La app no se entera: su micrófono sigue siendo el del sistema.
 */
export function installPlaybackPlayer() {
    return ({ url, outputQuery, inputQuery }: { url: string; outputQuery: string; inputQuery: string }) => {
        const w = window as any;
        let context: AudioContext | null = null;
        let source: AudioBufferSourceNode | null = null;
        let buffer: AudioBuffer | null = null;
        let startedAtAudio = 0;
        const state: any = {
            ready: false,
            started: false,
            ended: false,
            duration: 0,
            outputLabel: '',
            inputLabel: '',
            error: '',
            prepare: async () => {},
            start: async () => {},
            stop: () => {},
            status: () => ({}),
            audioPosition: () => 0,
        };
        w.__fluPlayback = state;

        const norm = (value: unknown) => String(value || '').toLowerCase();
        const pick = (devices: MediaDeviceInfo[], kind: MediaDeviceKind, query: string, fallback: RegExp) => {
            const ofKind = devices.filter((d) => d.kind === kind);
            const q = norm(query);
            const matches = ofKind.filter((d) => (q ? norm(d.label).includes(q) : fallback.test(norm(d.label))));
            if (!matches.length) {
                if (q) throw new Error(`No se encontró un dispositivo ${kind} que contenga "${query}"`);
                return null;
            }
            // Chrome expone alias "Default - ..." y "Communications - ..." con
            // deviceId "default"/"communications". Para enrutar el WAV al cable hay
            // que usar la entrada real, no el alias del dispositivo predeterminado.
            const alias = /^(default|communications)\s*-/i;
            return (
                matches.find((d) => !alias.test(d.label) && d.deviceId !== 'default' && d.deviceId !== 'communications') ||
                matches[0]
            );
        };
        const defaultInputLabel = async () => {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const label = String(stream.getAudioTracks()[0]?.label || '');
            stream.getTracks().forEach((track) => track.stop());
            return label;
        };

        state.prepare = async () => {
            if (state.ready) return;
            try {
                if (!navigator.mediaDevices?.enumerateDevices) throw new Error('mediaDevices no disponible');
                const output = pick(
                    await navigator.mediaDevices.enumerateDevices(),
                    'audiooutput',
                    outputQuery,
                    /cable input|voicemeeter input|virtual cable/i,
                );
                if (!output) {
                    throw new Error(
                        'No se encontró la salida del cable virtual. Instala VB-Cable/VoiceMeeter o pasa --output-device <texto>.',
                    );
                }
                const inputLabel = await defaultInputLabel();
                const inputOk = norm(inputQuery)
                    ? norm(inputLabel).includes(norm(inputQuery))
                    : /cable output|voicemeeter out|virtual cable/i.test(norm(inputLabel));
                if (!inputOk) {
                    throw new Error(
                        `El micrófono predeterminado es "${inputLabel}", no el cable virtual. ` +
                            'Configura la grabación del cable como micrófono predeterminado.',
                    );
                }
                const Ctx = w.AudioContext || w.webkitAudioContext;
                if (!Ctx) throw new Error('AudioContext no disponible');
                const ctx = new Ctx();
                context = ctx;
                await ctx.resume().catch(() => undefined);
                if (typeof ctx.setSinkId !== 'function') {
                    throw new Error('AudioContext.setSinkId no disponible en este Chrome');
                }
                await ctx.setSinkId(output.deviceId);
                const response = await fetch(url);
                if (!response.ok) throw new Error(`No se pudo leer el WAV: ${response.status}`);
                const decoded = await ctx.decodeAudioData(await response.arrayBuffer());
                buffer = decoded;
                state.duration = decoded.duration;
                state.outputLabel = output.label;
                state.inputLabel = inputLabel;
                state.ready = true;
            } catch (error) {
                state.error = String(error);
                throw error;
            }
        };

        state.start = async () => {
            if (!state.ready) throw new Error('Playback no preparado');
            if (state.started) return;
            try {
                await context?.resume().catch(() => undefined);
                if (!context || !buffer) throw new Error('Playback sin contexto/audio');
                const src = context.createBufferSource();
                src.buffer = buffer;
                src.connect(context.destination);
                source = src;
                startedAtAudio = context.currentTime;
                src.onended = () => {
                    state.ended = true;
                };
                src.start();
                state.started = true;
            } catch (error) {
                state.error = String(error);
                throw error;
            }
        };

        state.stop = () => {
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
            state.ended = true;
        };

        state.audioPosition = () => {
            if (!state.started || !context) return 0;
            return Math.max(0, Math.min(state.duration, context.currentTime - startedAtAudio));
        };

        state.status = () => ({
            ready: state.ready,
            started: state.started,
            ended: state.ended,
            duration: state.duration,
            position: state.audioPosition(),
            outputLabel: state.outputLabel,
            inputLabel: state.inputLabel,
            error: state.error,
        });
    };
}

/**
 * Siembra los participantes del snapshot inicial de la grabación y activa el
 * que la sesión tenía como primario (ancla verificada o el primero).
 * @param page Página de Playwright.
 * @param participants Participantes del `base-start` grabado.
 * @returns id del participante activado.
 */
export async function seedRecordedParticipants(page: Page, participants: any[]): Promise<string> {
    if (!Array.isArray(participants) || participants.length === 0) {
        throw new Error('La grabación no tiene participantes base-start');
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
        { db: DB_NAME, parts: normalized },
    );
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
