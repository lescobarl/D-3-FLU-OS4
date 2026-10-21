/**
 * asrConfig — dueno unico de la lectura de la configuracion del ASR.
 *
 * DUENO UNICO (auditoria de codigo 2026-10-02): el segmentador de actividad de voz
 * y el worker de Whisper tenian cada uno su copia de `getAsrConfig()` con el mismo
 * cuerpo (`FLU_CONFIG.transcript?.asr || {}`). Vive aqui para que los dos lean la
 * MISMA config (si cambia la forma del bloque, cambia en un sitio).
 *
 * Vive en su propio modulo, y no en el segmentador, para que el worker pueda
 * importarlo sin arrastrar la logica del VAD a su bundle.
 */
import { FLU_CONFIG } from '../fluConfig.js';
import { VAD_DEFAULTS } from './asrDefaults.js';

// Una sola definicion (asrDefaults.js); se re-exporta para no romper la API.
export { VAD_DEFAULTS };

/** Bloque `FLU_CONFIG.transcript.asr` (vacio si la config no lo declara). */
export function getAsrConfig() {
    return FLU_CONFIG.transcript?.asr || {};
}

// Los RESPALDOS del VAD viven en `asrDefaults.js` (una sola definicion,
// compartida con `fluConfig`). Aqui solo se leen.

/**
 * Numero de config con respaldo UNICO. A diferencia de `Number(x) || fallback`,
 * respeta el `0` legitimo (`preRollMs: 0` es una trama valida, no "sin valor").
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function numberOr(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Bloque de SEGMENTACION del VAD (trama, piso, apertura/cierre, pre-roll).
 * Un solo lector para el segmentador; los respaldos viven en `VAD_DEFAULTS`.
 *
 * @param {object} [config] Bloque `transcript.asr.vad` de la config.
 * @returns {{ frameMs: number, energyThreshold: number, minSpeechMs: number, minSilenceMs: number, maxSegmentMs: number, preRollMs: number }}
 */
export function getVadSegmentConfig(config = getAsrConfig().vad || {}) {
    return {
        frameMs: getVadFrameMs(config),
        energyThreshold: getVadEnergyThreshold(config),
        minSpeechMs: Math.max(0, numberOr(config.minSpeechMs, VAD_DEFAULTS.minSpeechMs)),
        minSilenceMs: Math.max(0, numberOr(config.minSilenceMs, VAD_DEFAULTS.minSilenceMs)),
        maxSegmentMs: Math.max(0, numberOr(config.maxSegmentMs, VAD_DEFAULTS.maxSegmentMs)),
        preRollMs: Math.max(0, numberOr(config.preRollMs, VAD_DEFAULTS.preRollMs)),
    };
}

/** Trama del VAD (ms): config, o el respaldo unico. */
export function getVadFrameMs(config = getAsrConfig().vad || {}) {
    const value = Number(config.frameMs);
    return value > 0 ? value : VAD_DEFAULTS.frameMs;
}

/** Umbral de energia RMS para considerar voz: config, o el respaldo unico. */
export function getVadEnergyThreshold(config = getAsrConfig().vad || {}) {
    const value = Number(config.energyThreshold);
    return value > 0 ? value : VAD_DEFAULTS.energyThreshold;
}

/**
 * Umbrales de HABLA (no solo energia) de una trama: RMS + ZCR + modulacion.
 *
 * DUENO UNICO del dato: los consumen el contador de voz (`voicedActivity.js`), el
 * segmentador (etiqueta `speechLikeMs` del turno) y la decision de degradar por
 * SR mudo (`voiceLocalFallback.resolveSilentDegrade`). Sin copias por consumidor.
 *
 * @param {object} [config] Bloque `transcript.asr.vad` de la config.
 * @returns {{ zcrMin: number, zcrMax: number, modulationMin: number, modulationFloorRatio: number }}
 */
export function getVadSpeechLikeConfig(config = getAsrConfig().vad || {}) {
    const zcrMin = Number(config.speechLikeZcrMin);
    const zcrMax = Number(config.speechLikeZcrMax);
    const modulationMin = Number(config.speechLikeModulationMin);
    const modulationFloorRatio = Number(config.speechLikeModulationFloorRatio);
    return {
        zcrMin: zcrMin > 0 ? zcrMin : VAD_DEFAULTS.speechLikeZcrMin,
        zcrMax: zcrMax > 0 ? zcrMax : VAD_DEFAULTS.speechLikeZcrMax,
        modulationMin: modulationMin > 0 ? modulationMin : VAD_DEFAULTS.speechLikeModulationMin,
        modulationFloorRatio: modulationFloorRatio > 0 ? modulationFloorRatio : VAD_DEFAULTS.speechLikeModulationFloorRatio,
    };
}
