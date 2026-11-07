// ============================================================
// FLU Playback - micrófono virtual
// ------------------------------------------------------------
// Única responsabilidad: sustituir el micrófono por el WAV de la sesión.
// No sustituye el ASR ni inyecta transcripciones.
// ============================================================

/**
 * Instala un `getUserMedia` que devuelve un MediaStream construido desde un WAV.
 * El audio NO arranca hasta que la página llama `__fluPlayback.start()`.
 * @param url URL del WAV de la sesión.
 * @returns Init script de Playwright.
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
                position: typeof w.__fluPlayback.audioPosition === 'function'
                    ? w.__fluPlayback.audioPosition()
                    : 0,
                error: w.__fluPlayback.error,
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
            let audio: AudioBuffer;
            try {
                audio = await ctx.decodeAudioData(buffer);
            } catch (error) {
                w.__fluPlayback.error = `decodeAudioData: ${String(error)}`;
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
