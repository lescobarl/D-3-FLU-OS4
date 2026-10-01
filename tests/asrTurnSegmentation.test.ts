/**
 * voice/lib/asrTurnSegmentation — una locucion, una fila o varias (0% -> cubierto).
 *
 * POR QUE ESTE TEST: `src/voice/lib/asrTurnSegmentation.js` (218 lineas) decide
 * el caso mas delicado del commit de voz: si un unico final del ASR abre VARIAS
 * filas. Es puro (no toca red, audio ni DOM) y estaba al 0%: se usaba solo a
 * traves del pipeline vivo. Aqui se fijan las cuatro puertas que tiene que pasar
 * un troceo (candidato valido + tramos estables + prior EMBEBIDO + cobertura) y
 * los dos "anti-ruido" (diarizacion oscilante y tramos de un solo snapshot).
 */
import { describe, expect, it } from 'vitest';
import {
    collapseSnapshotSpeakerRuns,
    findEmbeddedPriorSegments,
    getAsrTurnSegmentationCfg,
    isOscillatingDiarization,
    planAsrTurnSegments,
    segmentPlanCoversCapture,
    stabilizeSpeakerRuns,
} from '../src/voice/lib/asrTurnSegmentation.js';

const cfg = getAsrTurnSegmentationCfg();

/** Snapshot de identidad con vector fuerte por defecto. */
const snap = (speakerName: string, vector: number[] = [1, 0.5], reason = 'ok') => ({
    speakerName,
    signatureVector: vector,
    reason,
});

const PRIOR = 'el examen de sociales queda para el viernes';
const NOVEL_TAIL = 'entonces hoy repasamos fracciones y hacemos ejercicios practicos';
const CAPTURE = `hola profesora ${PRIOR} ${NOVEL_TAIL}`;
const runs = (...speakers: string[]) => speakers.map((speaker) => ({ speaker, weight: 2, signatureVector: [1] }));

describe('asrTurnSegmentation — configuracion', () => {
    it('el troceo esta encendido y sus umbrales son los del contrato', () => {
        expect(cfg.enabled).not.toBe(false);
        expect(cfg.minSpeakerRuns).toBeGreaterThanOrEqual(2);
        expect(cfg.minSnapshotsPerRun).toBeGreaterThanOrEqual(2);
        expect(Number(cfg.minCaptureWordsToSplit)).toBeGreaterThan(0);
        expect(Number(cfg.embeddedPriorMinChars)).toBeGreaterThan(0);
        expect(Number(cfg.minCoverageRatio)).toBeGreaterThan(0);
    });
});

describe('asrTurnSegmentation — snapshots a tramos', () => {
    it('agrupa rachas del mismo hablante y conserva el ultimo vector de la racha', () => {
        const tramos = collapseSnapshotSpeakerRuns([
            snap('Hablante 2', [1, 0]),
            snap('Hablante 2', [2, 0]),
            snap('Hablante 3', [3, 0]),
        ]);

        expect(tramos.map((t) => t.speaker)).toEqual(['Hablante 2', 'Hablante 3']);
        expect(tramos.map((t) => t.weight)).toEqual([2, 1]);
        expect(tramos[0].signatureVector).toEqual([2, 0]);
    });

    it('descarta evidencia debil: sin vector, no-audio y no-vector', () => {
        const tramos = collapseSnapshotSpeakerRuns([
            snap('Hablante 2', [], 'no-vector'),
            snap('Hablante 2', [1, 0], 'no-audio'),
            { speakerName: 'Hablante 2' },
            snap('Hablante 2', [1, 1]),
        ]);

        expect(tramos.length).toBe(1);
        expect(tramos[0].weight).toBe(1);
    });

    it('sin snapshots (o sin hablante) no hay tramos', () => {
        expect(collapseSnapshotSpeakerRuns([])).toEqual([]);
        expect(collapseSnapshotSpeakerRuns()).toEqual([]);
        expect(collapseSnapshotSpeakerRuns([snap(''), snap('   ')])).toEqual([]);
    });

    it('una racha de un solo snapshot se fusiona con la anterior (ruido, no cambio real)', () => {
        const estabilizados = stabilizeSpeakerRuns([
            { speaker: 'Hablante 2', weight: 3, signatureVector: [1] },
            { speaker: 'Hablante 3', weight: 1, signatureVector: [2] },
            { speaker: 'Hablante 2', weight: 3, signatureVector: [3] },
        ]);

        // El tramo debil no abre hablante nuevo y su vecino de la derecha se fusiona.
        expect(estabilizados.map((t) => t.speaker)).toEqual(['Hablante 2']);
        expect(estabilizados[0].weight).toBe(7);
    });

    it('una racha corta que abre el turno se queda, y la siguiente se funde en ella', () => {
        const estabilizados = stabilizeSpeakerRuns([
            { speaker: 'Hablante 2', weight: 1, signatureVector: [1] },
            { speaker: 'Hablante 3', weight: 1, signatureVector: [2] },
        ]);

        // El primer tramo no tiene vecino izquierdo: se conserva; el corto se funde.
        expect(estabilizados.map((t) => t.speaker)).toEqual(['Hablante 2']);
        expect(estabilizados[0].weight).toBe(2);
    });

    it('la diarizacion que oscila H2/H3/H2/H3 se detecta como ruido', () => {
        expect(isOscillatingDiarization(runs('H2', 'H3'))).toBe(false);
        expect(isOscillatingDiarization(runs('H2', 'H3', 'H2', 'H3'))).toBe(true);
        expect(isOscillatingDiarization(runs('H2', 'H2', 'H3', 'H3'))).toBe(false);
        expect(isOscillatingDiarization(runs('H2', 'H3', 'H4', 'H2'))).toBe(false);
    });
});

