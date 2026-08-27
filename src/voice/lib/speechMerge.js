/**
 * Fusión de texto ASR (interinos acumulativos y finales).
 */
import { cleanForSpeech } from './audioMath.js'
import { getTranscriptPauseCfg } from './fluTranscriptPause.js'
import { getShortFinalKeywordSet, getSpeechMergeCfg } from './fluTranscriptMotor.js'
import { getTranscriptDelta, mergeTranscriptText } from './transcriptDelta.js'

function utterancesRelateLocal(previous = '', next = '') {
  const prev = cleanForSpeech(previous)
  const nxt = cleanForSpeech(next)
  if (!prev || !nxt) return true
  const pLow = prev.toLowerCase()
  const nLow = nxt.toLowerCase()
  if (nLow.startsWith(pLow) || pLow.startsWith(nLow)) return true
  if (prev.length > nxt.length && (prev.endsWith(nxt) || prev.includes(` ${nxt}`))) return true
  if (nxt.length > prev.length && (nxt.endsWith(prev) || nxt.includes(` ${prev}`))) return true
  return false
}

function speechWords(text = '') {
  return cleanForSpeech(text).toLowerCase().split(/\s+/).filter(Boolean)
}

function countSharedPrefixWords(a = '', b = '') {
  const aw = speechWords(a)
  const bw = speechWords(b)
  let shared = 0
  while (shared < aw.length && shared < bw.length && aw[shared] === bw[shared]) {
    shared += 1
  }
  return shared
}

/** Ancla de 3+ palabras de next aparece en prev (Chrome re-emite frase sin prefijo basura). */
export function hasSpeechAnchor(prev = '', next = '') {
  const pLow = cleanForSpeech(prev).toLowerCase()
  const nw = speechWords(next)
  if (!pLow || nw.length < 3) return false
  for (let size = Math.min(6, nw.length); size >= 3; size -= 1) {
    const anchor = nw.slice(0, size).join(' ')
    if (anchor.length >= 10 && pLow.includes(anchor)) return true
  }
  return false
}

/** Colapsa repeticiones contiguas («foo bar foo bar» → «foo bar»). */
export function collapseRepeatedSpeech(text = '') {
  let current = cleanForSpeech(text)
  if (!current) return ''

  for (let pass = 0; pass < 4; pass += 1) {
    const words = current.split(/\s+/).filter(Boolean)
    if (words.length < 4) break

    let collapsed = false
    for (let size = Math.floor(words.length / 2); size >= 2; size -= 1) {
      const head = words.slice(0, size).join(' ').toLowerCase()
      const mid = words.slice(size, size * 2).join(' ').toLowerCase()
      if (head && head === mid) {
        current = cleanForSpeech(words.slice(0, size).concat(words.slice(size * 2)).join(' '))
        collapsed = true
        break
      }
    }
    if (!collapsed) break
  }

  return current
}

/**
 * Chrome a veces manda un sufijo suelto («ahí») en otro evento tras «estás»,
 * produciendo «ahí estás ahí». Colapsa prefijo huérfano repetido.
 */
export function collapseMisorderedMicMerge(text = '') {
  let cur = cleanForSpeech(text)
  if (!cur) return ''

  const words = cur.split(/\s+/).filter(Boolean)
  if (words.length >= 3) {
    const first = words[0].toLowerCase()
    const last = words[words.length - 1].toLowerCase()
    if (first === last && first.length >= 2) {
      const inner = words.slice(1).join(' ')
      if (inner.length >= first.length) return inner
    }
  }

  return cur
}

function hasRepeatedWordBlock(words = [], minSize = 4) {
  if (words.length < minSize * 2) return false
  for (let size = minSize; size <= Math.min(10, Math.floor(words.length / 2)); size += 1) {
    const seen = new Set()
    for (let i = 0; i <= words.length - size; i += 1) {
      const key = words.slice(i, i + size).join(' ').toLowerCase()
      if (seen.has(key)) return true
      seen.add(key)
    }
  }
  return false
}

/**
 * Eco ASR acumulativo: bloque de palabras repetido en medio del turno.
 * «pronto viene X pronto viene X Y» → «pronto viene X Y»
 */
