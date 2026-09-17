// ============================================================
// garbageTranscript.js — Guard anti-alucinación del Web Speech API
// ------------------------------------------------------------
// El Web Speech API (Chrome) alucina frases cortas e incoherentes
// cuando NO hay habla real (silencio). Este guard descarta ese
// tipo de "basura" SIN bajar la sensibilidad del reconocedor:
//   - repetición exacta adyacente ("se se", "bor bor") → tartamudeo;
//   - ratio alto de tokens "no-palabra" (sin vocal) → ruido.
// Se aplica en el ÚNICO punto de commit (§9) de la locución.
// ============================================================

/**
 * ¿La frase es "basura" (alucinación ASR) y debe descartarse?
 * Conservador a propósito: solo descarta basura CLARA para no perder
 * habla real bajita (salón de clases / sala de juntas).
 */
export function looksLikeGarbageTranscript(text = '') {
  const t = String(text || '').trim()
  if (!t) return true

  const words = t
    .toLowerCase()
    .replace(/[¿?¡!.,;:()\[\]"'’`]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) return true

  // 1) Repetición exacta adyacente ("se se", "bor bor") → tartamudeo.
  for (let i = 1; i < words.length; i += 1) {
    if (words[i] === words[i - 1]) return true
  }

  // 2) Ratio de tokens "no-palabra" (sin vocal) alto → ruido incoherente.
  let nonWord = 0
  for (const w of words) {
    const letters = w.replace(/[^a-záéíóúüñ]/g, '')
    if (!letters || !/[aeiouáéíóúü]/.test(letters)) nonWord += 1
  }

  // Exigimos al menos 2 palabras para no rechazar una palabra suelta legítima.
  if (words.length < 2) return false
  return nonWord / words.length >= 0.6
}
