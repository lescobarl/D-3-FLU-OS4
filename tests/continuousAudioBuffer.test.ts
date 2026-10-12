/**
 * voice/lib/continuousAudioBuffer — FIFO de PCM del microfono (0% -> cubierto).
 *
 * POR QUE ESTE TEST: `src/voice/lib/continuousAudioBuffer.js` (253 lineas) es el
 * FIFO que alimenta los snapshots de identidad del hablante
 * (`turnSpeakerPreflight` -> `extractTurnAudioSnapshot`) y la cola de solapamiento
 * entre turnos. Nadie ejecutaba su conducta: el unico consumidor lo usaba con
 * datos vivos. Aqui se fija la semantica de MUESTRAS (que trozo exacto se copia,
 * que se recorta y que se conserva al cerrar turno) con numeros deterministicos:
 * sampleRate 1000 = 1 muestra por ms, y las muestras valen su propio indice, asi
 * que una ventana se puede afirmar por sus valores, no por su longitud.
 *
 * Los umbrales que SI son configuracion (cola de turno, minVoiced) se leen del
 * dueno de esos numeros (micCapture), no se copian a mano.
 */
import { describe, expect, it } from 'vitest';
import {
    ContinuousAudioBuffer,
    bindContinuousAudioBuffer,
    extractTurnAudioOverlapTail,
    extractTurnAudioSnapshot,
} from '../src/voice/lib/continuousAudioBuffer.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';
import { getConversationMinVoicedSamples, getConversationSpeakerTailMs } from '../src/voice/lib/micCapture.js';
import { DEFAULT_SAMPLE_RATE } from '../src/voice/lib/audioConstants.js';

/** 1 muestra por ms y cada muestra vale su indice: una ventana se afirma por valores. */
const makeBuffer = (over = {}) =>
    new ContinuousAudioBuffer({ sampleRate: 1_000, maxBufferMs: 100_000, minRetainMs: 200, ...over });

const ramp = (length: number, from = 0) => Float32Array.from({ length }, (_, i) => from + i);

describe('continuousAudioBuffer — FIFO y copia por rangos', () => {
    it('append acepta Float32Array y arrays planos; vacio no cuenta', () => {
        const buffer = makeBuffer();

        buffer.append(new Float32Array([1, 2, 3]));
        buffer.append([4, 5]);
        buffer.append(new Float32Array(0));
        buffer.append([]);

        expect(buffer.getTotalSamples()).toBe(5);
        expect([...buffer.copyAllSamples()]).toEqual([1, 2, 3, 4, 5]);
        expect(buffer.getConsumedSamples()).toBe(0);
    });

    it('copySampleRange copia el rango exacto aunque cruce chunks', () => {
        const buffer = makeBuffer();
        buffer.append(new Float32Array([1, 2, 3]));
        buffer.append(new Float32Array([4, 5, 6]));

        expect([...buffer.copySampleRange(2, 5)]).toEqual([3, 4, 5]);
        expect([...buffer.copySampleRange(0, 6)]).toEqual([1, 2, 3, 4, 5, 6]);
        expect([...buffer.copySampleRange(4, 4)]).toEqual([]);
        expect([...buffer.copySampleRange(5, 2)]).toEqual([]);
        // Clamp a los bordes del buffer.
        expect([...buffer.copySampleRange(-10, 2)]).toEqual([1, 2]);
        expect([...buffer.copySampleRange(4, 99)]).toEqual([5, 6]);
        // La copia no vacia el FIFO (el mic sigue escribiendo).
        expect(buffer.getTotalSamples()).toBe(6);
    });
});

describe('continuousAudioBuffer — recorte por tamano', () => {
    it('tira lo mas VIEJO y conserva lo ultimo, tambien en trozos parciales', () => {
        // tope = max(minRetain 200+4096, 10 s a 1 muestra/ms = 10_000) = 10_000 muestras
        const buffer = makeBuffer({ maxBufferMs: 10_000 });
        buffer.append(ramp(12_000));

        expect(buffer.getTotalSamples()).toBe(10_000);
        const all = buffer.copyAllSamples();
        expect(all[0]).toBe(2_000);
        expect(all.at(-1)).toBe(11_999);
    });

    it('descarta chunks enteros cuando el presupuesto alcanza', () => {
        const buffer = makeBuffer({ minRetainMs: 1, maxBufferMs: 10_000 });
        for (let i = 0; i < 12; i += 1) buffer.append(Float32Array.from({ length: 1_000 }, () => i));

        // 12_000 muestras con tope 10_000: se van los DOS chunks mas viejos.
        expect(buffer.getTotalSamples()).toBe(10_000);
        const all = buffer.copyAllSamples();
        expect(all[0]).toBe(2);
        expect(all.at(-1)).toBe(11);
    });

    it('el recorte reajusta la cabeza FIFO y el inicio de turno sin bajar de 0', () => {
        const buffer = makeBuffer({ maxBufferMs: 10_000 });
        buffer.append(ramp(8_000));
        buffer.markTurnStart(5);
        expect(buffer.getTurnStartSample()).toBe(8_000);
        buffer.advanceAfterCommit({ overlapMs: 8_000 }); // el solapamiento cubre todo el buffer
        expect(buffer.getConsumedSamples()).toBe(0);
        expect(buffer.getTurnStartSample()).toBe(8_000);

        // Al recortar 2_000 muestras, la cabeza FIFO y el inicio de turno retroceden con ellas.
        buffer.append(ramp(4_000, 8_000));
        expect(buffer.getTotalSamples()).toBe(10_000);
        expect(buffer.getTurnStartSample()).toBe(6_000);
    });
});

