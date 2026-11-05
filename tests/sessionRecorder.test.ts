// ============================================================
// sessionRecorder — grabación de sesión con bandera propia.
//
// Cubre lo que el dueño pidió: poder encender/apagar la grabación como los
// logs, capturar el audio real del micrófono y los eventos del pipeline, y
// exportar un WAV reproducible junto al JSON de eventos.
//
// CONTRATO DEL CANAL DE AUDIO (529c672d, PORTERO A1 medido 2026-10-23): el
// audio NUNCA se apaga — un canal roto dejaba la grabación truncada en
// silencio; cada lote perdido se declara como HUECO (`audioGaps`) y se sigue
// reintentando. El breaker de 5 fallos consecutivos vale para el RESTO de
// canales (`events`/`turns`/`start`/`finalize`), con contador POR canal.
//
// Entorno `node`: es lógica pura (sin DOM); el fallback de `localStore` es un
// mapa en memoria y `Blob` existe en Node 22.
// ============================================================
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildSessionWavBlob,
    clearSessionRecording,
    configureSessionSink,
    createHttpSessionSink,
    disableSessionRecorder,
    enableSessionRecorder,
    finalizeSessionRecording,
    getSessionRecordingSnapshot,
    getSessionRecordingStatus,
    isSessionRecordingEnabled,
    pushSessionAudio,
    recordSessionEvent,
    recordSessionTurn,
    resolveRecorderFlag,
} from '../src/voice/lib/sessionRecorder.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';
import { STORAGE_KEYS } from '../src/core/config/appConfig';
import { localGet } from '../src/core/storage/localStore';

const RECORDER_SRC = join(process.cwd(), 'src', 'voice', 'lib', 'sessionRecorder.js');

const DEFAULT_MAX_MINUTES = FLU_CONFIG.recorder.maxMinutes;
const DEFAULT_MAX_EVENTS = FLU_CONFIG.recorder.maxEvents;

function ascii(bytes: Uint8Array, offset: number, length: number): string {
    return String.fromCharCode(...bytes.slice(offset, offset + length));
}

describe('sessionRecorder — bandera de encendido/apagado', () => {
    it('la clave nueva manda y la legacy solo se usa si la nueva no existe', () => {
        expect(resolveRecorderFlag('1', '0')).toBe(true);
        expect(resolveRecorderFlag('0', '1')).toBe(false);
        expect(resolveRecorderFlag(undefined, '1')).toBe(true);
        expect(resolveRecorderFlag(undefined, '0')).toBe(false);
        expect(resolveRecorderFlag(undefined, undefined)).toBeNull();
    });

    beforeEach(() => {
        clearSessionRecording();
        disableSessionRecorder();
    });

    afterEach(() => {
        disableSessionRecorder();
        clearSessionRecording();
        FLU_CONFIG.recorder.maxMinutes = DEFAULT_MAX_MINUTES;
        FLU_CONFIG.recorder.maxEvents = DEFAULT_MAX_EVENTS;
    });

    it('apagada por defecto: no guarda audio ni eventos y persiste el apagado', () => {
        expect(isSessionRecordingEnabled()).toBe(false);
        expect(pushSessionAudio(new Float32Array(32), 48000)).toBe(false);
        expect(recordSessionEvent('listen', 'chrome-raw', { text: 'hola' })).toBe(false);
        const snapshot = getSessionRecordingSnapshot();
        expect(snapshot.audio.samples).toBe(0);
        expect(snapshot.events).toEqual([]);
        expect(localGet(STORAGE_KEYS.RECORDER_ENABLED)).toBe('0');
    });

    it('encender la enciende y persistir la bandera; apagarla conserva lo grabado', () => {
        expect(enableSessionRecorder()).toBe(true);
        expect(isSessionRecordingEnabled()).toBe(true);
        expect(localGet(STORAGE_KEYS.RECORDER_ENABLED)).toBe('1');
        pushSessionAudio(new Float32Array(16), 48000);
        recordSessionEvent('listen', 'final', { text: 'hola' });
        disableSessionRecorder();
        expect(isSessionRecordingEnabled()).toBe(false);
        const snapshot = getSessionRecordingSnapshot();
        // Apagar no borra: el dueño todavía puede descargar la sesión.
        expect(snapshot.audio.samples).toBe(16);
        expect(snapshot.events).toHaveLength(1);
    });
});

