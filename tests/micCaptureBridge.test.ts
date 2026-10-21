/**
 * voice/lib/micCaptureBridge — AudioWorklet a PCM + STT (90 sentencias, 0%).
 *
 * POR QUE ESTE TEST: `src/voice/lib/micCaptureBridge.js` es el puente del hilo de
 * audio al main thread: crea el nodo del worklet, encadena source -> worklet ->
 * gain(0) -> destino (para que suene NADA: solo captura) y traduce cada bloque PCM
 * en (a) muestras para el buffer continuo y (b) PCM int16 de 16 kHz para el STT.
 * Estaba al 0%: nadie ejecutaba ni el encadenado ni el troceo por `processEvery`.
 * El audio context y `AudioWorkletNode` son dobles (el modulo solo usa la interfaz),
 * pero la codificacion a int16 es la REAL (pcmAudio).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMicCaptureWorkletNode, wireMicCapturePipeline } from '../src/voice/lib/micCaptureBridge.js';
import { DEFAULT_SAMPLE_RATE, DEFAULT_TARGET_SAMPLE_RATE } from '../src/voice/lib/audioConstants.js';
import {
    clearSessionRecording,
    disableSessionRecorder,
    enableSessionRecorder,
    getSessionRecordingSnapshot,
} from '../src/voice/lib/sessionRecorder.js';

class PuertaFalsa {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    emitir(data: unknown) {
        this.onmessage?.({ data });
    }
}

class WorkletFalso {
    static creados: WorkletFalso[] = [];
    port = new PuertaFalsa();
    conectados: unknown[] = [];
    desconexiones = 0;
    constructor(
        public contexto: unknown,
        public nombre: string,
        public opciones: Record<string, unknown>,
    ) {
        WorkletFalso.creados.push(this);
    }
    connect(destino: unknown) {
        this.conectados.push(destino);
    }
    disconnect() {
        this.desconexiones += 1;
    }
}

class GananciaFalsa {
    gain = { value: -1 };
    conectados: unknown[] = [];
    desconexiones = 0;
    connect(destino: unknown) {
        this.conectados.push(destino);
    }
    disconnect() {
        this.desconexiones += 1;
    }
}

class FuenteFalsa {
    conectados: unknown[] = [];
    connect(destino: unknown) {
        this.conectados.push(destino);
    }
}

const makeFuente = () => new FuenteFalsa() as unknown as MediaStreamAudioSourceNode;

const makeContext = () => {
    const modulos: unknown[] = [];
    const ganancias: GananciaFalsa[] = [];
    const destino = { nombre: 'destino' };
    return {
        modulos,
        ganancias,
        destino,
        contexto: {
            audioWorklet: {
                addModule: vi.fn(async (url: unknown) => {
                    modulos.push(url);
                }),
            },
            createGain: () => {
                const gain = new GananciaFalsa();
                ganancias.push(gain);
                return gain;
            },
            destination: destino,
        },
    };
};

beforeEach(() => {
    WorkletFalso.creados = [];
    vi.stubGlobal('AudioWorkletNode', WorkletFalso);
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    disableSessionRecorder();
    clearSessionRecording();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('micCaptureBridge — creacion del nodo del worklet', () => {
    it('sin AudioWorklet en el navegador lo dice claro', async () => {
        await expect(createMicCaptureWorkletNode({} as AudioContext)).rejects.toThrow('AudioWorklet no disponible');
        await expect(createMicCaptureWorkletNode(undefined as unknown as AudioContext)).rejects.toThrow();
    });

    it('carga el modulo del processor y crea el nodo con el contrato del worklet', async () => {
        const { contexto, modulos } = makeContext();

        const nodo = await createMicCaptureWorkletNode(contexto as unknown as AudioContext);

        expect(modulos).toHaveLength(1);
        expect(String(modulos[0])).toContain('workers/micCapture.processor.js');
        const creado = nodo as unknown as WorkletFalso;
        expect(creado.nombre).toBe('flu-mic-capture');
        expect(creado.opciones).toEqual({ numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    });
});

describe('micCaptureBridge — encadenado de audio', () => {
    it('encadena fuente -> worklet -> gain(0) -> destino (no suena, solo captura)', async () => {
        const { contexto, ganancias, destino } = makeContext();
        const source = makeFuente();

        const puente = await wireMicCapturePipeline({ audioContext: contexto as unknown as AudioContext, source });
        const nodo = puente.workletNode as unknown as WorkletFalso;

        // La fuente no suena por ningun lado: entra al worklet y el worklet va a un gain a 0.
        expect((source as unknown as FuenteFalsa).conectados).toEqual([nodo]);
        expect(nodo.conectados).toEqual([ganancias[0]]);
        expect(ganancias[0].gain.value).toBe(0);
        expect(ganancias[0].conectados).toEqual([destino]);
    });

    it('el indice de muestras acumula lo procesado y se puede reiniciar', async () => {
        const { contexto } = makeContext();
        const puente = await wireMicCapturePipeline({
            audioContext: contexto as unknown as AudioContext,
            source: makeFuente(),
        });
        const puerta = (puente.workletNode as unknown as WorkletFalso).port;

        puerta.emitir({ type: 'pcm', samples: new Float32Array(100) });
        puerta.emitir({ type: 'pcm', samples: new Float32Array(50) });
        expect(puente.getSampleIndex()).toBe(150);

        puente.resetSampleIndex();
        expect(puente.getSampleIndex()).toBe(0);
    });
});

describe('micCaptureBridge — bloques de PCM', () => {
    const conPuente = async (options: Record<string, unknown> = {}) => {
        const { contexto } = makeContext();
        const puente = await wireMicCapturePipeline({
            audioContext: contexto as unknown as AudioContext,
            source: makeFuente(),
            ...options,
        });
        return { puente, puerta: (puente.workletNode as unknown as WorkletFalso).port };
    };

    it('ignora lo que no es un bloque pcm y los bloques vacios', async () => {
        const onPcmBlock = vi.fn();
        const pushSttPcm = vi.fn();
        const { puerta, puente } = await conPuente({ onPcmBlock, pushSttPcm });

        puerta.emitir({ type: 'otra-cosa', samples: new Float32Array([1]) });
        puerta.emitir({ type: 'pcm' });
        puerta.emitir({ type: 'pcm', samples: new Float32Array(0) });
        puerta.emitir({});

        expect(onPcmBlock).not.toHaveBeenCalled();
        expect(pushSttPcm).not.toHaveBeenCalled();
        expect(puente.getSampleIndex()).toBe(0);
    });

    it('entrega las muestras con su indice ACUMULADO y el reloj del bloque', async () => {
        const bloques: Array<{ muestras: Float32Array; indice: number; reloj: number }> = [];
        const { puerta } = await conPuente({
            onPcmBlock: (samples: Float32Array, meta: { sampleIndex: number; audioStartedAtMs: number }) => {
                bloques.push({ muestras: samples, indice: meta.sampleIndex, reloj: meta.audioStartedAtMs });
            },
        });

        puerta.emitir({ type: 'pcm', samples: new Float32Array([0.1, 0.2]) });
        puerta.emitir({ type: 'pcm', samples: new Float32Array([0.3, 0.4, 0.5]) });

        expect(bloques.map((b) => b.indice)).toEqual([0, 2]);
        expect(bloques[1].muestras.length).toBe(3);
        expect(Number.isFinite(bloques[1].reloj)).toBe(true);
    });

    it('convierte a Float32Array lo que llegue como lista plana', async () => {
        const onPcmBlock = vi.fn();
        const { puerta } = await conPuente({ onPcmBlock });

        puerta.emitir({ type: 'pcm', samples: [0.5, -0.5] });

        expect(onPcmBlock.mock.calls[0][0]).toBeInstanceOf(Float32Array);
        expect([...(onPcmBlock.mock.calls[0][0] as Float32Array)]).toEqual([0.5, -0.5]);
    });

    it('processEvery decide cada cuantos bloques se procesa', async () => {
        const onPcmBlock = vi.fn();
        const { puerta } = await conPuente({ onPcmBlock, processEvery: 2 });

        puerta.emitir({ type: 'pcm', samples: new Float32Array([1]) });
        puerta.emitir({ type: 'pcm', samples: new Float32Array([2]) });
        puerta.emitir({ type: 'pcm', samples: new Float32Array([3]) });
        puerta.emitir({ type: 'pcm', samples: new Float32Array([4]) });

        expect(onPcmBlock).toHaveBeenCalledTimes(2);
        expect([...(onPcmBlock.mock.calls[0][0] as Float32Array)]).toEqual([2]);
        expect([...(onPcmBlock.mock.calls[1][0] as Float32Array)]).toEqual([4]);
    });

    it('la grabación de sesión conserva TODOS los bloques aunque processEvery descarte', async () => {
        enableSessionRecorder();
        const { puerta } = await conPuente({ processEvery: 2, sampleRate: DEFAULT_TARGET_SAMPLE_RATE });

        // Cuatro bloques de 4 muestras: el pipeline procesa 2, el WAV debe tener 4.
        for (let i = 0; i < 4; i += 1) {
            puerta.emitir({ type: 'pcm', samples: new Float32Array([0, 0, 0, 0]) });
        }

        const snapshot = getSessionRecordingSnapshot();
        expect(snapshot.audio.sampleRate).toBe(DEFAULT_TARGET_SAMPLE_RATE);
        expect(snapshot.audio.samples).toBe(16);
    });

    it('el PCM para el STT sale en int16 con los valores del contrato', async () => {
        const pushSttPcm = vi.fn();
        const { puerta } = await conPuente({ pushSttPcm, sampleRate: DEFAULT_TARGET_SAMPLE_RATE });

        puerta.emitir({ type: 'pcm', samples: new Float32Array([1, -1, 0, 0.5]) });

        const pcm = pushSttPcm.mock.calls[0][0] as Int16Array;
        expect(pcm).toBeInstanceOf(Int16Array);
        expect([...pcm]).toEqual([0x7fff, -0x8000, 0, 16383]);
    });

    it('a 48 kHz el bloque baja a 16 kHz: un tercio de muestras', async () => {
        const pushSttPcm = vi.fn();
        const { puerta } = await conPuente({ pushSttPcm, sampleRate: DEFAULT_SAMPLE_RATE });

        puerta.emitir({ type: 'pcm', samples: new Float32Array(30) });

        expect((pushSttPcm.mock.calls[0][0] as Int16Array).length).toBe(10);
    });
});

describe('micCaptureBridge — desconexion', () => {
    it('desconecta nodo y ganancia, y deja de escuchar la puerta', async () => {
        const onPcmBlock = vi.fn();
        const { contexto } = makeContext();
        const puente = await wireMicCapturePipeline({
            audioContext: contexto as unknown as AudioContext,
            source: makeFuente(),
            onPcmBlock,
        });
        const nodo = puente.workletNode as unknown as WorkletFalso;
        const puerta = nodo.port;

        puente.disconnect();

        expect(nodo.desconexiones).toBe(1);
        expect(puerta.onmessage).toBe(null);
        puerta.emitir({ type: 'pcm', samples: new Float32Array([1]) });
        expect(onPcmBlock).not.toHaveBeenCalled();
    });

    it('un error al desconectar no tumba el cierre', async () => {
        const { contexto } = makeContext();
        const puente = await wireMicCapturePipeline({
            audioContext: contexto as unknown as AudioContext,
            source: makeFuente(),
        });
        const nodo = puente.workletNode as unknown as WorkletFalso;
        nodo.disconnect = () => {
            throw new Error('ya estaba desconectado');
        };

        expect(() => puente.disconnect()).not.toThrow();
        expect(puente.workletNode).toBeTruthy();
    });
});