describe('continuousAudioBuffer — ventana de turno (snapshot de identidad)', () => {
    const tailMs = getConversationSpeakerTailMs(FLU_CONFIG, { atTurnBoundary: false });
    const boundaryMs = getConversationSpeakerTailMs(FLU_CONFIG, { atTurnBoundary: true });

    // P9.86 / D9.1: los valores APROBADOS por el dueno fijan UN solo tail (2000 ms, sin
    // cola de frontera mas corta) y minVoiced 350 ms. Los casos afirman ESOS valores: el
    // umbral de alineacion es el minVoiced de config (no el 8 ms anterior).
    const minVoiced = getConversationMinVoicedSamples(1_000); // 350 muestras a 1 muestra/ms
    const inicioAlineado = 20_000 - minVoiced;

    const withAudio = () => {
        const buffer = makeBuffer();
        buffer.append(ramp(20_000));
        return buffer;
    };

    it('en frontera de turno la ventana es la COLA de la cola de frontera', () => {
        const window = withAudio().snapshotTurnWindow({ atTurnBoundary: true });

        expect(window.length).toBe(boundaryMs);
        expect(window[0]).toBe(20_000 - boundaryMs);
        expect(window.at(-1)).toBe(19_999);
        // UN solo tail (aprobado): ya no hay cola de frontera mas corta.
        expect(boundaryMs).toBe(tailMs);
    });

    it('con turno largo la ventana sigue anclada al FIN de lo capturado', () => {
        const window = withAudio().snapshotTurnWindow({ turnAudioStartSample: 0 });

        expect(window.length).toBe(tailMs);
        expect(window[0]).toBe(20_000 - tailMs);
    });

    it('un turno corto NO recorta por turno: da la cola completa', () => {
        const buffer = withAudio();

        // Por DEBAJO del minVoiced de config (350 muestras): NO alinea, da la cola.
        const corto = buffer.snapshotTurnWindow({ turnAudioStartSample: 19_995 });
        expect(corto.length).toBe(tailMs);
        expect(corto[0]).toBe(20_000 - tailMs);

        // JUSTO en el umbral de config: alinea al inicio del turno.
        const justo = buffer.snapshotTurnWindow({ turnAudioStartSample: inicioAlineado });
        expect(justo.length).toBe(minVoiced);
        expect(justo[0]).toBe(inicioAlineado);
    });

    it('con el turno alineado y mas corto que la cola, la ventana empieza en el turno', () => {
        const buffer = withAudio();

        const window = buffer.snapshotTurnWindow({ turnAudioStartSample: 20_000 - 500 });

        expect(window.length).toBe(500);
        expect(window[0]).toBe(19_500);
        expect(window.at(-1)).toBe(19_999);
    });

    it('el umbral es el minVoiced de la config: en el limite alinea, por debajo cae a la cola', () => {
        const buffer = withAudio();

        expect(buffer.snapshotTurnWindow({ turnAudioStartSample: inicioAlineado + 1 }).length).toBe(tailMs);
        expect(buffer.snapshotTurnWindow({ turnAudioStartSample: inicioAlineado }).length).toBe(minVoiced);
    });
});