describe('sessionRecorder — audio y WAV', () => {
    beforeEach(() => {
        clearSessionRecording();
        enableSessionRecorder();
        FLU_CONFIG.recorder.maxMinutes = DEFAULT_MAX_MINUTES;
    });

    afterEach(() => {
        disableSessionRecorder();
        clearSessionRecording();
        FLU_CONFIG.recorder.maxMinutes = DEFAULT_MAX_MINUTES;
    });

    it('acumula los bloques a la tasa real y genera un WAV RIFF válido', async () => {
        const block = new Float32Array(480).fill(0.5);
        expect(pushSessionAudio(block, 48000)).toBe(true);
        expect(pushSessionAudio(block, 48000)).toBe(true);

        const snapshot = getSessionRecordingSnapshot();
        expect(snapshot.audio.sampleRate).toBe(48000);
        expect(snapshot.audio.samples).toBe(960);
        expect(snapshot.audio.seconds).toBe(0.02);

        const bytes = new Uint8Array(await buildSessionWavBlob().arrayBuffer());
        const view = new DataView(bytes.buffer);
        expect(ascii(bytes, 0, 4)).toBe('RIFF');
        expect(ascii(bytes, 8, 4)).toBe('WAVE');
        expect(ascii(bytes, 12, 4)).toBe('fmt ');
        expect(view.getUint16(20, true)).toBe(1); // PCM
        expect(view.getUint16(22, true)).toBe(1); // mono
        expect(view.getUint32(24, true)).toBe(48000);
        expect(view.getUint32(28, true)).toBe(96000); // byte rate
        expect(view.getUint16(34, true)).toBe(16); // bits
        expect(ascii(bytes, 36, 4)).toBe('data');
        expect(view.getUint32(40, true)).toBe(960 * 2);
        expect(bytes.length).toBe(44 + 960 * 2);
        // 0.5 se cuantiza a 16383 en PCM 16-bit con signo.
        expect(view.getInt16(44, true)).toBe(16383);
    });

    it('el tope acota la memoria y marca truncated; el bloque SIGUE aceptándose para el disco', () => {
        // 0.00001 min ≈ 29 muestras a 48 kHz.
        FLU_CONFIG.recorder.maxMinutes = 0.00001;
        const block = new Float32Array(64).fill(0.1);
        expect(pushSessionAudio(block, 48000)).toBe(true);
        // Regla nueva: la sesión completa va al sumidero aunque la memoria ya esté llena.
        expect(pushSessionAudio(block, 48000)).toBe(true);
        const snapshot = getSessionRecordingSnapshot();
        expect(snapshot.audio.samples).toBe(29);
        expect(snapshot.audio.truncated).toBe(true);
    });

    it('si cambiara la tasa del AudioContext, el bloque se adapta a la tasa grabada', () => {
        pushSessionAudio(new Float32Array(480), 48000);
        pushSessionAudio(new Float32Array(160), 16000);
        const snapshot = getSessionRecordingSnapshot();
        expect(snapshot.audio.sampleRate).toBe(48000);
        // 160 muestras a 16 kHz equivalen a 480 a 48 kHz.
        expect(snapshot.audio.samples).toBe(960);
    });
});

describe('sessionRecorder — eventos', () => {
    beforeEach(() => {
        clearSessionRecording();
        enableSessionRecorder();
        FLU_CONFIG.recorder.maxEvents = DEFAULT_MAX_EVENTS;
    });

    afterEach(() => {
        disableSessionRecorder();
        clearSessionRecording();
        FLU_CONFIG.recorder.maxEvents = DEFAULT_MAX_EVENTS;
    });

    it('guarda categoría, evento y datos acotados, con secuencia y tiempo', () => {
        recordSessionEvent('listen', 'chrome-raw', { text: 'x'.repeat(2000), kind: 'final' });
        const snapshot = getSessionRecordingSnapshot();
        expect(snapshot.events).toHaveLength(1);
        const row = snapshot.events[0];
        expect(row.seq).toBe(1);
        expect(row.category).toBe('listen');
        expect(row.event).toBe('chrome-raw');
        expect(typeof row.t).toBe('number');
        // `data` es unknown en el contrato exportable; el test conoce su forma.
        const data = row.data as { kind: string; text: string };
        expect(data.kind).toBe('final');
        // Cadena acotada: no se exporta un log de tamaño ilimitado.
        expect(data.text.length).toBe(1001);
        expect(data.text.endsWith('…')).toBe(true);
    });

    it('un objeto circular no rompe la grabación (profundidad acotada)', () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(() => recordSessionEvent('log', 'circular', circular)).not.toThrow();
        const snapshot = getSessionRecordingSnapshot();
        expect(snapshot.events).toHaveLength(1);
        expect(JSON.stringify(snapshot.events)).toContain('[depth]');
    });

    it('el ring descarta los eventos más viejos y los cuenta', () => {
        FLU_CONFIG.recorder.maxEvents = 3;
        for (let i = 1; i <= 5; i += 1) recordSessionEvent('log', `e${i}`, { i });
        const snapshot = getSessionRecordingSnapshot();
        expect(snapshot.events.map((row) => row.event)).toEqual(['e3', 'e4', 'e5']);
        expect(snapshot.status.droppedEvents).toBe(2);
    });
});

