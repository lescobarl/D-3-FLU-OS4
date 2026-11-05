/**
 * asrDefaults — DEFAULTS UNICOS del VAD y del fallback local del ASR.
 *
 * DEFECTO (revision 2026-10-21): los mismos numeros existian DOS veces: como
 * valores de `FLU_CONFIG` y como respaldos literales dentro de los getters
 * (`getSilentDegradeConfig`, `getLocalFallbackRuntimeConfig`, `VAD_DEFAULTS`).
 * Que un test comparara ambas copias no quita el hardcode: eran dos fuentes.
 *
 * Aqui vive UNA sola definicion y la importan los dos lados:
 *   - `fluConfig.js` la usa como VALOR de sus bloques (config = los defaults);
 *   - `asrConfig.js` y `voiceLocalFallback.js` la usan como RESPALDO si la config
 *     llega incompleta (p. ej. una config inyectada en un test).
 *
 * Sin imports: este modulo es HOJA (lo importan config y lectores sin crear ciclo).
 */

/**
 * @typedef {{
 *   frameMs: number, energyThreshold: number, minSpeechMs: number, minSilenceMs: number,
 *   maxSegmentMs: number, preRollMs: number, speechLikeZcrMin: number, speechLikeZcrMax: number,
 *   speechLikeModulationMin: number, speechLikeModulationFloorRatio: number,
 * }} VadDefaults
 */

/** Defaults del VAD: trama, piso de energia y criterio de HABLA. @type {VadDefaults} */
export const VAD_DEFAULTS = Object.freeze({
  frameMs: 30,
  energyThreshold: 0.02,
  /** Voz minima para abrir turno (ms). */
  minSpeechMs: 450,
  /** Silencio para cerrar turno (ms). */
  minSilenceMs: 900,
  /** Turno maximo antes de forzar corte (ms). */
  maxSegmentMs: 8000,
  /** Audio previo al inicio de voz que se incluye en el turno (ms). */
  preRollMs: 180,
  /** ZCR minimo de una trama con voz: un DC/tono constante NO cruza por cero. */
  speechLikeZcrMin: 0.01,
  /** ZCR maximo: el ruido blanco esta cerca de 0.5 y NO es voz. */
  speechLikeZcrMax: 0.4,
  /** Ratio de energia entre tramas: la voz modula (silabas), el tono no. */
  speechLikeModulationMin: 1.15,
  /** Piso del ratio de modulacion (fraccion de la media; evita division por cero). */
  speechLikeModulationFloorRatio: 0.15,
})

/**
 * @typedef {{
 *   silentDegradeMs: number, silentDegradeStallMarginMs: number, silentDegradeRebuilds: number,
 *   silentDegradeMinSpeechLikeMs: number, silentDegradeEvalMinMs: number,
 *   localRecoveryMs: number, localRecoverySegments: number, localRecoveryProbeMs: number,
 *   finalMinSpeechLikeMs: number, partialMinSpeechLikeMs: number,
 * }} LocalFallbackDefaults
 */

/** Defaults del fallback local: degradacion, recuperacion y gate. @type {LocalFallbackDefaults} */
export const LOCAL_FALLBACK_DEFAULTS = Object.freeze({
  silentDegradeMs: 12000,
  silentDegradeStallMarginMs: 1000,
  silentDegradeRebuilds: 2,
  silentDegradeMinSpeechLikeMs: 600,
  silentDegradeEvalMinMs: 1000,
  localRecoveryMs: 20000,
  localRecoverySegments: 3,
  localRecoveryProbeMs: 4000,
  finalMinSpeechLikeMs: 180,
  partialMinSpeechLikeMs: 300,
})
