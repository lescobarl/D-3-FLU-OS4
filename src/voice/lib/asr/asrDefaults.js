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

/**
 * @typedef {{
 *   enabled: boolean, modelId: string, timeoutMs: number, sidecarProbeMs: number,
 *   minPalabras: number, minPalabrasPorSegundo: number, minVozMs: number,
 *   minAudioSegundos: number, maxPalabrasPorSegundo: number, minPalabrasUnicasRatio: number,
 * }} LocalFinalDefaults
 */

/**
 * Defaults del RESPALDO LOCAL por TRAMO (docs/CONTRATO-ASR-LOCAL.md): Whisper
 * solo cuando el final de Chrome es vacio o implausible para el audio del tramo,
 * y su texto pasa una puerta anti-alucinacion antes de tocar la fila.
 *
 * Los umbrales NO son inventados: salen de la grabacion de referencia b6d82bca
 * (2026-11-13) y de la medida ya declarada del proyecto.
 *  - `minPalabrasPorSegundo: 1` separa los tramos fallidos medidos (0,34 y
 *    0,24 palabras/s en c7013264/2ea145a2) de los sanos (2,84 y 5,31).
 *  - `maxPalabrasPorSegundo: 8` deja margen sobre el maximo humano medido
 *    (5,31 pal/s en ef5f8a23) y rechaza texto imposible para el audio.
 *  - `minVozMs: 350` es el piso de voz YA medido del proyecto
 *    (conversationMinVoicedMs): el hueco sin voz 67-95 s de b6d82bca midio
 *    120 ms de voz y no se transcribe («Back to the cojo» no entra).
 *  - `timeoutMs: 8000` lo fijo el dueno (VoBo 2026-11-14, opcion c): tope por
 *    VENTANA de 12 s con faster-whisper small en CPU, que midio 3,3–5,4 s por
 *    ventana (§5-quinquies); 8 s deja margen sin retrasar el turno. Era 12000
 *    con el modelo WASM tiny/base, que ya no es la ruta del producto.
 *  - `sidecarProbeMs: 1500`: tope de la sonda `/salud` del servicio local. Un
 *    sidecar apagado no se espera mas: la fila se queda con Chrome.
 *  - `minPalabrasUnicasRatio: 0.5`: un bucle del decoder reduce las palabras
 *    unicas muy por debajo de la mitad (colapso del dueno `speechMerge`).
 * @type {LocalFinalDefaults}
 */
export const LOCAL_FINAL_DEFAULTS = Object.freeze({
  /**
   * ENCENDIDO en el camino vivo (2026-11-14): el sidecar nativo
   * faster-whisper `small` (CPU int8, 8 hilos, beam 1, ventanas de 12 s)
   * pasó la validación real de §5-nonies del contrato: 6 ventanas de
   * b6d82bca, fila = texto del sidecar, puerta aceptada, un `row.committed`
   * por ventana y 4,7–6,3 s por ventana (< `timeoutMs` 8000). Antes estaba
   * apagado porque con `tiny` el respaldo sustituía frases cortas CORRECTAS
   * de Chrome por texto garbled medido (§5-bis).
   */
  enabled: true,
  /** Modelo del motor WASM (escucha viva y laboratorio), NO del respaldo por
   *  tramo: con `tiny` el respaldo sustituía frases cortas correctas de Chrome
   *  por texto garbled (§5-bis). El camino del producto es el sidecar nativo,
   *  que posee su propio modelo (small) y no lo recibe de esta config. Se
   *  conserva tal cual porque el motor WASM y su lab siguen vivos. */
  modelId: 'Xenova/whisper-tiny',
  timeoutMs: 8000,
  /**
   * Tope de la sonda de salud del sidecar local (`GET /salud`). Si el servicio
   * no responde en este tiempo, el respaldo por tramo queda deshabilitado y
   * Chrome manda; no se espera en el cierre.
   */
  sidecarProbeMs: 1500,
  minPalabras: 4,
  minPalabrasPorSegundo: 1,
  minVozMs: 350,
  /**
   * MÍNIMO de audio para pedir el respaldo (s). Medido en §5-quinquies del
   * contrato: una ventana de 1,09 s paga el encoder fijo de 30 s + prompt y
   * tardó 9,3–21,7 s (secuencial) — no es una ventana de producto. Por debajo
   * de 3 s el disparador NO invoca el local (Chrome cierra el tramo). 0 = sin
   * mínimo (solo pruebas).
   */
  minAudioSegundos: 3,
  maxPalabrasPorSegundo: 8,
  minPalabrasUnicasRatio: 0.5,
})

/** Defaults del fallback local: degradacion, recuperacion y gate. @type {LocalFallbackDefaults} */
export const LOCAL_FALLBACK_DEFAULTS = Object.freeze({
  silentDegradeMs: 12000,
  silentDegradeStallMarginMs: 1000,
  silentDegradeRebuilds: 2,
  /**
   * Reinicios seguidos del reconocedor SIN un solo final: prueba de motor vivo y
   * mudo (no vuelve por sí mismo). Medido en la sesión real d702 (2026-11-08):
   * 13 reinicios seguidos sin un `asrFinal` antes de quedarse sin transcribir.
   */
  silentDegradeDeadRebuilds: 13,
  silentDegradeMinSpeechLikeMs: 600,
  silentDegradeEvalMinMs: 1000,
  localRecoveryMs: 20000,
  localRecoverySegments: 3,
  localRecoveryProbeMs: 4000,
  finalMinSpeechLikeMs: 180,
  partialMinSpeechLikeMs: 300,
})