describe('sessionRecorder — sumidero HTTP y límites reales del navegador', () => {
    beforeEach(() => {
        clearSessionRecording();
        enableSessionRecorder();
    });

    afterEach(() => {
        configureSessionSink(null);
        disableSessionRecorder();
        clearSessionRecording();
        vi.unstubAllGlobals();
    });

    it('keepalive SOLO en el cierre: un fetch normal no viaja con keepalive', async () => {
        const inits: Array<Record<string, unknown>> = [];
        const sink = createHttpSessionSink({
            fetchImpl: (_url, init) => {
                inits.push(init as Record<string, unknown>);
                return Promise.resolve(new Response('{}', { status: 200 }));
            },
        });
        const chunk = new Uint8Array(16);
        await sink.audio!('sesion-visible', chunk);
        // Medido 2026-10-19: con keepalive, Chromium rechaza todo cuerpo > 64 KiB.
        expect(inits[0].keepalive).toBeUndefined();
        expect(inits[0].body).toBe(chunk);

        vi.stubGlobal('document', { visibilityState: 'hidden' });
        vi.stubGlobal('navigator', {});
        await sink.audio!('sesion-oculta', chunk);
        expect(inits[1].keepalive).toBe(true);
    });

    it('el lote de audio persistido queda por debajo del tope de 64 KiB y no pierde muestras', async () => {
        const chunks: number[] = [];
        configureSessionSink({
            start: () => undefined,
            audio: (_id, chunk) => {
                chunks.push(chunk.length);
                return undefined;
            },
            events: () => undefined,
            turns: () => undefined,
        });
        // 2 s de PCM a 48 kHz en bloques de 128 muestras (el AudioWorklet real).
        for (let i = 0; i < 750; i += 1) pushSessionAudio(new Float32Array(128).fill(0.1), 48000);
        await finalizeSessionRecording({ withBase: false });

        expect(chunks.length).toBeGreaterThan(1);
        for (const bytes of chunks) expect(bytes).toBeLessThan(64 * 1024);
        expect(chunks.reduce((sum, bytes) => sum + bytes, 0)).toBe(750 * 128 * 2);
    });

    it('el canal de AUDIO nunca se apaga: reintenta SIEMPRE y cada lote perdido se declara como hueco', async () => {
        let audioAttempts = 0;
        const eventosPersistidos: string[] = [];
        configureSessionSink({
            start: () => undefined,
            audio: () => {
                audioAttempts += 1;
                return Promise.reject(new Error('Failed to fetch'));
            },
            events: (_id, lines) => {
                eventosPersistidos.push(lines);
                return undefined;
            },
            turns: () => undefined,
        });
        // Cada bloque son 32 KiB exactos: cada push dispara un volcado de audio.
        for (let i = 0; i < 6; i += 1) {
            pushSessionAudio(new Float32Array(16384).fill(0.1), 48000);
            recordSessionEvent('log', `e${i}`, { i });
        }
        await finalizeSessionRecording({ withBase: false });

        // Contrato fijado por 529c672d (PORTERO A1 medido 2026-10-23): el canal
        // de audio NO se detiene tras 5 fallos — un lote perdido es un HUECO
        // declarado, no una grabación truncada en silencio. Reintenta siempre:
        // 6 volcados = 6 intentos, huecos contados y el canal sigue vivo.
        expect(audioAttempts).toBe(6);
        expect(getSessionRecordingStatus().audioGaps).toBeGreaterThan(0);
        expect(getSessionRecordingStatus().channelsDown).not.toContain('audio');
        // Los eventos siguen persistiendo: un canal roto no apaga la grabación.
        expect(eventosPersistidos.length).toBeGreaterThan(0);
    });

    it('el éxito del canal de audio NO tapa el fallo de turns: contador POR canal y breaker a los 5', async () => {
        let audioAttempts = 0;
        let turnAttempts = 0;
        configureSessionSink({
            start: () => undefined,
            audio: () => {
                audioAttempts += 1;
                return undefined;
            },
            events: () => undefined,
            turns: () => {
                turnAttempts += 1;
                return Promise.reject(new Error('Failed to fetch'));
            },
        });
        // 6 tandas de 40 turnos: cada tanda dispara UN volcado del canal `turns`.
        // Entre tanda y tanda, un bloque de audio de 32 KiB ACIERTA: con un
        // contador global (el defecto medido 2026-10-19) el éxito del audio
        // reiniciaría el contador y `turns` jamás se declararía caído.
        for (let tanda = 0; tanda < 6; tanda += 1) {
            pushSessionAudio(new Float32Array(16384).fill(0.1), 48000);
            for (let i = 0; i < 40; i += 1) recordSessionTurn({ kind: 'turn', text: `t${tanda}-${i}` });
        }
        await finalizeSessionRecording({ withBase: false });

        // Contador POR canal: 5 fallos consecutivos de `turns` lo detienen y la
        // 6a tanda ni se intenta (recordSessionTurn devuelve false). El audio
        // acertó 6 veces sin tapar nada y sigue fuera de `channelsDown`.
        expect(turnAttempts).toBe(5);
        expect(audioAttempts).toBe(6);
        expect(getSessionRecordingStatus().channelsDown).toContain('turns');
        expect(getSessionRecordingStatus().channelsDown).not.toContain('audio');
    });
});

