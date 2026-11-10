import { matchWakeWordPrefix, splitTranscriptAtWakeWord } from '../lib/audioMath'

/**
 * Pega al final la wake que el ASR partió en el intermedio previo.
 *
 * Único dueño de la wake partida; consumidor único: `useFluVoiceAssistant`.
 * No inventa comandos: solo reusa la wake del splitter y la adjunta al mismo
 * enunciado cuando el final llega sin ella. El evento del motor recibe el
 * item final ya cosido para que fila y contrato salgan de la MISMA frase.
 * @param {object} entrada
 * @param {string} [entrada.interim] Intermedio del evento (puede traer la wake).
 * @param {string} [entrada.finalText] Final del evento.
 * @param {{ wakeWord: string, at: number }} [entrada.wakePendiente] Wake retenida.
 * @param {string[]} [entrada.wakeWords] Wake words efectivas.
 * @param {number} [entrada.ahora] Marca de tiempo del resultado.
 * @param {number} [entrada.wakePendingMs] Ventana de vigencia.
 * @param {object} [entrada.evento] Evento ASR original.
 * @param {number} [entrada.desdeResultado] Índice de resultados nuevos.
 * @returns {{ finalText: string, wakePendiente: { wakeWord: string, at: number }, evento: object }}
 * @revisor CREAR NUEVO — la wake partida no tenía dueño; el hook la consumía inline.
 */
export function aplicarWakePendiente({
  interim = '',
  finalText = '',
  wakePendiente,
  wakeWords = [],
  ahora = Date.now(),
  wakePendingMs = 0,
  evento = null,
  desdeResultado = 0,
} = {}) {
  let pendiente = wakePendiente || { wakeWord: '', at: 0 }
  if (interim) {
    const wake = matchWakeWordPrefix(interim, wakeWords)
    if (wake) pendiente = { wakeWord: wake, at: ahora }
  }

  let texto = finalText
  let wakeAplicada = ''
  if (texto) {
    const vigente = Boolean(pendiente.wakeWord) && ahora - pendiente.at <= Number(wakePendingMs || 0)
    const split = splitTranscriptAtWakeWord(texto, wakeWords)
    const soloWake = split.wakeWordMatched && !String(split.commandText || '').trim()
    if (vigente && !split.wakeWordMatched && !soloWake) {
      texto = `${pendiente.wakeWord} ${texto}`.trim()
      wakeAplicada = pendiente.wakeWord
      pendiente = { wakeWord: '', at: 0 }
    } else if (split.wakeWordMatched && !soloWake) {
      pendiente = { wakeWord: '', at: 0 }
    }
  }

  const base =
    desdeResultado > 0
      ? {
          ...evento,
          results: Array.from(evento?.results || []).slice(desdeResultado),
          resultIndex: 0,
        }
      : evento
  const salida =
    wakeAplicada && base
      ? {
          ...base,
          results: Array.from(base?.results || []).map((result) =>
            result?.isFinal
              ? { 0: { transcript: texto }, isFinal: true, length: 1 }
              : result,
          ),
          resultIndex: 0,
        }
      : base

  return { finalText: texto, wakePendiente: pendiente, evento: salida }
}
