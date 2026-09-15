/**
 * Shim de compatibilidad (NO contiene implementación).
 *
 * `assignSpeakerStrictCosine` fue absorbido por `assignSpeaker` en speakerCore.js.
 * Este alias se conserva ÚNICAMENTE para no romper la importación del test de
 * comportamiento congelado (tests/speakerSoloCoalesce.test.ts). La única fuente
 * de la lógica es speakerCore.js.
 */
export { assignSpeaker as assignSpeakerStrictCosine } from './speakerCore.js'
