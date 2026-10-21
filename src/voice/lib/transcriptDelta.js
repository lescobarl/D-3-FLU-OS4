import { cleanForSpeech, speechWords } from './audioMath.js'

function findWordBoundaryDelta(previous = '', next = '') {
  const prevWords = speechWords(previous)
  const nextWords = speechWords(next)
  const limit = Math.min(prevWords.length, nextWords.length)
  for (let overlap = limit; overlap >= 1; overlap -= 1) {
    const tail = prevWords.slice(-overlap).join(' ')
    const head = nextWords.slice(0, overlap).join(' ')
    if (tail && tail === head) {
      return cleanForSpeech(nextWords.slice(overlap).join(' '))
    }
  }
  return ''
}

function findCharBoundaryDelta(previous = '', next = '') {
  const prev = cleanForSpeech(previous)
  const nxt = cleanForSpeech(next)
  const pLow = prev.toLowerCase()
  const nLow = nxt.toLowerCase()
  const minOverlap = 4
  for (let size = Math.min(prev.length, nxt.length); size >= minOverlap; size -= 1) {
    if (pLow.endsWith(nLow.slice(0, size))) {
      return cleanForSpeech(nxt.slice(size))
    }
  }
  return ''
}

function looksLikeTrailingFragment(text = '') {
  const value = cleanForSpeech(text)
  if (!value) return false
  if (/^\d+$/.test(value)) return true
  return false
}

export { looksLikeTrailingFragment }

export function getTranscriptDelta(previous = '', next = '') {
  const prev = cleanForSpeech(previous)
  const nextText = cleanForSpeech(next)
  if (!nextText) return ''
  if (!prev) return nextText
  if (nextText === prev) return ''
  if (nextText.startsWith(prev)) return cleanForSpeech(nextText.slice(prev.length))
  if (prev.startsWith(nextText) || prev.includes(nextText)) return ''

  const wordDelta = findWordBoundaryDelta(prev, nextText)
  if (wordDelta) return wordDelta

  const charDelta = findCharBoundaryDelta(prev, nextText)
  if (charDelta) return charDelta

  return nextText
}

export function mergeTranscriptText(base = '', incoming = '') {
  const prev = cleanForSpeech(base)
  const next = cleanForSpeech(incoming)
  if (!next) return prev
  if (!prev) return next
  const delta = getTranscriptDelta(prev, next)
  if (!delta) return prev

  // PROHIBIDO PEGAR DIGITOS SIN ESPACIO (medido 2026-10-19, log del dueno): Chrome
  // entrega los numeros como items SUELTOS ("2" + "3", "9" + "10") y el pegado los
  // convertia en "23" / "910" tanto en la caja como en la fila ("1 2 3 23 4 34...").
  // Dos items NUNCA son un solo token: la continuacion numerica se separa con espacio
  // por el camino generico de abajo (el delta ya evita repetir lo acumulado).
  if (looksLikeTrailingFragment(prev) && next.length > prev.length + 4) {
    return cleanForSpeech(`${next} ${prev}`)
  }
  if (looksLikeTrailingFragment(next) && prev.length > next.length + 4) {
    return cleanForSpeech(`${prev} ${next}`)
  }

  return cleanForSpeech(`${prev} ${delta}`)
}
