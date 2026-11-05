// ============================================================
// fluTranscriptMotor - lectores de config del motor de transcripcion (0%)
// ------------------------------------------------------------
// Frontera sustituida: FLU_CONFIG (config unica). Se muta su objeto para
// probar cada lector real: devuelve la rama configurada o exige su presencia
// (sin fallbacks numericos) y normaliza el set de palabras clave cortas.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ FLU_CONFIG: {} as Record<string, unknown> }));

vi.mock('../src/voice/lib/fluConfig.js', () => ({ FLU_CONFIG: env.FLU_CONFIG }));

import {
    getSpeakerThresholdsCfg,
    getIngressGuardsCfg,
    getSpeechMergeCfg,
    getFluTimingCfg,
    getShortFinalKeywordSet,
} from '../src/voice/lib/fluTranscriptMotor.js';

const CONFIG = {
    voiceIdentity: {
        capture: {
            conversationSpeakerThresholds: { speaker: 0.7 },
        },
    },
    transcript: {
        ingressGuards: { maxChars: 500 },
        speechMerge: { shortFinalKeywords: [' Si ', 'Pan', ''] },
    },
    timing: { turnoMs: 1000 },
};

/** Reinstala una copia limpia de la config en el MISMO objeto (identidad estable). */
const restaurar = () => {
    Object.assign(env.FLU_CONFIG, JSON.parse(JSON.stringify(CONFIG)) as Record<string, unknown>);
};

/** Nodo padre de un path; permite get/set sin atravesar tipos estrictos. */
const nodoPadre = (path: string[]): Record<string, unknown> => {
    let actual = env.FLU_CONFIG;
    for (const clave of path.slice(0, -1)) {
        actual = actual[clave] as Record<string, unknown>;
    }
    return actual;
};

/** Lee el valor real apuntado por un path (para comparar por identidad). */
const leer = (path: string[]): unknown => nodoPadre(path)[path[path.length - 1]];

/** Objeto speechMerge (la rama que consume getShortFinalKeywordSet). */
const mergeCfg = () =>
    (env.FLU_CONFIG.transcript as Record<string, unknown>).speechMerge as Record<string, unknown>;

interface Lector {
    leer: () => unknown;
    path: string[];
    mensaje: string;
}

const LECTORES: Lector[] = [
    {
        leer: () => getSpeakerThresholdsCfg(),
        path: ['voiceIdentity', 'capture', 'conversationSpeakerThresholds'],
        mensaje: 'fluConfig.voiceIdentity.capture.conversationSpeakerThresholds es obligatorio',
    },
    {
        leer: () => getIngressGuardsCfg(),
        path: ['transcript', 'ingressGuards'],
        mensaje: 'fluConfig.transcript.ingressGuards es obligatorio',
    },
    {
        leer: () => getSpeechMergeCfg(),
        path: ['transcript', 'speechMerge'],
        mensaje: 'fluConfig.transcript.speechMerge es obligatorio',
    },
    {
        leer: () => getFluTimingCfg(),
        path: ['timing'],
        mensaje: 'fluConfig.timing es obligatorio',
    },
];

beforeEach(restaurar);

// ------------------------------------------------------------
// Bloque: cada lector devuelve la rama configurada
// ------------------------------------------------------------
describe('fluTranscriptMotor - lectores devuelven la config', () => {
    it('getSpeakerThresholdsCfg devuelve la rama de umbrales de hablantes', () => {
        expect(getSpeakerThresholdsCfg()).toBe(leer(['voiceIdentity', 'capture', 'conversationSpeakerThresholds']));
    });

    it('getIngressGuardsCfg devuelve los guards de ingreso', () => {
        expect(getIngressGuardsCfg()).toBe(leer(['transcript', 'ingressGuards']));
    });

    it('getSpeechMergeCfg devuelve la config de merge de voz', () => {
        expect(getSpeechMergeCfg()).toBe(leer(['transcript', 'speechMerge']));
    });

    it('getFluTimingCfg devuelve la config de tiempos', () => {
        expect(getFluTimingCfg()).toBe(leer(['timing']));
    });
});

// ------------------------------------------------------------
// Bloque: exigencia de config (sin fallbacks en codigo)
// ------------------------------------------------------------
describe('fluTranscriptMotor - config obligatoria', () => {
    it('cada lector lanza su mensaje exacto si falta su rama', () => {
        for (const { leer: lector, path, mensaje } of LECTORES) {
            restaurar();
            nodoPadre(path)[path[path.length - 1]] = undefined;
            expect(() => lector()).toThrow(mensaje);
        }
    });

    it('cada lector rechaza una rama que no es objeto', () => {
        for (const { leer: lector, path, mensaje } of LECTORES) {
            restaurar();
            nodoPadre(path)[path[path.length - 1]] = 'texto';
            expect(() => lector()).toThrow(mensaje);
        }
    });
});

// ------------------------------------------------------------
// Bloque: palabras clave para filas cortas
// ------------------------------------------------------------
describe('fluTranscriptMotor - getShortFinalKeywordSet', () => {
    it('normaliza a minusculas, recorta y descarta vacios', () => {
        expect([...getShortFinalKeywordSet()]).toEqual(['si', 'pan']);
    });

    it('deduplica variantes con distinto caso gracias al Set', () => {
        mergeCfg().shortFinalKeywords = ['Pan', 'pan', 'PAN'];
        expect([...getShortFinalKeywordSet()]).toEqual(['pan']);
    });

    it('devuelve un set vacio si la clave no es una lista', () => {
        mergeCfg().shortFinalKeywords = 'texto';
        expect(getShortFinalKeywordSet().size).toBe(0);
    });

    it('propaga el error si falta la config de merge', () => {
        (env.FLU_CONFIG as Record<string, unknown>).transcript = undefined;
        expect(() => getShortFinalKeywordSet()).toThrow('fluConfig.transcript.speechMerge es obligatorio');
    });
});