describe('sessionRecorder — guard: el audio nunca se apaga (PORTERO A1)', () => {
    /**
     * ¿La rama de `audio` del catch declara el hueco y RETORNA antes del breaker?
     * Verdadero solo si: la rama existe y anota `audioGaps.push`, termina en
     * `return` SIN tocar `persistChannelsDown`, y el invariante del contrato
     * ("el audio NUNCA se apaga") sigue escrito en la fuente.
     */
    function audioNuncaSeApaga(src: string): boolean {
        const rama = /if \(label === 'audio'\) \{([\s\S]*?)\n      \}/.exec(src)?.[1] ?? '';
        const anotaHueco = rama.includes('audioGaps.push');
        const retornaSinBajarlo = rama.includes('return') && !rama.includes('persistChannelsDown');
        const invariante = src.includes('el audio NUNCA se apaga');
        return anotaHueco && retornaSinBajarlo && invariante;
    }

    it('la fuente real conserva la exención de audio (rama + invariante)', () => {
        expect(audioNuncaSeApaga(readFileSync(RECORDER_SRC, 'utf8'))).toBe(true);
    });

    it('PRUEBA DE DETECTOR: la forma vieja (audio cae con el breaker) => rojo', () => {
        const viejo = `    .catch((error) => {
      const attempts = (persistFailures.get(label) || 0) + 1
      persistFailures.set(label, attempts)
      if (attempts < 5) return
      persistChannelsDown.add(label)
      if (label !== 'events') logCaughtError('sessionRecorder.persistChannel', error, { label, attempts })
    })`;
        expect(audioNuncaSeApaga(viejo), 'sin la exención el audio vuelve a truncarse en silencio').toBe(false);
        const sinInvariante = `    .catch((error) => {
      const attempts = (persistFailures.get(label) || 0) + 1
      persistFailures.set(label, attempts)
      if (label === 'audio') {
        audioGaps.push({ sample: audioSamples, at: Date.now() })
        return
      }
      if (attempts < 5) return
      persistChannelsDown.add(label)
    })`;
        expect(audioNuncaSeApaga(sinInvariante), 'sin el contrato escrito el cambio se pierde sin rastro').toBe(false);
        const sinHueco = `    .catch((error) => {
      const attempts = (persistFailures.get(label) || 0) + 1
      persistFailures.set(label, attempts)
      if (label === 'audio') {
        if (attempts === 5) logCaughtError('sessionRecorder.audioGap', error, { attempts })
        return
      }
      if (attempts < 5) return
      persistChannelsDown.add(label)
    })
    // el audio NUNCA se apaga`;
        expect(audioNuncaSeApaga(sinHueco), 'sin declarar el hueco el defecto no se puede medir').toBe(false);
    });
});
