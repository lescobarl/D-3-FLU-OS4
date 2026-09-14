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

function endsWithNumericToken(text = '') {
  const words = cleanForSpeech(text).split(/\s+/).filter(Boolean)
  return /^\d+$/.test(words.at(-1) || '')
}

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

  if (looksLikeTrailingFragment(next) && endsWithNumericToken(prev)) {
    const words = prev.split(/\s+/).filter(Boolean)
    if (words.length) {
      words[words.length - 1] = `${words[words.length - 1]}${next}`
      return cleanForSpeech(words.join(' '))
    }
  }

  if (looksLikeTrailingFragment(prev) && next.length > prev.length + 4) {
    return cleanForSpeech(`${next} ${prev}`)
  }
  if (looksLikeTrailingFragment(next) && prev.length > next.length + 4) {
    return cleanForSpeech(`${prev} ${next}`)
  }

  return cleanForSpeech(`${prev} ${delta}`)
}
