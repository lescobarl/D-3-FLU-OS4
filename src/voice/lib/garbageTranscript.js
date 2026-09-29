// ============================================================
// garbageTranscript.js — Guard anti-alucinación del Web Speech API
// ------------------------------------------------------------
// El Web Speech API (Chrome) alucina frases cortas e incoherentes
// cuando NO hay habla real (silencio). Este guard descarta ese
// tipo de "basura" SIN bajar la sensibilidad del reconocedor:
//   - repetición adyacente de palabra corta ("se se", "bor bor") → tartamudeo;
//   - ratio alto de tokens "no-palabra" (sin vocal) → ruido.
// Se aplica en el ÚNICO punto de commit (§9) de la locución.
// ============================================================

/**
 * Longitud máxima de palabra para la que una repetición adyacente cuenta como
 * tartamudeo del ASR («se se», «bor bor»). Una palabra LARGA repetida
 * («hola hola») es una repetición deliberada del usuario: descartarla dejaba la
 * frase visible en ÚLTIMA FRASE pero sin fila en la conversación, porque el
 * preview no pasa por este guard y el commit sí.
 */
const STUTTER_MAX_WORD_CHARS = 3

/**
 * ¿La frase es "basura" (alucinación ASR) y debe descartarse?
 * Conservador a propósito: solo descarta basura CLARA para no perder
 * habla real bajita (salón de clases / sala de juntas).
 */
export function classifyGarbageTranscript(text = '') {
  const t = String(text || '').trim()
  if (!t) return { garbage: true, reason: 'empty' }

  const words = t
    .toLowerCase()
    .replace(/[¿?¡!.,;:()\[\]"'’`]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) return { garbage: true, reason: 'empty' }

  // 1) Repeticion exacta adyacente de palabra corta ("se se", "bor bor") -> tartamudeo.
  //    `repiteDominante` separa la alucinacion (la frase ES la repeticion: "se se")
  //    del habla natural ("...ya esta lista no no", "ahora si si"), donde la
  //    repeticion es un detalle dentro de una frase real. Lo consume
  //    `resolveCommittablePhrase` para NO callar el turno en el segundo caso.
  let repeticionesCortas = 0
  for (let i = 1; i < words.length; i += 1) {
    if (words[i] === words[i - 1] && words[i].length <= STUTTER_MAX_WORD_CHARS) repeticionesCortas += 1
  }
  if (repeticionesCortas > 0) {
    return {
      garbage: true,
      reason: 'stutter',
      repiteDominante: repeticionesCortas * 2 >= words.length,
    }
  }

  // 2) Ratio de tokens "no-palabra" (sin vocal) alto → ruido incoherente.
  let nonWord = 0
  for (const w of words) {
    const letters = w.replace(/[^a-záéíóúüñ]/g, '')
    if (!letters || !/[aeiouáéíóúü]/.test(letters)) nonWord += 1
  }

  // Exigimos al menos 2 palabras para no rechazar una palabra suelta legítima.
  if (words.length < 2) return { garbage: false, reason: null }
  return nonWord / words.length >= 0.6
    ? { garbage: true, reason: 'nonword' }
    : { garbage: false, reason: null }
}

/**
 * ¿La frase es "basura" (alucinación ASR)? Se conserva como predicado booleano
 * por compatibilidad; el criterio vive una sola vez en `classifyGarbageTranscript`.
 */
export function looksLikeGarbageTranscript(text = '') {
  return classifyGarbageTranscript(text).garbage
}

/**
 * Resuelve QUÉ frase se commitea cuando la captura cruda del ASR puede venir
 * corrupta: si la captura es basura, el turno NO se descarta — se usa el texto
 * VALIDADO del turno (`fallback`, ya derivado por el motor de voz) para que la
 * locución no se pierda ni quede muda. Solo devuelve frase vacía cuando tampoco
 * hay texto validado, y SIEMPRE informa el motivo (nunca falla en silencio).
 */
export function resolveCommittablePhrase(capture = '', fallback = '') {
  const primary = String(capture || '').trim()
  const verdict = classifyGarbageTranscript(primary)
  if (!verdict.garbage) return { phrase: primary, usedFallback: false, reason: null }

  const alternative = String(fallback || '').trim()
  if (!classifyGarbageTranscript(alternative).garbage) {
    return { phrase: alternative, usedFallback: true, reason: verdict.reason }
  }

  // Sin texto validado al que caer. El veredicto 'stutter' NO basta por si solo para
  // callar el turno: solo es senal fuerte cuando la repeticion DOMINA la frase
  // ("se se", "bor bor" = alucinacion del ASR). Si la repeticion es un detalle
  // dentro de una frase real ("no no", "ahi ahi", "si si") se commitea lo que dijo
  // el usuario. Medido en el log real del dueno: 3 capturas humanas de 3 acabaron
  // MUDAS por esta via (fallback vacio -> phrase vacia -> turno sin habla).
  // 'nonword' (sin vocales) y 'empty' SI son ruido claro: siguen descartandose.
  if (verdict.reason === 'stutter' && !verdict.repiteDominante) {
    return { phrase: primary, usedFallback: false, reason: verdict.reason }
  }
  return { phrase: '', usedFallback: false, reason: verdict.reason }
}