export function collapseAsrStutter(text = '', { maxPasses = 6 } = {}) {
  let cur = collapseEchoPhrase(collapseRepeatedSpeech(cleanForSpeech(text)))
  const initialWords = cur.split(/\s+/).filter(Boolean)
  if (initialWords.length < 8 || !hasRepeatedWordBlock(initialWords)) {
    return cur
  }

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const words = cur.split(/\s+/).filter(Boolean)
    if (words.length < 8 || !hasRepeatedWordBlock(words)) break

    let found = false
    blockSearch: for (let size = Math.min(14, Math.floor(words.length / 2)); size >= 4; size -= 1) {
      for (let i = 0; i <= words.length - size * 2; i += 1) {
        const block = words.slice(i, i + size).join(' ').toLowerCase()
        for (let j = i + size; j <= words.length - size; j += 1) {
          if (words.slice(j, j + size).join(' ').toLowerCase() !== block) continue
          cur = cleanForSpeech(words.slice(0, j).concat(words.slice(j + size)).join(' '))
          found = true
          break blockSearch
        }
      }
    }

    if (!found) break
    cur = collapseEchoPhrase(collapseRepeatedSpeech(cur))
  }

  return cur
}

/** Pipeline único mic → UI/log (eco + stutter + prefijo huérfano). */
export function normalizeMicText(text = '') {
  const base = cleanForSpeech(text)
  if (!base) return ''
  if (base.length < 48) {
    return collapseMisorderedMicMerge(collapseRepeatedSpeech(base))
  }
  return collapseMisorderedMicMerge(collapseAsrStutter(base))
}

function tryAsrProgressiveMerge(prev = '', next = '') {
  if (!prev || !next) return ''
  if (next.startsWith(prev) || prev.startsWith(next)) {
    return next.length >= prev.length ? next : prev
  }
  const pLow = prev.toLowerCase()
  const nLow = next.toLowerCase()
  if (nLow.startsWith(pLow) || pLow.startsWith(nLow)) {
    return next.length >= prev.length ? next : prev
  }
  if (countSharedPrefixWords(prev, next) >= 3) {
    return next.length >= prev.length ? next : prev
  }
  const pw = pLow.split(/\s+/)[0] || ''
  const nw = nLow.split(/\s+/)[0] || ''
  if (pw.length >= 2 && nw.startsWith(pw) && next.length >= prev.length) return next
  if (nw.length >= 2 && pw.startsWith(nw) && prev.length >= next.length) return prev
  if (hasSpeechAnchor(prev, next) && next.length >= Math.floor(prev.length * 0.5)) return next
  if (hasSpeechAnchor(next, prev) && prev.length >= Math.floor(next.length * 0.5)) return prev
  return ''
}

/** Une fragmentos del mismo onresult (Chrome manda varios interinos/finales). */
export function mergeMicChunks(chunks = []) {
  const list = (Array.isArray(chunks) ? chunks : [])
    .map((chunk) => cleanForSpeech(chunk))
    .filter(Boolean)
  if (!list.length) return ''
  return normalizeMicText(
    list.reduce((acc, cur) => resolveMicFragmentMerge(acc, cur), ''),
  )
}

/** Elige el interino más completo; evita concatenar dos acumulativos de Chrome. */
export function pickBestMicInterim(chunks = []) {
  const list = (Array.isArray(chunks) ? chunks : [])
    .map((chunk) => cleanForSpeech(chunk))
    .filter(Boolean)
  if (!list.length) return ''
  if (list.length === 1) return normalizeMicText(list[0])

  const sorted = [...list].sort((a, b) => b.length - a.length)
  const longest = sorted[0]
  if (sorted.slice(1).every((c) => longest.toLowerCase().includes(c.toLowerCase()))) {
    return normalizeMicText(longest)
  }

  return normalizeMicText(list.reduce((acc, cur) => resolveMicFragmentMerge(acc, cur), ''))
}

/**
 * Quita eco ASR: frase final repetida que ya apareció antes en el mismo turno.
 * «maté a esas personas … maté a esas personas» → una sola ocurrencia al cierre.
 */
export function collapseEchoPhrase(text = '') {
  let current = cleanForSpeech(text)
  if (!current) return ''

  const words = current.split(/\s+/).filter(Boolean)
  if (words.length < 6) return collapseRepeatedSpeech(current)

  for (let size = Math.min(Math.floor(words.length / 2), 14); size >= 3; size -= 1) {
    const tail = words.slice(-size).join(' ').toLowerCase()
    const head = words.slice(0, -size).join(' ').toLowerCase()
    if (head.endsWith(tail) || head.includes(` ${tail}`)) {
      current = cleanForSpeech(words.slice(0, -size).join(' '))
      break
    }
  }

  return collapseRepeatedSpeech(current)
}

