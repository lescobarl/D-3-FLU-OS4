/**
 * Espera previa al LANZAMIENTO de un turno de voz (debounce de fragmentos).
 *
 * Defecto medido: el turno se lanza tras una espera FIJA (wake 3 s / interim
 * 1,4 s) aunque la frase ya sea un comando completo. Como el cronómetro del turno
 * arranca DESPUÉS, esa espera quedaba invisible y se atribuía a "la IA tarda".
 *
 * Este módulo es la fuente única del cálculo (antes estaba embebido en el hook):
 * - base: wake o interim, según cómo llegó el comando.
 * - dictado: si el usuario sigue hablando (frase larga), amplía el margen.
 *   SOLO en modo continuo (sin wake): un comando con wake ("Okay Flow …") es una
 *   orden explícita, no un dictado, y pagaba igual la gracia. Medido con una frase
 *   real de 10 palabras: 3000 ms de base + 1760 ms de gracia = 4760 ms ANTES de
 *   que el turno existiera, invisibles para el cronómetro del turno (se leían
 *   como "la IA tarda").
 * - comando incompleto: nunca lanzar antes del margen de espera.
 * Todos los números vienen de `timingCfg` (config): aquí no hay literales.
 *
 * @param {{ turnPhrase?: string, wakeWordMatched?: boolean, ready?: boolean,
 *           timingCfg?: { wakeWordCommandDelayMs?: number, interimCommandDelayMs?: number,
 *                         incompleteCommandWaitMs?: number, dictationGraceWords?: number,
 *                         dictationGraceBaseMs?: number, dictationGracePerWordMs?: number,
 *                         dictationGraceMaxMs?: number } }} input
 * @returns {{ delayMs: number, origin: 'wake'|'interim', baseMs: number, dictationExtraMs: number, wordCount: number }}
 */
export function resolvePreLaunchDelay({ turnPhrase, wakeWordMatched, ready, timingCfg = {} } = {}) {
  const baseMs = wakeWordMatched ? timingCfg.wakeWordCommandDelayMs : timingCfg.interimCommandDelayMs;
  const origin = wakeWordMatched ? 'wake' : 'interim';
  const wordCount = String(turnPhrase || '').trim().split(/\s+/).filter(Boolean).length;

  let dictationExtraMs = 0;
  // La gracia de dictado es para el modo CONTINUO (el usuario dicta una lista y
  // hace pausas). Un comando con wake es una orden cerrada: no la paga.
  if (!wakeWordMatched && wordCount >= (timingCfg.dictationGraceWords || 0)) {
    dictationExtraMs = Math.min(
      (timingCfg.dictationGraceBaseMs || 0) +
        (wordCount - (timingCfg.dictationGraceWords || 0)) * (timingCfg.dictationGracePerWordMs || 0),
      timingCfg.dictationGraceMaxMs || 0,
    );
  }

  let delayMs = (baseMs || 0) + dictationExtraMs;
  if (ready === false) {
    delayMs = Math.max(delayMs, timingCfg.incompleteCommandWaitMs || 0);
  }

  return { delayMs, origin, baseMs: baseMs || 0, dictationExtraMs, wordCount };
}
