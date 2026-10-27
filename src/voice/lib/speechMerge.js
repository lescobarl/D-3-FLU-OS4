/**
 * Fusión de texto ASR (interinos acumulativos y finales).
 */
import {
  cleanForSpeech,
  novelWords,
  pickBestRecognitionTranscript,
  sliceWordsLower,
  speechWords,
  stripDiacritics,
} from './audioMath.js';
import { getTranscriptPauseCfg } from './fluTranscriptPause.js'
import { getShortFinalKeywordSet, getSpeechMergeCfg, getTranscriptPolicyCfg } from './fluTranscriptMotor.js'
import { getTranscriptDelta, mergeTranscriptText } from './transcriptDelta.js'

/** Misma frase acumulativa de Chrome o revisión ASR (cola), no un turno nuevo. Dueño único (V18). */
export function utterancesRelate(previous = '', next = '') {
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

/**
 * Bloque de palabras que es DATO, no frase: todo numeros. Una repeticion numerica
 * es una CUENTA (dictado "1..40"), no un eco del ASR: los colapsadores no deben
 * tocarla. Medido 2026-10-09 (dueno): "31 32 33 34 33 34 35" salia "31 32 33 34 35"
 * (se comia el "33 34").
 */
function isNumericBlock(words, start, size) {
  for (let i = start; i < start + size; i += 1) {
    if (!/^\d+$/.test(String(words[i] || ''))) return false
  }
  return true
}

/**
 * Colapsa repeticiones contiguas de un bloque de palabras, en CUALQUIER posicion
 * («foo bar foo bar» -> «foo bar»; «x foo bar foo bar» -> «x foo bar»).
 *
 * Antes solo miraba la CABEZA (words[0..size) vs words[size..2size)): una vuelta
 * del ASR en medio o al final del turno sobrevivia, delante de la repeticion o
 * detras de un arranque basura. Medido 2026-10-09 (bitacora del dueno):
 * "cer rando cerrando escucha cerrando escucha" salia tal cual porque el bloque
 * repetido ("cerrando escucha") NO esta al inicio.
 */
export function collapseRepeatedSpeech(text = '') {
  let current = cleanForSpeech(text)
  if (!current) return ''

  for (let pass = 0; pass < 4; pass += 1) {
    const words = current.split(/\s+/).filter(Boolean)
    if (words.length < 4) break

    let collapsed = false
    for (let size = Math.floor(words.length / 2); size >= 2 && !collapsed; size -= 1) {
      for (let start = 0; start + size * 2 <= words.length; start += 1) {
        const head = sliceWordsLower(words, start, start + size)
        const mid = sliceWordsLower(words, start + size, start + size * 2)
        if (head && head === mid && !isNumericBlock(words, start, size)) {
          current = cleanForSpeech(
            words.slice(0, start + size).concat(words.slice(start + size * 2)).join(' '),
          )
          collapsed = true
          break
        }
      }
    }
    if (!collapsed) break
  }

  return current
}

/**
 * Chrome a veces manda un sufijo suelto («ahí») en un evento previo y luego la
 * frase completa («estás ahí»). El fragmento previo es huérfano: la frase
 * entrante ya lo contiene como palabra final. Se descarta `prev` y NUNCA se
 * recorta la entrante — así una primera palabra legítima repetida al cierre
 * («hola ya hola») sobrevive. Solo aplica con `prev` de UNA palabra.
 */
function dropOrphanSuffixFragment(prev = '', next = '') {
  const pw = prev.split(/\s+/).filter(Boolean)
  const nw = next.split(/\s+/).filter(Boolean)
  if (pw.length !== 1 || nw.length < 2) return ''
  if (pw[0].toLowerCase() !== nw[nw.length - 1].toLowerCase()) return ''
  return next
}

function hasRepeatedWordBlock(words = [], minSize = 4) {
  if (words.length < minSize * 2) return false
  for (let size = minSize; size <= Math.min(10, Math.floor(words.length / 2)); size += 1) {
    const seen = new Set()
    for (let i = 0; i <= words.length - size; i += 1) {
      const key = sliceWordsLower(words, i, i + size)
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
  if (initialWords.length < minPalabrasTartamudeo() || !hasRepeatedWordBlock(initialWords)) {
    return cur
  }

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const words = cur.split(/\s+/).filter(Boolean)
    if (words.length < minPalabrasTartamudeo() || !hasRepeatedWordBlock(words)) break

    let found = false
    blockSearch: for (let size = Math.min(14, Math.floor(words.length / 2)); size >= 4; size -= 1) {
      for (let i = 0; i <= words.length - size * 2; i += 1) {
        const block = sliceWordsLower(words, i, i + size)
        if (isNumericBlock(words, i, size)) continue
        for (let j = i + size; j <= words.length - size; j += 1) {
          if (sliceWordsLower(words, j, j + size) !== block) continue
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
/** POLITICAS DE TRANSCRIPCION: dueno unico `getTranscriptPolicyCfg`. */
function minPalabrasTartamudeo() {
  return Number(getTranscriptPolicyCfg().stutterMinWords) || 8
}

/** POLITICAS DE TRANSCRIPCION: dueno unico `getTranscriptPolicyCfg`. */
function pisoCaracteresTartamudeo() {
  return Number(getTranscriptPolicyCfg().stutterCharFloor) || 48
}

export function normalizeMicText(text = '') {
  const base = cleanForSpeech(text)
  if (!base) return ''
  if (base.length < pisoCaracteresTartamudeo()) {
    return collapseRepeatedSpeech(base)
  }
  return collapseAsrStutter(base)
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
  if (hasSpeechAnchor(prev, next) && next.length >= Math.floor(prev.length * 0.5)) {
    // Ventana deslizada: si la primera palabra de `prev` NO está en `next`, `next`
    // no es un superconjunto sino el mismo turno sin su cabeza → no descartar
    // `prev` (se pierde la primera palabra); se cae a la fusión que la conserva.
    if (!pw || nLow.includes(pw)) return next
  }
  if (hasSpeechAnchor(next, prev) && prev.length >= Math.floor(next.length * 0.5)) {
    if (!nw || pLow.includes(nw)) return prev
  }
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

/** Palabras de un texto tal cual se dijeron (con su grafia), para no perder mayusculas. */
function palabrasCrudas(texto = '') {
  return String(texto || '').trim().split(/\s+/).filter(Boolean)
}

/** Clave comparable de una palabra: sin acentos, minusculas, sin signos. */
function claveDePalabra(texto = '') {
  return stripDiacritics(String(texto || '')).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * UNE dos VARIANTES DEL MISMO TRAMO conservando TODAS las palabras (decision del dueno
 * 2026-10-23): alineacion por subsecuencia comun, sin elegir una variante que pierda un
 * token y sin repetir una palabra que ya esta.
 *
 * El motor emite, para UN mismo tramo de audio, varias hipotesis del mismo enunciado
 * (medido 8f3112c2, evento t=1792789332116: una trae "esto", otra la cola "escucha").
 * Quedarse con la mas larga pesaba mas que conservar el habla: la fila perdia "esto".
 *
 * El tramo lo garantiza el LLAMADOR: solo se unen los finales del MISMO evento del motor
 * (`fraseDelEventoAsr`). Si la variante anade MUCHO al final (>3 palabras) no es una
 * variante del mismo tramo sino otra locucion pegada: NO se une (esa frontera la decide
 * el tramo, no este merge).
 *
 * @param {string} elegido variante vigente
 * @param {string} candidata variante hermana del mismo tramo
 * @returns {string} union alineada (o la variante mas completa si no se puede unir)
 */
export function unirVariantesDelMismoTramo(elegido = '', candidata = '') {
  const a = palabrasCrudas(elegido)
  const b = palabrasCrudas(candidata)
  if (!a.length) return String(candidata || '')
  if (!b.length) return String(elegido || '')
  const ka = a.map(claveDePalabra)
  const kb = b.map(claveDePalabra)
  // Subsecuencia comun mas larga por CLAVE (tolera acentos y mayusculas).
  const tabla = Array.from({ length: ka.length + 1 }, () => new Array(kb.length + 1).fill(0))
  for (let i = ka.length - 1; i >= 0; i -= 1) {
    for (let j = kb.length - 1; j >= 0; j -= 1) {
      tabla[i][j] = ka[i] === kb[j] ? tabla[i + 1][j + 1] + 1 : Math.max(tabla[i + 1][j], tabla[i][j + 1])
    }
  }
  const salida = []
  const yaEsta = (clave) => salida.some((palabra) => claveDePalabra(palabra) === clave)
  let i = 0
  let j = 0
  let anadidasAlFinal = 0
  while (i < a.length && j < b.length) {
    if (ka[i] === kb[j]) {
      salida.push(a[i])
      i += 1
      j += 1
      continue
    }
    // Palabra que solo trae la candidata: se ANADE en su posicion alineada.
    if (tabla[i][j + 1] >= tabla[i + 1][j]) {
      if (!yaEsta(kb[j])) salida.push(b[j])
      j += 1
      continue
    }
    salida.push(a[i])
    i += 1
  }
  while (i < a.length) {
    salida.push(a[i])
    i += 1
  }
  while (j < b.length) {
    if (!yaEsta(kb[j])) {
      salida.push(b[j])
      anadidasAlFinal += 1
    }
    j += 1
  }
  // Cola grande y ajena: es otra locucion pegada. No se une (lo decide el tramo).
  if (anadidasAlFinal > 3) return elegido.length >= candidata.length ? String(elegido) : String(candidata)
  return salida.join(' ')
}

/**
 * Compone el TROZO de UN evento del ASR con los resultados NUEVOS (`resultIndex..`).
 *
 * Chrome re-emite DELANTE el final retenido del enunciado anterior (medido 8f3112c2:
 * patrones `10` con `resultIndex=1`), y tambien emite el mismo tramo con prefijo
 * re-plegado + cola que crece (`"bien"` + `" vamos"`, `"bien vamos"` + `" a hacer"`).
 * Por eso solo se miran los resultados nuevos y, cuando un evento trae VARIOS finales,
 * se UNEN como variantes del mismo tramo en vez de quedarse con uno.
 *
 * @param {ArrayLike<object>|null} [resultados] lista de resultados del evento
 * @param {number} [desde] indice del primer resultado nuevo (`resultIndex`)
 * @returns {string} trozo del evento (vacio si no hay texto)
 */
export function fraseDelEventoAsr(resultados, desde = 0) {
  if (!resultados || !resultados.length) return ''
  const inicio = Math.max(0, Number(desde) || 0)
  const interinos = []
  const finales = []
  for (let indice = inicio; indice < resultados.length; indice += 1) {
    const resultado = resultados[indice]
    const texto = pickBestRecognitionTranscript(resultado)
    if (!texto) continue
    if (resultado?.isFinal === true) finales.push(String(texto))
    else interinos.push(String(texto))
  }
  const finalUnido = finales
    .map((texto) => cleanForSpeech(texto))
    .filter(Boolean)
    .reduce(unirVariantesDelMismoTramo, '')
  const interino = pickBestMicInterim(interinos)
  if (!finalUnido) return interino
  if (!interino) return normalizeMicText(finalUnido)
  // Final + interino del MISMO evento: el final es la re-escucha del mismo
  // enunciado; el interino solo gana si es MAS LARGO y lo contiene entero.
  const finalTexto = normalizeMicText(finalUnido)
  const interinoTexto = normalizeMicText(interino)
  const interinoGana =
    interinoTexto.length > finalTexto.length &&
    interinoTexto.toLowerCase().startsWith(finalTexto.toLowerCase())
  return interinoGana ? interinoTexto : finalTexto
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
    const tail = sliceWordsLower(words, -size)
    const head = sliceWordsLower(words, 0, -size)
    if (isNumericBlock(words, words.length - size, size)) continue
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
  const orphanDropped = dropOrphanSuffixFragment(prev, next)
  if (orphanDropped) return orphanDropped
  return mergeSpeechTextBlind(prev, next, { keepAll: true })
}

/**
 * El trozo `next` es una REVISION del trozo `prev` (el MISMO hueco de audio reescrito: otro
 * motor, o el ASR que vuelve a emitir su delta)? Entonces NO son dos trozos distintos y no
 * se concatenan: el que llega reemplaza al anterior sobre la misma base.
 *
 * MEDIDO (d4c1c8f3): el motor de streaming emite el delta de su hipotesis y lo va
 * reescribiendo ("de" -> "debido" -> "debió" -> "debió de" -> "debió de poner"). Pegando
 * cada delta detras, la linea viva mezclaba las dos hipotesis
 * ("... así de debido debió de poner debió ..."), y eso acababa en la caja y en la fila.
 *
 * Criterio: crece sobre el anterior (prefijo) o es el mismo trozo con VARIACION DE GRAFIA
 * (palabra a palabra, con el comparador difuso del ASR, el mismo de `mergeSpeechText`).
 * @param {string} prev
 * @param {string} next
 * @returns {boolean}
 */
export function isSameFragmentRevision(prev = '', next = '') {
  const a = cleanForSpeech(prev)
  const b = cleanForSpeech(next)
  if (!a || !b) return false
  if (a === b) return true
  const aLow = a.toLowerCase()
  const bLow = b.toLowerCase()
  if (bLow.startsWith(aLow) || aLow.startsWith(bLow)) return true
  const aWords = aLow.split(/\s+/).filter(Boolean)
  const bWords = bLow.split(/\s+/).filter(Boolean)
  const corto = aWords.length <= bWords.length ? aWords : bWords
  const largo = aWords.length <= bWords.length ? bWords : aWords
  // Un trozo LARGO con palabras distintas es habla nueva, no una revision.
  if (corto.length > 3) return false
  return corto.every((word, i) => fuzzyAsrWordEqual(word, largo[i] || ''))
}

/**
 * Integra un TROZO en la linea abierta con el LIBRO del ultimo hueco pegado.
 *
 * Dueno UNICO de la regla (antes privada en `conversationStream.integrateOpenLine`,
 * que ahora delega aqui): el reconocedor reemite el MISMO hueco de audio con otra
 * grafia o con la cola re-plegada (`"bien"` + `" vamos"`; luego `"bien vamos"` + `" a"`),
 * y pegar cada emision detras mezclaba dos hipotesis del mismo hueco. Por eso se
 * recuerda `{ base, chunk, line }`: si el trozo entrante es una REVISION del ultimo
 * pegado, reescribe ese hueco sobre la BASE en vez de concatenarse.
 *
 * El libro solo vale si `libro.line` sigue siendo la linea vigente: si otro camino
 * la reescribio, se ignora (una hipotesis por hueco, sin confiar en un libro caduco).
 *
 * @param {string} [linea] linea abierta vigente
 * @param {{ base: string, chunk: string, line: string }|null} [libro] libro vigente
 * @param {string} [trozo] trozo nuevo del evento del ASR
 * @returns {{ linea: string, libro: { base: string, chunk: string, line: string }|null }}
 */
export function mergeIntoOpenLine(linea = '', libro = null, trozo = '') {
  const vigente = normalizeMicText(linea)
  const trozoNuevo = cleanForSpeech(trozo)
  if (!trozoNuevo) return { linea: vigente, libro }
  const libroVigente = libro && libro.line === vigente ? libro : null
  // REVISION DEL MISMO HUECO: el trozo entrante reescribe el ultimo pegado sobre la base.
  if (
    libroVigente &&
    libroVigente.chunk &&
    libroVigente.chunk !== trozoNuevo &&
    isSameFragmentRevision(libroVigente.chunk, trozoNuevo)
  ) {
    const merged = normalizeMicText(resolveMicFragmentMerge(libroVigente.base, trozoNuevo))
    return { linea: merged, libro: { base: libroVigente.base, chunk: trozoNuevo, line: merged } }
  }
  const merged = normalizeMicText(resolveMicFragmentMerge(vigente, trozoNuevo))
  if (merged === vigente) return { linea: merged, libro: libroVigente }
  // Si la fusion solo ANADIO el trozo, se abre un hueco nuevo sobre la linea anterior;
  // si la linea crecio absorbiendolo (emision acumulativa), no hay delta pendiente.
  const appendeado = Boolean(vigente) && merged === normalizeMicText(`${vigente} ${trozoNuevo}`)
  return {
    linea: merged,
    libro: appendeado
      ? { base: vigente, chunk: trozoNuevo, line: merged }
      : { base: merged, chunk: '', line: merged },
  }
}

export function mergeSpeechText(base = '', incoming = '', { keepAll = false } = {}) {
  const prev = cleanForSpeech(base)
  const next = cleanForSpeech(incoming)
  if (!next) return prev
  if (!prev) return normalizeMicText(next)
  const progressive = tryAsrProgressiveMerge(prev, next)
  if (progressive) return progressive.length >= 48 ? normalizeMicText(progressive) : collapseRepeatedSpeech(progressive)
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

  const related = utterancesRelate(prev, fin)

  /** Interrupción tras monólogo TV: frase corta no relacionada (p. ej. «hola»). */
  if (!related && finWords.length <= 3) {
    return shortFinalHasKeyword(finWords)
  }

  if (!related) return false

  const novel = novelWords(fin, prev)
  if (!novel.length) return false
  return shortFinalHasKeyword(novel)
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
  if (!utterancesRelate(prev, next)) return false
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