describe('asrTurnSegmentation — prior embebido', () => {
    it('encuentra la fila ya commitida dentro del texto nuevo y marca su tramo', () => {
        const found = findEmbeddedPriorSegments(CAPTURE, [PRIOR], ['Hablante 3']);

        expect(found).not.toBe(null);
        const tramos = found!.segments;
        expect(tramos.map((t) => t.text)).toEqual(['hola profesora', PRIOR, NOVEL_TAIL]);
        expect(tramos[1].skip).toBe(true);
        expect(tramos[1].speakerHint).toBe('Hablante 3');
        expect(tramos[0].speakerHint).toBe(null);
    });

    it('un prior de menos caracteres que el minimo no se considera', () => {
        expect(findEmbeddedPriorSegments('hola que tal', ['hola'], ['Hablante 2'])).toBe(null);
    });

    it('sin coincidencia (o texto vacio) no hay corte', () => {
        expect(findEmbeddedPriorSegments(CAPTURE, ['otra cosa distinta de antes'], [])).toBe(null);
        expect(findEmbeddedPriorSegments('', [PRIOR], [])).toBe(null);
        expect(findEmbeddedPriorSegments(CAPTURE, [], [])).toBe(null);
    });

    it('el prior mas largo gana cuando hay varios candidatos', () => {
        const largo = PRIOR;
        const corto = 'queda para';
        const found = findEmbeddedPriorSegments(`antes ${largo} despues`, [corto, largo], []);

        expect(found!.prior.text).toBe(largo);
    });
});

describe('asrTurnSegmentation — plan de commit', () => {
    const preflight = { snapshots: [snap('Hablante 2', [1, 0]), snap('Hablante 2', [1, 1]), snap('Hablante 3', [2, 0]), snap('Hablante 3', [2, 1])] };

    it('trocea: omite el tramo ya commitido y asigna hablantes distintos', () => {
        const plan = planAsrTurnSegments({
            phrase: CAPTURE,
            priorTexts: [PRIOR],
            priorSpeakers: ['Hablante 3'],
            preflight,
            fallbackSpeaker: 'Hablante 1',
        });

        expect(plan).toEqual([{ text: NOVEL_TAIL, speaker: 'Hablante 2' }]);
    });

    it('sin evidencia de dos hablantes (1 racha estable) no trocea', () => {
        const plan = planAsrTurnSegments({
            phrase: CAPTURE,
            priorTexts: [PRIOR],
            priorSpeakers: ['Hablante 3'],
            preflight: { snapshots: [snap('Hablante 2', [1, 0]), snap('Hablante 2', [1, 1])] },
            fallbackSpeaker: 'Hablante 1',
        });

        expect(plan).toEqual([]);
    });

    it('diarizacion oscilante: no trocea aunque haya prior embebido', () => {
        const plan = planAsrTurnSegments({
            phrase: CAPTURE,
            priorTexts: [PRIOR],
            priorSpeakers: ['Hablante 3'],
            preflight: {
                snapshots: [
                    snap('Hablante 2', [1, 0]),
                    snap('Hablante 3', [2, 0]),
                    snap('Hablante 2', [1, 1]),
                    snap('Hablante 3', [2, 1]),
                ],
            },
            fallbackSpeaker: 'Hablante 1',
        });

        expect(plan).toEqual([]);
    });

    it('un candidato corto no se trocea (por debajo de las palabras minimas)', () => {
        const plan = planAsrTurnSegments({
            phrase: 'una frase cortita',
            priorTexts: [PRIOR],
            priorSpeakers: ['Hablante 3'],
            preflight,
            fallbackSpeaker: 'Hablante 1',
        });

        expect(plan).toEqual([]);
    });

    it('un prior VALIDO en el arranque del texto tambien corta (el tramo nuevo es lo que sigue)', () => {
        const plan = planAsrTurnSegments({
            phrase: CAPTURE,
            priorTexts: ['hola profesora'],
            priorSpeakers: ['Hablante 3'],
            preflight,
            fallbackSpeaker: 'Hablante 1',
        });

        expect(plan).toEqual([{ text: `${PRIOR} ${NOVEL_TAIL}`, speaker: 'Hablante 2' }]);
    });

    it('sin preflight no hay troceo: el snapshot es la evidencia', () => {
        const plan = planAsrTurnSegments({
            phrase: CAPTURE,
            priorTexts: [PRIOR],
            priorSpeakers: ['Hablante 3'],
            preflight: null,
            fallbackSpeaker: 'Hablante 1',
        });

        expect(plan).toEqual([]);
    });

    it('la cobertura del plan se mide con el umbral del contrato', () => {
        const plan = [{ text: NOVEL_TAIL, speaker: 'Hablante 2' }];

        expect(segmentPlanCoversCapture(plan, NOVEL_TAIL, cfg.minCoverageRatio)).toBe(true);
        expect(segmentPlanCoversCapture(plan, `${NOVEL_TAIL} y ademas un monton de texto nuevo mas`, cfg.minCoverageRatio)).toBe(false);
        // Sin plan o sin captura no hay nada que cubrir: no se descarta.
        expect(segmentPlanCoversCapture([], CAPTURE, cfg.minCoverageRatio)).toBe(true);
        expect(segmentPlanCoversCapture(plan, '', cfg.minCoverageRatio)).toBe(true);
    });
});
