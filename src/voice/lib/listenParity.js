import { cleanForSpeech } from './audioMath.js'
import { utterancesRelate } from './conversationStream.js'

/**
 * Paridad Última frase ↔ última fila del log (sin pérdida visible).
 */
export function evaluateListenParity({ live = '', lastLog = '' } = {}) {
  const preview = cleanForSpeech(live)
  const committed = cleanForSpeech(lastLog)

  if (!preview || !committed) {
    return { ok: true, level: 'idle', message: '' }
  }

  if (
    preview === committed ||
    preview.toLowerCase() === committed.toLowerCase() ||
    committed.includes(preview) ||
    preview.includes(committed) ||
    utterancesRelate(preview, committed)
  ) {
    return { ok: true, level: 'ok', message: '' }
  }

  const gap = Math.abs(preview.length - committed.length)
  if (gap <= 6) {
    return { ok: true, level: 'ok', message: '' }
  }

  return {
    ok: false,
    level: 'warn',
    message: 'Última frase y log difieren — revisa captura',
  }
}
