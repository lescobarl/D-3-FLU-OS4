/**
 * ESTADO DE LA LOCUCIÓN — dueño único de las DOS preguntas que antes se mezclaban.
 *
 * El defecto medido: el ingress decidía «¿sigo en la misma locución?» con un `||` de dos
 * criterios que responden a cosas distintas (`utterancesRelate` y `utterancesSameRevision`),
 * así que una revisión del ASR y una extensión del dictado se trataban como lo mismo. Aquí
 * cada pregunta tiene su respuesta y su dueño, sin un predicado nuevo:
 *
 *  - `mismaRevision`: el ASR reemitió el MISMO audio con otro texto (`utterancesSameRevision`).
 *  - `crecimiento`: el texto nuevo CONTIENE al anterior (`utterancesRelate`).
 *  - `locucionNueva`: ni lo uno ni lo otro → el texto abre otra locución.
 *
 * No decide el commit: informa. Quien escribe la fila consulta el estado.
 *
 * HOJA: no importa nada que importe a este modulo (sin ciclos). `conversationStream` importa
 * de aqui `countSharedSpeechWords` y `utterancesSameRevision`, y los re-exporta.
 */
import { cleanForSpeech, speechWords } from '../lib/audioMath.js'
import { utterancesRelate } from '../lib/speechMerge.js'
import { getTranscriptPolicyCfg } from '../lib/fluTranscriptMotor.js'

/** Palabras iniciales compartidas (tolera typo ASR: táctil/táctico). */
export function countSharedSpeechWords(a = '', b = '') {
  const aw = speechWords(a)
  const bw = speechWords(b)
  let shared = 0
  while (shared < aw.length && shared < bw.length) {
    const left = aw[shared].toLowerCase()
    const right = bw[shared].toLowerCase()
    if (left === right) {
      shared += 1
      continue
    }
    if (
      left.length >= 4 &&
      right.length >= 4 &&
      (left.slice(0, 4) === right.slice(0, 4) || left.startsWith(right) || right.startsWith(left))
    ) {
      shared += 1
      continue
    }
    break
  }
  return shared
}

/**
 * Revisión ASR del mismo enunciado (no turno nuevo): prefijo largo compartido
 * aunque utterancesRelate falle por corrección táctil→táctico, etc.
 */
export function utterancesSameRevision(previous = '', next = '') {
  const prev = cleanForSpeech(previous)
  const nxt = cleanForSpeech(next)
  if (!prev || !nxt) return false
  if (utterancesRelate(prev, nxt)) return true

  const minLen = Math.min(speechWords(prev).length, speechWords(nxt).length)
  if (minLen < 3) return false

  const shared = countSharedSpeechWords(prev, nxt)
  if (shared >= 4) return true
  if (shared >= 3 && shared >= Math.floor(minLen * 0.55)) return true

  let chars = 0
  const max = Math.min(prev.length, nxt.length)
  while (chars < max && prev[chars].toLowerCase() === nxt[chars].toLowerCase()) {
    chars += 1
  }
  // POLITICA DE TRANSCRIPCION (una tabla): `transcript.policy.sameRevisionMinSharedChars`.
  return chars >= (Number(getTranscriptPolicyCfg().sameRevisionMinSharedChars) || 24)
}

/**
 * @param {string} anterior texto ya conocido (pendiente, última fila o lo mostrado)
 * @param {string} nuevo texto que llega
 * @returns {{ mismaRevision: boolean, crecimiento: boolean, locucionNueva: boolean }}
 */
export function estadoDeLocucion(anterior = '', nuevo = '') {
  const previo = String(anterior || '').trim()
  const texto = String(nuevo || '').trim()
  if (!previo || !texto) return { mismaRevision: false, crecimiento: false, locucionNueva: false }
  const mismaRevision = utterancesSameRevision(previo, texto)
  const crecimiento = utterancesRelate(previo, texto)
  return { mismaRevision, crecimiento, locucionNueva: !mismaRevision && !crecimiento }
}
