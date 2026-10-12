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

/** Bloque `FLU_CONFIG.transcript.asr` (vacio si la config no lo declara). */
export function getAsrConfig() {
    return FLU_CONFIG.transcript?.asr || {};
}

/**
 * RESPALDOS del bloque VAD — dueno UNICO (un dato, un sitio).
 *
 * P9.72: el segmentador (`voiceActivitySegmenter.js`) caia a `30` / `0.012` por su cuenta y el
 * conteo de VOZ (`voicedActivity.js`) a `20` / `0.02`: si el bloque VAD desaparecia de la config,
 * los dos consumidores del MISMO dato volvian a divergir. El respaldo vive aqui, junto al lector.
 */
export const VAD_DEFAULTS = Object.freeze({ frameMs: 30, energyThreshold: 0.02 });

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