export function resolveMicFragmentMerge(previous = '', incoming = '') {
  const prev = cleanForSpeech(previous)
  const next = cleanForSpeech(incoming)
  if (!prev) return next
  if (!next) return prev
  const progressive = tryAsrProgressiveMerge(prev, next)
  if (progressive) return progressive
  return mergeSpeechTextBlind(prev, next, { keepAll: true })
}

export function mergeSpeechText(base = '', incoming = '', { keepAll = false } = {}) {
  const prev = cleanForSpeech(base)
  const next = cleanForSpeech(incoming)
  if (!next) return prev
  if (!prev) return normalizeMicText(next)
  const progressive = tryAsrProgressiveMerge(prev, next)
  if (progressive) return progressive.length >= 48 ? normalizeMicText(progressive) : collapseMisorderedMicMerge(collapseRepeatedSpeech(progressive))
  return normalizeMicText(mergeSpeechTextBlind(prev, next, { keepAll }))
}

/** Distancia de edición acotada entre dos palabras (ASR re-oye con variación: «flu»~«flow»). */
function fuzzyAsrWordEqual(a = '', b = '') {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  if (!x || !y) return false
  if (x === y) return true
  if (x.length < 3 || y.length < 3) return false
  if (x[0] !== y[0]) return false
  if (Math.abs(x.length - y.length) > 3) return false
  const alen = x.length
  const blen = y.length
  let prevRow = Array.from({ length: blen + 1 }, (_, j) => j)
  for (let i = 1; i <= alen; i += 1) {
    const row = [i]
    for (let j = 1; j <= blen; j += 1) {
      row[j] = Math.min(prevRow[j] + 1, row[j - 1] + 1, prevRow[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
    }
    prevRow = row
  }
  const maxLen = Math.max(alen, blen)
  const maxDist = maxLen <= 4 ? 2 : Math.floor(maxLen / 3) + 1
  return prevRow[blen] <= maxDist
}

/**
 * Empalme por solape difuso de palabras: Chrome re-oye la misma frase con
 * variación en el límite («nina esta hablando okay flu» + «okay flow traduce…»
 * → «nina esta hablando okay flow traduce…», sin duplicar el wake word).
 * Solo une si TODAS las palabras del solape coinciden (≥1 exacta): evita
 * concatenar ciegamente dos fragmentos sin relación.
 */
function rejoinViaFuzzyWordOverlap(prev = '', next = '') {
  const prevWords = prev.split(/\s+/).filter(Boolean)
  const nextWords = next.split(/\s+/).filter(Boolean)
  if (prevWords.length < 3 || nextWords.length < 3) return ''
  const maxK = Math.min(prevWords.length, nextWords.length, 4)
  for (let k = maxK; k >= 2; k -= 1) {
    const prevTail = prevWords.slice(-k)
    const nextHead = nextWords.slice(0, k)
    let exact = 0
    let allFuzzy = true
    for (let i = 0; i < k; i += 1) {
      if (!fuzzyAsrWordEqual(prevTail[i], nextHead[i])) {
        allFuzzy = false
        break
      }
      if (prevTail[i].toLowerCase() === nextHead[i].toLowerCase()) exact += 1
    }
    if (!allFuzzy || exact < 1) continue
    const base = prevWords.slice(0, prevWords.length - k).join(' ')
    return base ? `${base} ${next}` : next
  }
  return ''
}

/**
 * Empalme por palabra re-segmentada: Chrome parte una palabra en el límite
 * («okay flow tradu ce» + «okay flow traduce lo que dijiste en»). Compara sin
 * espacios para que «tradu ce» ≡ «traduce» y no duplique el fragmento.
 */
function rejoinViaNormalizedOverlap(prev = '', next = '') {
  const nNorm = next.toLowerCase().replace(/\s+/g, '')
  const prevWords = prev.split(/\s+/).filter(Boolean)
  if (prevWords.length < 2) return ''
  for (let tailWords = prevWords.length; tailWords >= 2; tailWords -= 1) {
    const tail = prevWords.slice(-tailWords).join(' ')
    const tailNorm = tail.toLowerCase().replace(/\s+/g, '')
    if (tailNorm.length < 4) continue
    if (!nNorm.startsWith(tailNorm)) continue
    const base = prevWords.slice(0, prevWords.length - tailWords).join(' ')
    return base ? `${base} ${next}` : next
  }
  return ''
}

function mergeSpeechTextBlind(base = '', incoming = '', { keepAll = false } = {}) {
  const prev = cleanForSpeech(base)
  const next = cleanForSpeech(incoming)
  if (!next) return prev
  if (!prev) return collapseRepeatedSpeech(next)
  if (next === prev || prev.endsWith(next)) return prev
  if (prev.startsWith(next)) return prev
  if (next.startsWith(prev)) return collapseRepeatedSpeech(next)
  if (prev.includes(next)) return prev
  const fuzzyRejoin = rejoinViaFuzzyWordOverlap(prev, next)
  if (fuzzyRejoin) return collapseRepeatedSpeech(fuzzyRejoin)
  const normalizedRejoin = rejoinViaNormalizedOverlap(prev, next)
  if (normalizedRejoin) return collapseRepeatedSpeech(normalizedRejoin)
  const delta = getTranscriptDelta(prev, next)
  if (!delta) return prev
  const merged = mergeTranscriptText(prev, delta)
  return collapseRepeatedSpeech(!keepAll || merged.length >= prev.length ? merged : prev)
}

function novelWordsInShortFinal(next = '', prior = '') {
  const nextWords = speechWords(next)
  const priorWords = new Set(speechWords(prior))
  return nextWords.filter((word) => !priorWords.has(word))
}

/**
 * Final corto tras pausa del usuario con palabras nuevas (p. ej. «hola» tras monólogo TV):
 * priorizar fila nueva en el log, no reemplazar ni truncar la fila anterior.
 */
function shortFinalHasKeyword(finWords = []) {
  const keywords = getShortFinalKeywordSet()
  const minChars = Number(getSpeechMergeCfg().shortFinalKeywordMinChars)
  return finWords.some((word) => {
    const key = word.toLowerCase()
    return keywords.has(key) || key.length >= minChars
  })
}

export function shouldPreferShortFinalRow(next = '', prior = '', context = {}) {
  const fin = cleanForSpeech(next)
  const prev = cleanForSpeech(prior)
  if (!fin || !prev || fin.length >= prev.length) return false

  const pauseMs = Number(context.pauseBeforeMs ?? context.userPauseMs ?? context.openLineAgeMs ?? 0)
  const minPause = Number(getTranscriptPauseCfg().pauseContinuationMinMs)
  if (pauseMs < minPause) return false

  const finWords = fin.split(/\s+/).filter(Boolean)
  const maxWords = Number(getSpeechMergeCfg().shortFinalMaxWords)
  if (finWords.length > maxWords) return false

  const confidence = Number(context.confidence ?? context.asrConfidence ?? 1)
  const minConf = Number(getSpeechMergeCfg().minKeywordConfidence)
  if (confidence < minConf) return false

  const related = utterancesRelateLocal(prev, fin)

  /** Interrupción tras monólogo TV: frase corta no relacionada (p. ej. «hola»). */
  if (!related && finWords.length <= 3) {
    return shortFinalHasKeyword(finWords)
  }

  if (!related) return false

  const novel = novelWordsInShortFinal(fin, prev)
  if (!novel.length) return false
  return shortFinalHasKeyword(novel)
}

/** No bloquear preview/commit si el final acorta pero debe ser fila nueva (interrupción). */
export function preferNewRowForShortFinal(next = '', prior = '', context = {}) {
  return shouldPreferShortFinalRow(next, prior, context)
}

/**
 * No acortar por ruido ASR; no bloquear sufijos sueltos ni finales cortos tras pausa con palabra clave.
 */
export function wouldShrinkLog(capture = '', lastEmitted = '', context = {}) {
  const next = cleanForSpeech(capture)
  const prev = cleanForSpeech(lastEmitted)
  if (!next || !prev || next.length >= prev.length) return false
  if (context.relaxShrinkGuards === true) return false
  if (shouldPreferShortFinalRow(next, prev, context)) return false
  if (!utterancesRelateLocal(prev, next)) return false
  if (prev.startsWith(next)) return true
  if (prev.endsWith(` ${next}`)) return true
  return false
}

/** Publicado debe coincidir con final mic; detecta prefijo huérfano («ahí estás ahí»). */
export function micPublishedParityOk(published = '', micFinal = '') {
  const pub = cleanForSpeech(published)
  const mic = cleanForSpeech(micFinal)
  if (!pub || !mic) return true
  if (pub === mic) return true
  if (pub.startsWith(mic)) return true
  if (mic.startsWith(pub)) return true
  const collapsed = normalizeMicText(pub)
  return collapsed === mic || mic.startsWith(collapsed) || collapsed.startsWith(mic)
}