describe('continuousAudioBuffer — cierre de turno y estado', () => {
    it('advanceAfterCommit avanza la cabeza y conserva el solapamiento pedido', () => {
        const buffer = makeBuffer();
        buffer.append(ramp(5_000));
        buffer.markTurnStart(11);

        const out = buffer.advanceAfterCommit();

        expect(out).toEqual({ overlapSamples: 200, retainedSamples: 200 });
        expect(buffer.getTotalSamples()).toBe(200);
        expect([...buffer.copyAllSamples()]).toEqual([...ramp(5_000).slice(-200)]);
        expect(buffer.getTurnStartSample()).toBe(200);
        expect(buffer.getConsumedSamples()).toBe(0);
    });

    it('un solapamiento mayor que el buffer conserva todo; menor, recorta mas', () => {
        const ancho = makeBuffer();
        ancho.append(ramp(300));
        expect(ancho.advanceAfterCommit({ overlapMs: 5_000 }).retainedSamples).toBe(300);

        const estrecho = makeBuffer();
        estrecho.append(ramp(5_000));
        expect(estrecho.advanceAfterCommit({ overlapMs: 50 }).retainedSamples).toBe(50);
        expect([...estrecho.copyAllSamples()]).toEqual([...ramp(5_000).slice(-50)]);
    });

    it('markTurnStart fija el inicio de turno; sin hora valida usa el reloj', () => {
        const buffer = makeBuffer();
        buffer.append(ramp(1_000));

        expect(buffer.getTurnStartSample()).toBe(0);
        expect(buffer.getSegmentStartedAtMs()).toBe(0);

        expect(buffer.markTurnStart(1_234.5)).toBe(1_000);
        expect(buffer.getSegmentStartedAtMs()).toBe(1_234.5);

        buffer.markTurnStart(0);
        expect(buffer.getSegmentStartedAtMs()).toBeGreaterThan(0);
    });

    it('reset deja el buffer en cero y flushToZero vacia y reabre el turno', () => {
        const buffer = makeBuffer();
        buffer.append(ramp(500));
        buffer.markTurnStart(7);

        buffer.reset();
        expect(buffer.getTotalSamples()).toBe(0);
        expect([...buffer.copyAllSamples()]).toEqual([]);
        expect(buffer.getTurnStartSample()).toBe(0);

        buffer.append(ramp(100));
        const out = buffer.flushToZero(99);
        expect(out).toEqual({ flushed: true, totalSamples: 0, turnStartSample: 0, segmentStartedAtMs: 99 });
        expect(buffer.getTotalSamples()).toBe(0);
        expect(buffer.getSegmentStartedAtMs()).toBe(99);
    });

    it('el constructor cae a los duenos de los numeros si le llega basura', () => {
        const buffer = new ContinuousAudioBuffer({ sampleRate: 0, maxBufferMs: Number.NaN, minRetainMs: -1 });

        expect(buffer.sampleRate).toBe(DEFAULT_SAMPLE_RATE);
        expect(buffer.maxBufferMs).toBeGreaterThan(0);
        expect(buffer.minRetainMs).toBeGreaterThan(0);
    });
});

describe('continuousAudioBuffer — costuras con el resto del motor', () => {
    it('bindContinuousAudioBuffer expone refs VIVAS (chunks, total y inicio de turno)', () => {
        const buffer = makeBuffer();
        const refs = bindContinuousAudioBuffer(buffer);

        buffer.append(new Float32Array([1, 2, 3]));
        expect(refs.chunksRef.current.length).toBe(1);
        expect(refs.chunkTotalSamplesRef.current).toBe(3);

        refs.turnAudioStartSampleRef.current = 3;
        expect(buffer.getTurnStartSample()).toBe(3);
        refs.turnAudioStartSampleRef.current = 'basura';
        expect(buffer.getTurnStartSample()).toBe(0);
    });

    it('extractTurnAudioSnapshot tolera ausencia de buffer y respeta el inicio explicito', () => {
        expect(extractTurnAudioSnapshot(null, 1_000).length).toBe(0);

        const buffer = makeBuffer();
        buffer.append(ramp(20_000));
        buffer.markTurnStart(1);

        const porDefecto = extractTurnAudioSnapshot(buffer, 1_000, {});
        expect(porDefecto.at(-1)).toBe(19_999);
        expect(porDefecto.length).toBe(getConversationSpeakerTailMs(FLU_CONFIG, { atTurnBoundary: false }));

        // Turno >= minVoiced de config (350): respeta el inicio explicito del turno.
        const explicito = extractTurnAudioSnapshot(buffer, 1_000, { turnAudioStartSample: 19_550 });
        expect(explicito[0]).toBe(19_550);
        expect(explicito.length).toBe(450);

        const frontera = extractTurnAudioSnapshot(buffer, 1_000, { atTurnBoundary: true });
        expect(frontera.length).toBe(getConversationSpeakerTailMs(FLU_CONFIG, { atTurnBoundary: true }));
    });

    it('extractTurnAudioOverlapTail: buffer -> copia; chunks legacy -> copia o null', () => {
        const buffer = makeBuffer();
        buffer.append(ramp(1_000));
        expect([...extractTurnAudioOverlapTail(buffer, 1_000, 200)]).toEqual([...ramp(1_000).slice(-200)]);

        const legacy = [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])];
        expect([...extractTurnAudioOverlapTail(legacy, 1_000, 2)]).toEqual([5, 6]);
        expect(extractTurnAudioOverlapTail([], 1_000, 200)).toBe(null);

        // Con BUFFER, parametros invalidos caen a 48 kHz y 800 ms (contrato del modulo).
        const largo = makeBuffer();
        largo.append(new Float32Array(DEFAULT_SAMPLE_RATE));
        expect(extractTurnAudioOverlapTail(largo, 0, 0).length).toBe(DEFAULT_SAMPLE_RATE * 0.8);
        // Con chunks LEGACY no hay redondeo: la misma basura da 0 muestras -> null.
        expect(extractTurnAudioOverlapTail([new Float32Array(40_000)], 0, 0)).toBe(null);
    });
});
