/**
 * Defaults de ASIGNACION de hablante (fase 1 de diarizacion) y de la guardia de
 * identidad del renombre por clave.
 *
 * POR QUE ES UN MODULO HOJA: `fluConfig.js` esta en el techo del trinquete de tamano
 * (`tests/godFileSizeGuard.test.ts`), asi que los valores viven aqui UNA vez y el config
 * los importa como VALOR (`...SPEAKER_ASSIGN.thresholds`), igual que `asr/asrDefaults.js`
 * con el VAD. Los getters (`differentVoiceFloor`, `namedAssignFloor`, `namedAssignMargin`)
 * usan estos mismos valores como respaldo: cero literales duplicados.
 *
 * BANDAS MEDIDAS (debug.log del dueno): MISMA voz 0.69-0.74; voz DISTINTA 0.50-0.58.
 * Cualquier umbral nuevo tiene que caer entre esas dos bandas o el predicado no separa.
 */

/** Nombre propio: piso y margen de la ASIGNACION (no del ancla registrada). */
const THRESHOLDS = Object.freeze({
  /**
   * Piso de "esta fila es de una voz CLARAMENTE distinta": por debajo (banda de voz
   * distinta) el renombre por clave NO toca la fila aunque comparta `speakerId`.
   */
  differentVoiceFloor: 0.58,
  /**
   * Piso para AFIRMAR un nombre propio con la medida del turno: banda ALTA de la misma
   * voz. Un nombre no se afirma con una similitud de compromiso.
   */
  namedAssignFloor: 0.74,
  /** Margen que el nombre debe sacar al mejor cluster ALTERNATIVO de la sesion. */
  namedAssignMargin: 0.08,
})

/** Que audio del turno se mide (fase 1: el ultimo tramo contiguo de voz). */
const TURN_WINDOW = Object.freeze({
  /**
   * Medir el ULTIMO TRAMO CONTIGUO DE VOZ del turno en vez de los 2 s completos: un turno
   * con dos voces promediaba ambas y arrastraba el nombre del primario (0.894 medido).
   */
  conversationTurnLastVoicedSpan: true,
  /** Pausa (ms) que separa dos tramos de voz del mismo turno. */
  conversationTurnVoicedGapMs: 500,
  /**
   * Tope de medidas que el ledger de la SESION conserva (una por snapshot). Vive aqui, con
   * los demas knobs de la medida del turno, porque es eso: cuanto audio medido se recuerda
   * para recalcular las filas INCIERTAS cuando aparece un cluster nuevo.
   */
  preflightLedgerMax: 240,
})

/** Etiquetas de la asignacion. */
const LABELS = Object.freeze({
  /**
   * Etiqueta PROVISIONAL del turno mientras su voz no esta medida. NO es un nombre propio
   * ni una etiqueta automatica `Hablante N`: dice "no se sabe todavia", asi que tampoco
   * hereda el nombre del turno anterior ni el del participante primario.
   */
  pendingSpeaker: 'Hablante ?',
})

export const SPEAKER_ASSIGN = Object.freeze({
  ...THRESHOLDS,
  ...TURN_WINDOW,
  ...LABELS,
  thresholds: THRESHOLDS,
  turnWindow: TURN_WINDOW,
  labels: LABELS,
})
