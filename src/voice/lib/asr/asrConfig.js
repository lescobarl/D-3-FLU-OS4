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
