import { computeSpeakerEmbedding } from './speakerEmbedding.js'
import { FLU_CONFIG } from './fluConfig.js'
import { detectParticipantFloorCommand } from './participantFloor.js'
import { compareCosineSignatures } from './speakerCosineStrict.js'
import { looksLikeTrailingFragment, mergeTranscriptText } from './transcriptDelta.js'

const ACCENT_MAP = {
  á: 'a',
  é: 'e',
  í: 'i',
  ó: 'o',
  ú: 'u',
  ü: 'u',
  ñ: 'n',
}

export function stripDiacritics(text = '') {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[áéíóúüñ]/g, (char) => ACCENT_MAP[char] || char)
}

export function normalizeSpaces(text = '') {
  return String(text).replace(/\s+/g, ' ').trim()
}

export function detectTranscriptLanguage(text = '') {
  const normalized = stripDiacritics(text)
  if (!normalized) return 'es'

  const englishSignals = [
    /\b(the|and|you|what|please|hello|game|point|set|match|break|serve|tennis|world|cup|homework|grade|meeting|teacher|assistant|change|start|return|minutes|screen|next|round)\b/g,
  ]
  const spanishSignals = [
    /\b(el|la|los|las|y|que|por|favor|hola|tarea|calificacion|junta|maestro|asistente|cambiar|inicio|regresemos)\b/g,
  ]

  let englishScore = 0
  let spanishScore = 0

  englishSignals.forEach((regex) => {
    const matches = normalized.match(regex)
    englishScore += matches ? matches.length : 0
  })

  spanishSignals.forEach((regex) => {
    const matches = normalized.match(regex)
    spanishScore += matches ? matches.length : 0
  })

  const englishExtras = /(please|can you|could you|thank you|homework|report card|technical council)/.test(normalized)
  const spanishExtras = /(por favor|puedes|podrias|gracias|boleta|consejo tecnico|limpia el pizarron)/.test(normalized)

  englishScore += englishExtras ? 2 : 0
  spanishScore += spanishExtras ? 2 : 0

  return englishScore > spanishScore ? 'en' : 'es'
}

/** Idioma Gemini/TTS: es | en | both → detecta del texto si aplica. */
export function resolveAppLanguage(mode = 'es', text = '') {
  const normalized = String(mode || '').trim()
  if (normalized === 'en' || normalized === 'es') return normalized
  if (normalized === 'both') return detectTranscriptLanguage(text) || 'es'
  return 'es'
}

export function looksLikeEchoResponse(responseText = '', transcriptText = '') {
  const response = stripDiacritics(normalizeSpaces(responseText))
  const transcript = stripDiacritics(normalizeSpaces(transcriptText))
  if (!response || !transcript) return true
  if (response === transcript) return true

  const responseTokens = response.split(' ').filter(Boolean)
  const transcriptTokens = new Set(transcript.split(' ').filter(Boolean))
  if (!responseTokens.length || !transcriptTokens.size) return true

  let overlap = 0
  responseTokens.forEach((token) => {
    if (transcriptTokens.has(token)) overlap += 1
  })

  const overlapRatio = overlap / responseTokens.length
  return overlapRatio >= 0.55 || responseTokens.length < 3
}

export function isVisualRequestText(text = '') {
  const normalized = cleanForSpeech(String(text || ''))
  if (!normalized) return false
  return /\b(im[aá]gen(?:es)?|fotos?|images?|photos?|pictures?|image|visual|diagrama|diagram|illustration|ilustraci[oó]n|grafico|gr[aá]fico|dibuj\w*|render)\b/i.test(
    normalized,
  )
}

export function cleanForSpeech(text = '') {
  return normalizeSpaces(
    String(text)
      .replace(/[\n\r]+/g, ' ')
      .replace(/[*_`~>#-]+/g, ' ')
      .replace(/\s+/g, ' '),
  )
}

export function normalizeVoiceCommandText(text = '') {
  return normalizeSpaces(
    stripDiacritics(String(text))
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' '),
  )
}

// Palabras vacías mínimas (es/en) para comparar acciones LLM contra el
// transcript del turno: no aportan contenido y solo añadirían ruido.
const COMMAND_STOPWORDS = new Set([
  'a', 'al', 'la', 'las', 'el', 'los', 'lo', 'le', 'les', 'de', 'del', 'para', 'por',
  'con', 'sin', 'en', 'y', 'o', 'u', 'que', 'una', 'un', 'unos', 'unas', 'hoy',
  'the', 'and', 'for', 'to', 'of', 'in', 'on', 'at', 'an', 'a',
])

/**
 * Determina si el `texto` de una acción emitida por el LLM pertenece al
 * turno actual (transcript). El contrato exige que accion.texto sea un
 * fragmento del mandato del usuario; al validarlo se evita re-ejecutar
 * acciones de turnos ANTERIORES que el LLM repita por el contexto (Bug #5).
 * Heurística: solape de tokens significativos (sin acentos/puntuación y sin
 * stopwords). Devuelve true si el texto es subcadena del transcript o si
 * comparten al menos un token significativo real.
 */
export function actionBelongsToTranscript(actionText = '', transcript = '', wakeWords = []) {
  const action = String(actionText || '').trim()
  const spoken = String(transcript || '').trim()
  if (!action) return false
  if (!spoken) return true // sin transcript no hay base para descartar

  const cleanAction = normalizeCommandForDeterministic(action, wakeWords)
  const cleanSpoken = normalizeCommandForDeterministic(spoken, wakeWords)
  const normAction = normalizeVoiceCommandText(cleanAction)
  const normSpoken = normalizeVoiceCommandText(cleanSpoken)
  if (!normAction) return false

  // Subcadena directa (caso más común: el LLM copia el fragmento exacto).
  if (normSpoken.includes(normAction) || normAction.includes(normSpoken)) return true

  const tokens = (raw) => raw.split(' ').filter((word) => word && !COMMAND_STOPWORDS.has(word))
  const actionTokens = tokens(normAction)
  if (actionTokens.length === 0) return false
  const spokenTokens = new Set(tokens(normSpoken))
  const overlap = actionTokens.filter((word) => spokenTokens.has(word))
  return overlap.length >= Math.min(2, actionTokens.length)
}

function scoreRecognitionAlternative(text = '', confidence = 0) {
  const candidate = cleanForSpeech(text)
  if (!candidate) return Number.NEGATIVE_INFINITY

  const words = candidate.split(/\s+/).filter(Boolean)

  let score = Number.isFinite(confidence) ? confidence * 120 : 0
  score += Math.min(candidate.length, 120)
  score += words.length * 18

  return score
}

function compareRecognitionAlternatives(left = '', right = '') {
  const a = cleanForSpeech(left)
  const b = cleanForSpeech(right)
  if (a === b) return 0
  if (a && b && (a.startsWith(b) || b.startsWith(a))) {
    return a.length - b.length
  }
  return scoreRecognitionAlternative(a, 0) - scoreRecognitionAlternative(b, 0)
}

function collectVoiceCommandPhrases(voiceCommands = {}) {
  return [
    ...(voiceCommands.startConversation || []),
    ...(voiceCommands.generateMinute || []),
    ...(voiceCommands.saveMinute || []),
    ...(voiceCommands.closeListening || []),
    ...(voiceCommands.openListening || []),
    ...(voiceCommands.generateSummary || []),
    ...(voiceCommands.analyzeDocument || []),
    ...(voiceCommands.analyzeApp || []),
    ...(voiceCommands.generateDocument || []),
    ...(voiceCommands.generateVideo || []),
    // P1-C (§1.3.3, opcional): incluir CONOCER_FLU en "esperar frase incompleta".
    ...(voiceCommands.conocerFlu || []),
  ]
}

/** Tras wake word: texto incompleto de un comando conocido (esperar final). */
function isIncompleteVoiceCommand(text = '', voiceCommands = {}) {
  const norm = normalizeVoiceCommandText(text)
  if (!norm) return false

  for (const phrase of collectVoiceCommandPhrases(voiceCommands)) {
    const target = normalizeVoiceCommandText(phrase)
    if (!target) continue
    if (target.startsWith(norm) && target.length > norm.length) return true
  }
  return false
}

function isListeningAckPhrase(text = '', phrases = []) {
  const norm = normalizeVoiceCommandText(text)
  if (!norm) return false
  return (phrases || []).some((sample) => {
    const key = normalizeVoiceCommandText(sample)
    return key && (norm === key || norm.includes(key) || key.includes(norm))
  })
}

function shouldAckFluWake(afterWake = '', voiceCommands = {}) {
  const text = cleanForSpeech(afterWake)
  if (!text) return true
  return isListeningAckPhrase(text, voiceCommands.listeningAckPhrases)
}

function matchesCommandPhrase(text = '', phrases = [], options = {}) {
  const normalizedText = normalizeVoiceCommandText(text)
  if (!normalizedText || !phrases.length) return false

  const exact = phrases.some((phrase) => normalizedText === normalizeVoiceCommandText(phrase))
  if (exact) return true

  // Coincidencia tolerante (solo para navegación): si la frase canónica es
  // suficientemente larga y aparece dentro del texto, se considera un match.
  // Evita falsos positivos con frases cortas o ambiguas.
  if (options.tolerant) {
    return phrases.some((phrase) => {
      const normalizedPhrase = normalizeVoiceCommandText(phrase)
      return normalizedPhrase.length >= 6 && normalizedText.includes(normalizedPhrase)
    })
  }

  return false
}

/**
 * Comandos de generación de contenido (video/documento) que requieren que el
 * usuario describa QUÉ generar. Si la frase es SOLO el gatillo ("generame un
 * video") sin contenido, FLU debe ESPERAR (kind 'wait') a que el usuario
 * complete la instrucción en vez de disparar "Preparando el video." de inmediato
 * y truncar la descripción. Si hay contenido tras el gatillo ("generame un video
 * sobre la historia de México"), NO es un gatillo pelado y debe ir a la IA.
 */
function isBareContentGenerationTrigger(text = '', voiceCommands = {}) {
  const snapshot = cleanForSpeech(text)
  if (!snapshot) return false

  const wakeWords = voiceCommands.wakeWords || []
  const split = splitTranscriptAtWakeWord(snapshot, wakeWords)
  const afterWake = cleanForSpeech(split.afterWake || split.commandText || snapshot)

  const triggerPhrases = [
    ...(voiceCommands.generateVideo || []),
    ...(voiceCommands.generateDocument || []),
  ]
  if (!triggerPhrases.length) return false

  const norm = normalizeVoiceCommandText(afterWake)
  if (!norm) return false

  // Gatillo pelado: el texto (tras wake word) coincide EXACTAMENTE con una de
  // las frases canónicas de generación, sin contenido adicional.
  return triggerPhrases.some(
    (phrase) => normalizeVoiceCommandText(phrase) === norm,
  )
}

/**
 * Comandos que ESPERAN contenido tras el gatillo (búsqueda web, generación de
 * video/documento). Si el turno (tras wake word) es SOLO uno de esos gatillos
 * (o termina en una palabra de gatillo sin contenido), el ASR aún puede estar
 * enviando el resto en un fragmento final posterior ("ok flu busca en la web"
 * + pausa + "cómo saltan los conejos"). Disparar ahí produce consultas vacías
 * o truncadas.
 */
function isIncompleteContentTurn(afterWake = '', voiceCommands = {}) {
  const norm = normalizeVoiceCommandText(afterWake).toLowerCase()
  if (!norm) return false

  // 1) El turno ES EXACTAMENTE un gatillo canónico que espera contenido.
  const contentTriggers = [
    ...(voiceCommands.buscar || []),
    ...(voiceCommands.generateVideo || []),
    ...(voiceCommands.generateDocument || []),
  ]
  if (contentTriggers.some((phrase) => normalizeVoiceCommandText(phrase).toLowerCase() === norm)) {
    return true
  }

  // 2) El turno termina en una palabra de gatillo suelta (aún sin contenido):
  //    "ok flu busca", "ok flu navega", "genera", "crea"…
  if (/(?:busca|buscar|buscame|navega|navegar|busqueda|genera|generar|generame|crea|crear|creame|haz|hacer|search|find|browse|navigate|look\s+up)\s*$/i.test(norm)) {
    return true
  }

  // 3) El turno termina en el DESTINO de búsqueda sin la consulta: "busca en la
  //    web", "busca en internet", "navega en la web" (el ASR cortó ahí por la
  //    pausa y la consulta llega en el siguiente fragmento final). Antes esta
  //    forma disparaba con query vacía ("Bug #3": búsqueda de nada).
  const searchVerb = /(?:busca|buscar|buscame|busquedame|navega|navegar|busqueda|search|find|browse|navigate|look\s+up)\b/i.test(norm)
  const endsOnWebTarget = /(?:\bweb\b|\binternet\b|\bweb\s*)$/i.test(norm)
  if (searchVerb && endsOnWebTarget) return true

  // 4) Resto de la búsqueda compuesto SOLO por cabezas genéricas ("información",
  //    "datos", "algo"): el tema aún no llegó y el ASR lo manda en el fragmento
  //    siguiente. Las cabezas vienen de config (sin hardcode).
  if (searchVerb && Array.isArray(voiceCommands.searchPlaceholderHeads)) {
    const { matched, rest } = queryAfterTrigger(norm, voiceCommands)
    if (matched && rest && !stripSearchQueryLeadFillers(rest, voiceCommands)) {
      return true
    }
  }
  return false
}

/**
 * Quita del inicio de una query las "cabezas" genéricas de config
 * ("información", "datos"…) y un conector de enlace ("sobre", "de"…). Con esto
 * "... en la web información lenguaje de programación clipper" queda como
 * "lenguaje de programación clipper".
 */
function stripSearchQueryLeadFillers(rest = '', voiceCommands = {}) {
  const heads = new Set(
    (voiceCommands.searchPlaceholderHeads || [])
      .map((head) => normalizeVoiceCommandText(head).toLowerCase().trim())
      .filter(Boolean),
  )
  if (heads.size === 0) return String(rest || '').trim()

  const words = String(rest || '').trim().split(/\s+/).filter(Boolean)
  while (words.length) {
    const head = normalizeVoiceCommandText(words[0]).toLowerCase()
    if (heads.has(head)) {
      words.shift()
      continue
    }
    break
  }
  const connectors = new Set(['sobre', 'de', 'del', 'acerca', 'respecto'])
  while (words.length && connectors.has(normalizeVoiceCommandText(words[0]).toLowerCase())) {
    words.shift()
  }
  return words.join(' ').trim()
}

/**
 * DECISIÓN ÚNICA de turno de voz (fuente única para estabilización de
 * fragmentos): dado el transcript COMPLETO acumulado hasta ahora, ¿el turno
 * está LISTO para ejecutarse o falta contenido (esperar el siguiente fragmento
 * final antes de despachar)?
 *
 * @param {string} fullTranscript Transcript acumulado (fragmentos finales ya
 *   unidos por el motor de turnos), con o sin wake word.
 * @param {object} [voiceCommands] Comandos de voz configurados
 *   (FLU_CONFIG.voiceCommands).
 * @param {object} [options]
 * @param {boolean} [options.requireWake=true] true si el turno debe llevar
 *   wake word (modo pasivo). Con false se evalúa igualmente el texto tras la
 *   wake si la hubiera.
 * @returns {{ ready: boolean, reason?: string, text?: string }}
 */
export function decideVoiceTurnDispatch(fullTranscript = '', voiceCommands = {}, options = {}) {
  const { requireWake = true } = options || {}
  const snapshot = cleanForSpeech(fullTranscript)
  if (!snapshot) return { ready: true }

  const wakeWords = voiceCommands.wakeWords || []
  const split = splitTranscriptAtWakeWord(snapshot, wakeWords)
  const afterWake = cleanForSpeech(split.afterWake || split.commandText || snapshot)

  // Modo pasivo sin wake word: no es un comando de wake; quien decide el
  // destino es el flujo conversacional, no esta estabilización.
  if (requireWake && !split.wakeWordMatched) return { ready: true }

  if (!afterWake) return { ready: true }
  if (!isIncompleteContentTurn(afterWake, voiceCommands)) {
    return { ready: true }
  }
  return { ready: false, reason: 'incomplete-content-command', text: afterWake }
}

/**
 * Extrae la CONSULTA real de una frase de búsqueda web quitando el gatillo
 * reconocido ("busca en la web cómo saltan los conejos" → "cómo saltan los
 * conejos"). Sin hardcode: los gatillos vienen de voiceCommands.buscar.
 */
export function extractQueryFromWebSearchPhrase(phrase = '', voiceCommands = {}) {
  const snapshot = cleanForSpeech(phrase)
  if (!snapshot) return ''
  const split = splitTranscriptAtWakeWord(snapshot, voiceCommands.wakeWords || [])
  const body = cleanForSpeech(split.afterWake || split.commandText || snapshot)
  if (!body) return snapshot
  const { matched, rest } = queryAfterTrigger(body, voiceCommands)
  return matched ? stripSearchQueryLeadFillers(rest, voiceCommands) : body
}

/**
 * Resto CRUDO (sin limpiar) tras el gatillo de búsqueda. Necesario para
 * distinguir "el usuario aún no dijo el tema" (resto = partícula genérica) de
 * "el tema es X". Fuente única del recorte del gatillo.
 */
function queryAfterTrigger(body = '', voiceCommands = {}) {
  const buscar = (voiceCommands.buscar || [])
    .slice()
    .sort((a, b) => normalizeVoiceCommandText(b).length - normalizeVoiceCommandText(a).length)
  for (const trigger of buscar) {
    const target = normalizeVoiceCommandText(trigger).toLowerCase()
    if (!target) continue
    const norm = normalizeVoiceCommandText(body).toLowerCase()
    if (!norm.startsWith(target)) continue
    const triggerWords = target.split(/\s+/).filter(Boolean).length
    const restWords = body.split(/\s+/).filter(Boolean).slice(triggerWords)
    return { matched: true, rest: restWords.join(' ') }
  }
  return { matched: false, rest: body }
}

/**
 * §9 ÚNICA derivación de la query de búsqueda web.
 *
 * Recibe los parámetros del LLM (si los hay) o el transcript canónico y
 * devuelve la consulta limpia usando UN SOLO limpiador
 * (`extractQueryFromWebSearchPhrase`), sin el `||` de dos derivadores.
 */
export function deriveSearchQuery({ provided = '', transcript = '', voiceCommands = {} } = {}) {
  const source = cleanForSpeech(provided) || cleanForSpeech(transcript)
  if (!source) return ''
  return cleanForSpeech(extractQueryFromWebSearchPhrase(source, voiceCommands) || source)
}

const RECOVERABLE_RECOGNITION_ERRORS = new Set(['no-speech', 'aborted', 'network'])

export function matchWakeWordPrefix(text = '', wakeWords = []) {
  const value = normalizeVoiceCommandText(text)
  if (!value || !wakeWords.length) return null

  const normalizedWakeWords = wakeWords.map((wakeWord) => normalizeVoiceCommandText(wakeWord)).filter(Boolean)
  if (!normalizedWakeWords.length) return null

  const wakeWordPattern = new RegExp(
    `^(?:${normalizedWakeWords.map((wakeWord) => wakeWord.replace(/\s+/g, '\\s+')).join('|')})(?:\\b|$)`,
  )

  return value.match(wakeWordPattern)?.[0] || null
}

export function hasStrictWakeWordPrefix(text = '', wakeWords = []) {
  return Boolean(matchWakeWordPrefix(text, wakeWords))
}

export function matchWakeWordInText(text = '', wakeWords = []) {
  const value = normalizeVoiceCommandText(text)
  if (!value || !wakeWords.length) return null

  const normalizedWakeWords = wakeWords.map((wakeWord) => normalizeVoiceCommandText(wakeWord)).filter(Boolean)
  if (!normalizedWakeWords.length) return null

  const wakeWordPattern = new RegExp(
    `(?:^|\\s)(?:${normalizedWakeWords.map((wakeWord) => wakeWord.replace(/\s+/g, '\\s+')).join('|')})(?:\\b|$)`,
  )
  const match = value.match(wakeWordPattern)
  if (!match) return null

  const matched = match[0].trim()
  const index = value.indexOf(matched)
  if (index < 0) return null

  return {
    matched,
    index,
    length: matched.length,
  }
}

/** Palabras normalizadas (sin acentos, minúsculas) de un texto de voz. Dueño único (V18). */
export function speechWords(text = '') {
  return cleanForSpeech(text).toLowerCase().split(/\s+/).filter(Boolean)
}

/** Quita eco TV/ASR repetido al inicio de la pregunta tras «ok flu» (p. ej. «primeros partidos platicame…»). */
export function peelWakeQuestionEcho(question = '', echoSources = []) {
  // §9.6: la comparación es insensible a acentos/mayúsculas, pero el texto que
  // se devuelve conserva la forma original de la frase (no se pasa a minúsculas).
  const originalWords = cleanForSpeech(question).split(/\s+/).filter(Boolean)
  if (originalWords.length < 2) return cleanForSpeech(question)

  let words = originalWords
  for (const source of echoSources) {
    const srcWords = speechWords(source)
    if (!srcWords.length) continue
    for (let len = Math.min(8, words.length - 1); len >= 1; len -= 1) {
      const prefixStr = normalizeVoiceCommandText(words.slice(0, len).join(' '))
      const srcTail = srcWords.slice(-len).join(' ')
      const srcHead = srcWords.slice(0, len).join(' ')
      if (prefixStr === srcTail || prefixStr === srcHead) {
        words = words.slice(len)
        break
      }
    }
  }
  return cleanForSpeech(words.join(' '))
}

export function hasInlineWakeBoundary(text = '', wakeWords = []) {
  const split = splitTranscriptAtWakeWord(text, wakeWords)
  return Boolean(split.wakeWordMatched && cleanForSpeech(split.beforeWake))
}

/**
 * §9.5/§9.6: localiza la wake word sobre el texto ORIGINAL y devuelve los
 * recortes conservando acentos y mayúsculas. La detección se hace con el texto
 * normalizado ya probado; los wake words son ASCII, así que se ubican por
 * índice insensible a mayúsculas y se recorta el original.
 */
function sliceWakeWordFromSource(source = '', wakeWords = []) {
  const text = typeof source === 'string' ? source : ''
  if (!text.trim() || !wakeWords.length) {
    return { matched: false, beforeWakeText: cleanForSpeech(text), afterWakeText: '' }
  }

  const candidates = wakeWords
    .map((wakeWord) => normalizeVoiceCommandText(wakeWord))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length) // primero los compuestos ("oye flu")
  const lower = text.toLowerCase()
  let foundIndex = -1
  let foundLength = 0
  for (const candidate of candidates) {
    const index = lower.indexOf(candidate)
    if (index < 0) continue
    const before = index === 0 ? '' : lower[index - 1]
    const after = lower[index + candidate.length] || ''
    if (before && /\w/.test(before)) continue // parte de otra palabra
    if (after && /\w/.test(after)) continue // parte de otra palabra
    if (foundIndex < 0 || index < foundIndex) {
      foundIndex = index
      foundLength = candidate.length
    }
  }
  if (foundIndex < 0) {
    return { matched: false, beforeWakeText: cleanForSpeech(text), afterWakeText: '' }
  }

  const beforeWakeText = cleanForSpeech(text.slice(0, foundIndex))
  const afterWakeText = cleanForSpeech(
    text.slice(foundIndex + foundLength).replace(/^[\s,.;:!?\-—]+/, ''),
  )
  return { matched: true, beforeWakeText, afterWakeText }
}

export function splitTranscriptAtWakeWord(text = '', wakeWords = []) {
  const normalizedText = normalizeVoiceCommandText(text)
  const sliced = sliceWakeWordFromSource(text, wakeWords)
  if (!normalizedText) {
    return {
      wakeWordMatched: false,
      beforeWake: '',
      afterWake: '',
      commandText: '',
      normalizedText: '',
      beforeWakeText: '',
      afterWakeText: '',
    }
  }

  const prefix = matchWakeWordPrefix(normalizedText, wakeWords)
  if (prefix) {
    const afterWake = normalizeSpaces(normalizedText.slice(prefix.length))
    return {
      wakeWordMatched: true,
      beforeWake: '',
      afterWake,
      commandText: afterWake,
      normalizedText,
      beforeWakeText: '',
      afterWakeText: sliced.afterWakeText,
    }
  }

  const inline = matchWakeWordInText(normalizedText, wakeWords)
  if (!inline) {
    return {
      wakeWordMatched: false,
      beforeWake: normalizedText,
      afterWake: '',
      commandText: '',
      normalizedText,
      beforeWakeText: sliced.beforeWakeText,
      afterWakeText: '',
    }
  }

  const beforeWake = normalizeSpaces(normalizedText.slice(0, inline.index).trim())
  const afterWake = normalizeSpaces(normalizedText.slice(inline.index + inline.length).trim())
  return {
    wakeWordMatched: true,
    beforeWake,
    afterWake,
    commandText: afterWake,
    normalizedText,
    beforeWakeText: sliced.beforeWakeText,
    afterWakeText: sliced.afterWakeText,
  }
}

function voiceCommandCapturesRelate(richer = '', trigger = '') {
  const left = normalizeVoiceCommandText(richer)
  const right = normalizeVoiceCommandText(trigger)
  if (!left || !right) return false
  if (left === right) return true
  if (left.includes(right) || right.includes(left)) return true
  const leftWords = left.split(/\s+/).filter(Boolean)
  const rightWords = right.split(/\s+/).filter(Boolean)
  if (!rightWords.length) return false
  return rightWords.every((word) => leftWords.includes(word))
}

/** Elige la captura más completa del turno que sigue conteniendo el disparador del comando. */
export function pickRichestVoiceCommandCapture(
  triggerPhrase = '',
  { publishedLive = '', lastEmitted = '', streamDisplay = '' } = {},
) {
  const trigger = cleanForSpeech(triggerPhrase)
  const candidates = [publishedLive, streamDisplay, lastEmitted, trigger]
    .map(cleanForSpeech)
    .filter(Boolean)
  if (!candidates.length) return ''
  const unique = [...new Set(candidates)]
  unique.sort((a, b) => b.length - a.length)
  if (!trigger) return unique[0]
  for (const candidate of unique) {
    if (voiceCommandCapturesRelate(candidate, trigger)) return candidate
  }
  return unique[0]
}

/** Segmento de comando para log (sin prefijo pasivo ya registrado; conserva wake word). */
export function resolveCommandConversationLogText(phrase = '', _split = {}, passivePrefix = '') {
  const cleaned = cleanForSpeech(phrase)
  if (!cleaned) return ''
  const prefix = cleanForSpeech(passivePrefix)
  if (!prefix) return cleaned

  const normalizedPrefix = normalizeVoiceCommandText(prefix)
  const normalizedFull = normalizeVoiceCommandText(cleaned)
  const prefixIndex = normalizedFull.indexOf(normalizedPrefix)
  if (prefixIndex >= 0) {
    const rest = cleaned.slice(prefixIndex + prefix.length).trim()
    if (rest) return cleanForSpeech(rest)
  }
  if (cleaned.length > prefix.length) {
    const rest = cleaned.slice(prefix.length).trim()
    if (rest) return cleanForSpeech(rest)
  }
  return cleaned
}

export function detectListeningControl(text = '', commands = {}) {
  if (matchesCommandPhrase(text, commands.openListening || [])) {
    return 'ABRIR_ESCUCHA'
  }

  if (matchesCommandPhrase(text, commands.closeListening || [])) {
    return 'CERRAR_ESCUCHA'
  }

  return null
}

export function isMinuteGenerationRequest(text = '') {
  const normalized = normalizeVoiceCommandText(text)
  if (!normalized) return false
  if (referencesSavedMinute(normalized)) return false
  if (/\bresumen\b.*\bminuta\b/i.test(normalized) || /\bminuta\b.*\bresumen\b/i.test(normalized)) {
    return false
  }
  if (/\bsummary\b.*\bminute\b/i.test(normalized) || /\bminute\b.*\bsummary\b/i.test(normalized)) {
    return false
  }

  return [
    /\b(genera\w*|generar|crear|crea|preparar|prepara|hacer|haz)\s+((una?|la|el)\s+)?minuta\b/i,
    /\b(genera\w*|generar|crear|crea|hacer|haz|preparar|prepara|resumir|resume)\s+((un?|el|la)\s+)?resumen\b/i,
    /\b(generate|generating|create|creating|make|making|prepare|preparing)\s+(a\s+)?(minute|summary)\b/i,
  ].some((pattern) => pattern.test(normalized))
}

function referencesSavedMinute(text = '') {
  const normalized = normalizeVoiceCommandText(text)
  if (!normalized) return false

  return [
    /\bminuta\s+(numero\s+)?(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)\b/i,
    /\bminuta\s+(uno|dos|tres|cuatro|cinco|\d+)\b/i,
    /\bde\s+la\s+minuta\s+(numero\s+)?(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)\b/i,
    /\bde\s+minuta\s+(numero\s+)?(uno|dos|tres|cuatro|cinco|\d+)\b/i,
  ].some((pattern) => pattern.test(normalized))
}

function isIncompleteMinuteConsult(text = '') {
  const normalized = normalizeVoiceCommandText(text)
  if (!normalized || !/\bminuta\b/i.test(normalized)) return false
  if (referencesSavedMinute(normalized)) return false
  if (/\bde\s+la\s+minuta\s*$/i.test(normalized)) return true
  if (/\bminuta\s*$/i.test(normalized)) return true
  return false
}

export function isMinuteSaveRequest(text = '') {
  const normalized = normalizeVoiceCommandText(text)
  if (!normalized) return false

  return (
    /\b(guardar|guarda)\s+(la\s+)?minuta\b/i.test(normalized) ||
    /\b(save|store)\s+(the\s+)?minute\b/i.test(normalized)
  )
}

export function isMinuteKnowledgeRequest(text = '') {
  if (isMinuteGenerationRequest(text) || isMinuteSaveRequest(text)) return false

  const normalized = normalizeVoiceCommandText(text)
  if (!normalized) return false

  return [
    /\b(historial\s+de\s+minutas?)\b/i,
    /\b(base\s+de\s+conocimiento|kb\s*2)\b/i,
    /\b(resumen\s+de\s+(la\s+)?minutas?\b|resumen\s+de\s+minuta\s+\d+)\b/i,
    /\b(genera\w*|generar|resume\w*|resumir|dame|cuentame|muestrame|lee|leeme)\b.*\bresumen\b.*\bminuta\b/i,
    /\b(platicame|platícame|hablame|explicame|explicame|cuentame|muestrame)\b.*\b(la\s+)?minuta\b/i,
    /\b(que\s+dice|dame|cuentame|muestrame|lee|leeme)\b.*\b(la\s+)?minuta\b/i,
    /\b(consultar|buscar)\s+(la\s+)?minuta\b/i,
    /\b(la\s+)?minuta\s+(numero\s+)?(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)\b/i,
    /\bminuta\s+(uno|dos|tres|\d+)\b/i,
    /\b(acuerdos?|acta)\s+de\s+(la\s+)?minuta\b/i,
    /\b(summary\s+of\s+(the\s+)?minute|minute\s+\d+\s+summary)\b/i,
    /\b(generate|give|tell|read|show)\b.*\bsummary\b.*\bminute\b/i,
    /\b(tell\s+me|read|show)\b.*\b(the\s+)?minute\b/i,
    /\bminute\s+(number\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i,
  ].some((pattern) => pattern.test(normalized))
}

export function isSessionStartRequest(text = '', commands = {}) {
  return matchesCommandPhrase(text, commands.startConversation || [])
}

export function detectUiVoiceCommand(text = '', commands = {}) {
  if (isSessionStartRequest(text, commands)) {
    return 'INICIAR_CONVERSACION'
  }

  if (isMinuteSaveRequest(text) || matchesCommandPhrase(text, commands.saveMinute || [])) {
    return 'GUARDAR_MINUTA'
  }

  if (
    isMinuteGenerationRequest(text) ||
    matchesCommandPhrase(text, commands.generateMinute || []) ||
    matchesCommandPhrase(text, commands.generateSummary || [])
  ) {
    return 'GENERAR_RESUMEN'
  }

  // F1 — análisis de documentos
  if (matchesCommandPhrase(text, commands.analyzeDocument || [])) {
    return 'ANALIZAR_DOCUMENTO'
  }

  // F2 — análisis de funcionalidad de apps
  if (matchesCommandPhrase(text, commands.analyzeApp || [])) {
    return 'ANALIZAR_APP'
  }

  // F3 — generación de documentos
  if (matchesCommandPhrase(text, commands.generateDocument || [])) {
    return 'GENERAR_DOCUMENTO'
  }

  // F4 — generación de video
  if (matchesCommandPhrase(text, commands.generateVideo || [])) {
    return 'GENERAR_VIDEO'
  }

  // Navegación curada por voz → resultado en el Pizarrón
  // (modo tolerante: acepta frases conversacionales como "navegar a wikipedia")
  if (matchesCommandPhrase(text, commands.navigate || [], { tolerant: true })) {
    return 'NAVEGAR'
  }

  // F3 — búsqueda web por voz ("buscá capital de Francia") → resultados en el
  // Pizarrón. Se evalúa DESPUÉS de NAVEGAR para que "navega en wikipedia"
  // gane sobre "buscar en wikipedia" (orden por especificidad).
  if (matchesCommandPhrase(text, commands.buscar || [], { tolerant: true })) {
    return 'BUSCAR'
  }

  // P1-C (§1.3.3) — autoconocimiento (CONOCER_FLU): fast-path local sin IA.
  // Se evalúa después de NAVEGAR/BUSCAR; responde enumerando las capacidades
  // reales de FLU compiladas desde la configuración (nunca hardcode).
  if (matchesCommandPhrase(text, commands.conocerFlu || [], { tolerant: true })) {
    return 'CONOCER_FLU'
  }

  return null
}

/** Detecta comandos de sesión en frase completa, tras wake word o en cola de comando. */
export function detectSessionVoiceCommand(text = '', voiceCommands = {}) {
  const snapshot = cleanForSpeech(text)
  if (!snapshot) return null

  const direct =
    detectListeningControl(snapshot, voiceCommands) || detectUiVoiceCommand(snapshot, voiceCommands)
  if (direct) return direct

  const wakeWords = voiceCommands.wakeWords || []
  const split = splitTranscriptAtWakeWord(snapshot, wakeWords)
  const afterWake = cleanForSpeech(split.afterWake || split.commandText || '')
  if (afterWake) {
    const trailing =
      detectListeningControl(afterWake, voiceCommands) || detectUiVoiceCommand(afterWake, voiceCommands)
    if (trailing) return trailing
  }

  if (split.wakeWordMatched && matchWakeWordPrefix(normalizeVoiceCommandText(snapshot), wakeWords)) {
    if (shouldAckFluWake(afterWake, voiceCommands)) {
      return 'FLU_WAKE'
    }
    return null
  }

  const fluWake = extractFluVoiceCommand(snapshot, {
    requireWake: false,
    wakeWords,
  })
  if (fluWake.commandText) {
    return (
      detectListeningControl(fluWake.commandText, voiceCommands) ||
      detectUiVoiceCommand(fluWake.commandText, voiceCommands)
    )
  }

  return null
}

/** Acción al cerrar un final en conversación pasiva. */
export function resolveFinalConversationAction(text = '', voiceCommands = {}, { lastCommitted = '' } = {}) {
  const snapshot = cleanForSpeech(text)
  const wakeWords = voiceCommands.wakeWords || []
  const split = splitTranscriptAtWakeWord(snapshot, wakeWords)
  const beforeWake = cleanForSpeech(split.beforeWakeText || split.beforeWake)
  // Detección: texto normalizado (sin acentos) para los matchers.
  const afterWakeRaw = cleanForSpeech(split.afterWake || split.commandText || '')
  // §9.6: la pregunta que escucha la IA se deriva de la MISMA frase canónica,
  // conservando acentos/mayúsculas (texto original tras la wake word).
  const questionTextRaw = cleanForSpeech(
    split.afterWakeText || split.afterWake || split.commandText || '',
  )
  /** Solo pelar eco TV (beforeWake); lastCommitted solo en wake inline con TV — no repetir fila del usuario. */
  const echoSources = beforeWake
    ? [beforeWake, cleanForSpeech(lastCommitted)].filter(Boolean)
    : [beforeWake].filter(Boolean)
  const afterWake = peelWakeQuestionEcho(afterWakeRaw, echoSources)
  const question = peelWakeQuestionEcho(questionTextRaw, echoSources)

  if (split.wakeWordMatched && afterWake && isMinuteKnowledgeRequest(afterWake)) {
    return {
      kind: 'flu',
      question,
      beforeWake,
    }
  }

  const floorCommand = detectParticipantFloorCommand(afterWake, voiceCommands)
  if (split.wakeWordMatched && floorCommand) {
    return { kind: 'command', command: floorCommand }
  }

  const command = detectSessionVoiceCommand(text, voiceCommands)
  if (command) {
    // Generación de contenido (video/documento): si la frase es SOLO el gatillo
    // ("generame un video") sin descripción de QUÉ generar, FLU debe ESPERAR a
    // que el usuario complete la instrucción en vez de disparar de inmediato y
    // truncar el contenido. El contenido llega en una frase posterior o en la
    // misma frase con descripción (esa NO es gatillo pelado → va a la IA).
    if (
      (command === 'GENERAR_VIDEO' || command === 'GENERAR_DOCUMENTO') &&
      isBareContentGenerationTrigger(text, voiceCommands)
    ) {
      return { kind: 'wait' }
    }
    // Estabilización de fragmentos: si el turno quedó en un gatillo SIN
    // contenido ("ok flu busca en la web", "navega", "crea un video"), se
    // espera el siguiente fragmento final antes de ejecutar (Bug #3/#4).
    // Se evalúa el transcript COMPLETO (puede llevar o no wake word).
    if (
      decideVoiceTurnDispatch(snapshot, voiceCommands, { requireWake: false }).ready === false
    ) {
      return { kind: 'wait' }
    }
    return { kind: 'command', command }
  }

  if (!split.wakeWordMatched) return { kind: 'log' }

  if (!afterWake) return { kind: 'command', command: 'FLU_WAKE' }
  if (shouldAckFluWake(afterWake, voiceCommands)) {
    return { kind: 'command', command: 'FLU_WAKE' }
  }

  const introducedName = detectWakeIntroducedName(snapshot, wakeWords)
  if (introducedName) {
    return {
      kind: 'command',
      command: 'REGISTRAR_PARTICIPANTE',
      introducedName,
      beforeWake,
    }
  }

  if (isIncompleteVoiceCommand(afterWake, voiceCommands)) {
    return { kind: 'wait' }
  }

  if (isMinuteGenerationRequest(afterWake) || isMinuteSaveRequest(afterWake)) {
    return { kind: 'log' }
  }

  return {
    kind: 'flu',
    question,
    beforeWake,
  }
}

/**
 * §9 ÚNICA FUENTE DE VERDAD de la query.
 *
 * A partir de la fila canónica (la MISMA frase que se commitea en el store),
 * deriva la acción y el texto de consulta que consumen Gemini y la búsqueda
 * web. Esa derivación ocurre en UN SOLO lugar: aquí. Nadie más construye la
 * query por su cuenta.
 *
 * @param {string} rowText Texto de la fila canónica (con o sin wake word).
 * @param {object} voiceCommands `FLU_CONFIG.voiceCommands`.
 * @param {object} [options] Opciones de `resolveFinalConversationAction`.
 */
export function deriveQueryFromRow(rowText = '', voiceCommands = {}, options = {}) {
  const row = cleanForSpeech(rowText)
  if (!row) return { kind: 'log', question: '', searchQuery: '' }
  const action = resolveFinalConversationAction(row, voiceCommands, options)
  const wakeWords = voiceCommands.wakeWords || []
  const searchQuery = cleanForSpeech(
    extractQueryFromWebSearchPhrase(row, voiceCommands) ||
      action.question ||
      removeWakeWord(row, wakeWords),
  )
  return { ...action, question: action.question || row, searchQuery }
}

/** Interino: solo consultas de minuta (Chrome a veces no manda final). Flu general → final. */
export function shouldDispatchFluInterim(question = '', voiceCommands = {}) {
  const q = cleanForSpeech(question)
  if (!q) return false
  if (FLU_CONFIG.transcript?.fluQuery?.dispatchOnInterim === true) {
    if (isVisualRequestText(q)) return false
    if (/\bresumen\b/i.test(q) || /\bsummary\b/i.test(q)) {
      if (!/\b(minuta|minutas|minute|minutes)\b/i.test(q)) return false
    }
    if (isMinuteKnowledgeRequest(q)) {
      if (isIncompleteMinuteConsult(q)) return false
      return true
    }
    if (isIncompleteVoiceCommand(q, voiceCommands)) return false
    return q.split(/\s+/).filter(Boolean).length >= 3
  }
  if (isMinuteKnowledgeRequest(q)) {
    if (isIncompleteMinuteConsult(q)) return false
    return true
  }
  return false
}

function isFluQueryPrefixExtension(lastSignature = '', nextSignature = '') {
  if (!String(lastSignature).startsWith('flu:') || !String(nextSignature).startsWith('flu:')) {
    return false
  }
  const prev = String(lastSignature).slice(4)
  const next = String(nextSignature).slice(4)
  if (!prev || !next) return false
  return next.startsWith(prev) || prev.startsWith(next)
}

export function shouldDispatchCommandInterim(
  command = '',
  text = '',
  voiceCommands = {},
  fullPhrase = '',
) {
  if (command === 'FLU_WAKE') return false

  if (command === 'FLU_ADELANTE' || command === 'FLU_ESPERA') return false

  const norm = cleanForSpeech(text)
  if (!norm) return false

  if (command === 'REGISTRAR_PARTICIPANTE') {
    const wakeWords = voiceCommands.wakeWords || []
    const snapshot = cleanForSpeech(fullPhrase) || norm
    return Boolean(detectWakeIntroducedName(snapshot, wakeWords))
  }

  if (command === 'GENERAR_RESUMEN') {
    if (isMinuteKnowledgeRequest(norm)) return false
    if (/\b(genera\w*|generar|resume\w*|resumir)\b.*\bresumen\b.*\bde\s+la\b/i.test(norm)) return false
    if (/\b(generate|summarize|summary)\b.*\b(of\s+the\s+)?minute\b/i.test(norm)) return false
    if (/\bresumen\b/i.test(norm)) return false
    if (/\bsummary\b/i.test(norm)) return false
    if (isIncompleteVoiceCommand(norm, voiceCommands)) return false
    return isMinuteGenerationRequest(norm)
  }

  if (isIncompleteVoiceCommand(norm, voiceCommands)) return false
  return true
}

function commandTextFromPhrase(phrase = '', voiceCommands = {}) {
  const snapshot = cleanForSpeech(phrase)
  if (!snapshot) return ''
  const wakeWords = voiceCommands.wakeWords || []
  const split = splitTranscriptAtWakeWord(snapshot, wakeWords)
  return cleanForSpeech(split.afterWake || split.commandText || snapshot)
}

export function shouldDispatchConversationAction(
  action,
  { interim = false, voiceCommands = {}, phrase = '' } = {},
) {
  if (!action || action.kind === 'wait' || action.kind === 'log') return false
  if (action.kind === 'command') {
    if (!interim) return true
    return shouldDispatchCommandInterim(
      action.command,
      commandTextFromPhrase(phrase, voiceCommands),
      voiceCommands,
      phrase,
    )
  }
  if (action.kind === 'flu') {
    if (interim) return shouldDispatchFluInterim(action.question, voiceCommands)
    return Boolean(cleanForSpeech(action.question))
  }
  return false
}

/** Plan de dispatch (origen único): hook, simulaciones e invariantes. */
export function planConversationDispatch(
  text = '',
  voiceCommands = {},
  {
    interim = false,
    lastSignature = '',
    lastAt = 0,
    dedupMs = 4500,
    now = Date.now(),
    lastCommitted = '',
  } = {},
) {
  const phrase = cleanForSpeech(text)
  if (!phrase) return { plan: 'skip', reason: 'empty', action: null, signature: '' }

  // §9: la query se deriva de la fila canónica en UN solo lugar.
  const action = deriveQueryFromRow(phrase, voiceCommands, {
    lastCommitted: cleanForSpeech(lastCommitted),
  })
  if (
    !shouldDispatchConversationAction(action, {
      interim,
      voiceCommands,
      phrase,
    })
  ) {
    return { plan: 'skip', reason: action?.kind || 'none', action, signature: '', phrase }
  }

  const signature =
    action.kind === 'command'
      ? action.command === 'FLU_ADELANTE'
        ? 'cmd:FLU_ADELANTE'
        : `cmd:${action.command}:${normalizeVoiceCommandText(phrase)}`
      : `flu:${normalizeVoiceCommandText(action.question || phrase)}`

  const effectiveDedupMs =
    action.kind === 'command' && action.command === 'FLU_ADELANTE'
      ? Math.max(dedupMs, Number(FLU_CONFIG.fluParticipant?.floorGrantDedupMs) || 12000)
      : dedupMs

  const prefixDedupMs = Number(FLU_CONFIG.transcript?.fluQuery?.prefixExtensionDedupMs)

  if (lastSignature === signature && now - lastAt < effectiveDedupMs) {
    return { plan: 'dedup', action, signature, phrase }
  }

  if (
    action.kind === 'flu' &&
    isFluQueryPrefixExtension(lastSignature, signature) &&
    now - lastAt < prefixDedupMs
  ) {
    return { plan: 'dedup', reason: 'prefix-extension', action, signature, phrase }
  }

  return { plan: 'dispatch', action, signature, phrase }
}

export function isRecoverableRecognitionError(error = '', conversationActive = false) {
  return conversationActive && RECOVERABLE_RECOGNITION_ERRORS.has(String(error || '').trim())
}

export function getRecognitionRetryDelay(error = '') {
  const code = String(error || '').trim()
  if (code === 'network') return 350
  if (code === 'audio-capture') return 280
  if (code === 'no-speech') return 80
  if (code === 'aborted') return 100
  return 120
}

export function getRecognitionErrorMessage(error = '', messages = {}) {
  const code = String(error || '').trim()
  return messages[code] || `Error de reconocimiento: ${code}`
}

export function buildCurrentPhraseFromResults(results = [], fromIndex = 0) {
  if (!Array.isArray(results) || !results.length) return ''

  const startIndex = Math.max(0, Math.min(fromIndex, results.length))
  let phrase = ''
  const trailingFragments = []

  for (let index = startIndex; index < results.length; index += 1) {
    const alternatives = Array.from(results[index] || [])
      .map((alternative) => ({
        transcript: cleanForSpeech(alternative?.transcript || ''),
        confidence: Number(alternative?.confidence || 0),
      }))
      .filter((alternative) => Boolean(alternative.transcript))

    if (!alternatives.length) continue

    const bestAlternative = alternatives.reduce((best, current) => {
      const bestRank = scoreRecognitionAlternative(best.transcript, best.confidence)
      const currentRank = scoreRecognitionAlternative(current.transcript, current.confidence)
      if (currentRank === bestRank) {
        return compareRecognitionAlternatives(current.transcript, best.transcript) > 0
          ? current
          : best
      }
      if (compareRecognitionAlternatives(current.transcript, best.transcript) > 0 && currentRank >= bestRank - 10) {
        return current
      }
      return currentRank > bestRank ? current : best
    })

    if (!looksLikeTrailingFragment(bestAlternative.transcript)) {
      for (const alternative of alternatives) {
        if (looksLikeTrailingFragment(alternative.transcript)) {
          const value = alternative.transcript
          if (value && trailingFragments.at(-1) !== value) {
            trailingFragments.push(value)
          }
        }
      }
    }

    phrase = phrase ? mergeTranscriptText(phrase, bestAlternative.transcript) : bestAlternative.transcript
  }

  const uniqueTrailingFragments = trailingFragments.filter(
    (fragment, index, list) => list.indexOf(fragment) === index,
  )

  const combined = uniqueTrailingFragments.length
    ? [phrase, ...uniqueTrailingFragments].filter(Boolean).join(' ')
    : phrase

  return cleanForSpeech(normalizeSpaces(combined))
}

export function pickBestRecognitionTranscript(result = []) {
  const alternatives = Array.from(result || [])
    .map((alternative) => ({
      transcript: cleanForSpeech(alternative?.transcript || ''),
      confidence: Number(alternative?.confidence || 0),
    }))
    .filter((alternative) => Boolean(alternative.transcript))

  if (!alternatives.length) return ''
  if (alternatives.length === 1) return alternatives[0].transcript

  return alternatives.reduce((best, current) => {
    const bestRank = scoreRecognitionAlternative(best.transcript, best.confidence)
    const currentRank = scoreRecognitionAlternative(current.transcript, current.confidence)
    if (currentRank === bestRank) {
      return compareRecognitionAlternatives(current.transcript, best.transcript) > 0 ? current : best
    }
    if (compareRecognitionAlternatives(current.transcript, best.transcript) > 0 && currentRank >= bestRank - 10) {
      return current
    }
    return currentRank > bestRank ? current : best
  }).transcript
}

export function extractFluVoiceCommand(text = '', { requireWake = false, wakeWords = [] } = {}) {
  const normalizedText = normalizeVoiceCommandText(text)
  if (!normalizedText) {
    return {
      accepted: false,
      reason: 'empty_transcript',
      wakeWordMatched: false,
      normalizedText: '',
      commandText: '',
    }
  }

  if (!requireWake) {
    return {
      accepted: true,
      reason: 'ok',
      wakeWordMatched: false,
      normalizedText,
      commandText: normalizedText,
    }
  }

  const wakeWordPrefix = matchWakeWordPrefix(normalizedText, wakeWords)
  if (!wakeWordPrefix) {
    return {
      accepted: false,
      reason: 'missing_wake_word',
      wakeWordMatched: false,
      normalizedText,
      commandText: '',
    }
  }

  const commandText = normalizeSpaces(normalizedText.slice(wakeWordPrefix.length))

  if (!commandText) {
    return {
      accepted: false,
      reason: 'empty_after_wake_word',
      wakeWordMatched: true,
      normalizedText,
      commandText: '',
    }
  }

  return {
    accepted: true,
    reason: 'ok',
    wakeWordMatched: true,
    normalizedText,
    commandText,
  }
}

export function removeWakeWord(text = '', wakeWords = []) {
  const result = extractFluVoiceCommand(text, { requireWake: true, wakeWords })
  return result.accepted ? result.commandText : normalizeVoiceCommandText(text)
}

/** Plegado para comparar si dos textos son la MISMA emisión (sin wake word). */
function foldSpokenUtterance(text = '', wakeWords = []) {
  return normalizeSpaces(stripDiacritics(removeWakeWord(text, wakeWords) || ''))
    .toLowerCase()
    .trim()
}

/**
 * ¿nextText es la MISMA emisión que lastText (revisión ASR que crece o igual)?
 * Comparación SIN wake word (config), minúsculas y sin diacríticos/puntuación.
 * Devuelve 'equal' (misma emisión), 'grow' (next extiende a last) o false.
 */
export function spokenUtteranceRevision(lastText = '', nextText = '', wakeWords = []) {
  const last = foldSpokenUtterance(lastText, wakeWords)
  const next = foldSpokenUtterance(nextText, wakeWords)
  if (!next) return false
  if (!last) return 'grow'
  if (next === last) return 'equal'
  return next.startsWith(`${last} `) ? 'grow' : false
}

/**
 * Para mostrar la transcripción en la UI: si el texto contiene una palabra de
 * activación (wake word), se muestra SOLO lo que viene después de ella; si no
 * hay wake word, se muestra el texto tal cual. Así la transcripción en pantalla
 * refleja la intención del usuario sin el prefijo de activación ("Flu, ...").
 *
 * A diferencia de splitTranscriptAtWakeWord (que normaliza y pierde los acentos),
 * este helper recorta sobre el texto ORIGINAL para conservar la frase tal y como
 * la dijo el usuario (p. ej. "recuérdame" no pierde la tilde).
 */
export function stripWakeWordForDisplay(text = '', wakeWords = []) {
  const source = typeof text === 'string' ? text : ''
  if (!source.trim() || !wakeWords.length) return source

  // §9.5/§9.6: un solo recorte, sobre el texto original (conserva acentos).
  // `splitTranscriptAtWakeWord` ya expone la versión con texto original.
  const split = splitTranscriptAtWakeWord(source, wakeWords)
  if (!split.wakeWordMatched) return source
  return split.afterWakeText || source
}

// ============================================================
// PUNTO ÚNICO DE NORMALIZACIÓN DEL MANDATO (hub de integración)
// ============================================================
// El transcript crudo llega CON la wake word pegada ("Okay Blue generame una
// cita...") y con fragmentos ASR duplicados ("Okay Flow generame Una Okay flu
// genérame una nota..."). Los parsers deterministas (parseReminderIntent,
// __fluHandleNoteText, etc.) anclan sus regex al inicio del mandato, así que
// aquí se limpia TODO el prefijo de wake word (una sola vez, para todos los
// manejadores) y se colapsan los fragmentos duplicados antes de despachar.
//
// Esta es LA ÚNICA función que separa la wake word del mandato para la
// resolución determinista de intención. Antes vivía inline en App.tsx
// (onContractResolved); se extrajo aquí como función pura testeable para que
// todos los consumidores compartan el mismo comportamiento (una tubería).
//
// @param {string} text Transcript crudo (con wake word y posible eco ASR).
// @param {string[]} [wakeWords=[]] Palabras de activación configuradas.
// @returns {string} Mandato limpio y normalizado (sin wake word ni eco).
export function normalizeCommandForDeterministic(text = '', wakeWords = []) {
  let commandText = String(text || '').trim()
  if (!commandText || !wakeWords.length) return commandText

  // 1) Quitar TODAS las apariciones de wake word (no solo la primera) para
  //    tolerar el eco ASR duplicado.
  const candidates = wakeWords
    .map((ww) => String(ww || '').toLowerCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length) // compuestos primero
  let stripped = commandText
  for (const candidate of candidates) {
    // Reemplazo global insensible a mayúsculas/acentos.
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|\\s)${escaped}(?=\\s|$|,|\\.)`, 'gi')
    stripped = stripped.replace(re, ' ')
  }
  commandText = stripped.replace(/\s+/g, ' ').trim()

  // 2) Colapsar fragmentos duplicados del mandato: cuando el ASR repite el
  //    verbo ("generame ... genérame una nota"), nos quedamos con la última
  //    aparición completa. El patrón real es "VERBO una VERBO una NOTA ...":
  //    buscamos la ÚLTIMA ocurrencia de "VERBO [una|un] NOTA" y recortamos.
  //    NOTA: exec() solo devuelve la PRIMERA coincidencia, así que iteramos
  //    con el flag global para localizar la última (evita que el eco quede
  //    sin colapsar cuando la primera aparición está en el índice 0).
  const intentNoun = /(nota|cita|video|documento|recordatorio|alarma|temporizador|diario|compra|compras)\b/i
  const verbPhraseRe = /(genera|genérame|generame|generar|crea|crear|haz|hacer|pon|poner|ponme|guarda|guardar|anota|anotar|apunta|apuntar|agenda|agendar|programa|programar)\w*\s+(?:una\s+|un\s+)?(nota|cita|video|documento|recordatorio|alarma|temporizador|diario|compra|compras)\b/gi
  let lastIdx = -1
  let match = verbPhraseRe.exec(commandText)
  while (match) {
    lastIdx = match.index
    match = verbPhraseRe.exec(commandText)
  }
  if (lastIdx > 0) {
    // Recortar todo lo anterior a la última aparición del verbo.
    commandText = commandText.slice(lastIdx).trim()
  } else if (lastIdx === -1 && intentNoun.test(commandText)) {
    // Sin verbo duplicado pero con eco "Una ...": quitar un fragmento
    // "una/un" huérfano al inicio.
    commandText = commandText.replace(/^(?:una|un)\s+/i, '')
  }

  return commandText
}

export function cosineDistance(vectorA = [], vectorB = []) {
  const length = Math.min(vectorA.length, vectorB.length)
  if (!length) return 1

  let dot = 0
  let magA = 0
  let magB = 0

  for (let index = 0; index < length; index += 1) {
    const a = Number(vectorA[index] || 0)
    const b = Number(vectorB[index] || 0)
    dot += a * b
    magA += a * a
    magB += b * b
  }

  if (!magA || !magB) return 1
  const cosineSimilarity = dot / (Math.sqrt(magA) * Math.sqrt(magB))
  return 1 - Math.max(-1, Math.min(1, cosineSimilarity))
}

export function normalizeEmbeddingVector(vector = []) {
  if (!Array.isArray(vector) || !vector.length) return []
  const out = vector.map((value) => Number(value || 0))
  let norm = 0
  for (let index = 0; index < out.length; index += 1) {
    norm += out[index] * out[index]
  }
  norm = Math.sqrt(norm) || 1
  return out.map((value) => value / norm)
}

export function blendEmbeddingVectors(vectorA = [], vectorB = [], weightA = 0.5) {
  const dim = Math.max(vectorA.length, vectorB.length)
  if (!dim) return []
  const wa = Math.min(1, Math.max(0, Number(weightA) || 0.5))
  const blended = new Array(dim)
  for (let index = 0; index < dim; index += 1) {
    blended[index] =
      Number(vectorA[index] || 0) * wa + Number(vectorB[index] || 0) * (1 - wa)
  }
  return normalizeEmbeddingVector(blended)
}

/** Similitud coseno pura [0, 1]; 1 = misma identidad de voz. Vectores L2-normalizados antes del producto punto. */
export function cosineSimilarity(vectorA = [], vectorB = []) {
  if (!vectorA.length || !vectorB.length) return 0
  const a = normalizeEmbeddingVector(vectorA)
  const b = normalizeEmbeddingVector(vectorB)
  const dim = Math.min(a.length, b.length)
  let dot = 0
  for (let index = 0; index < dim; index += 1) {
    dot += a[index] * b[index]
  }
  if (!Number.isFinite(dot)) return 0
  return Math.max(0, Math.min(1, dot))
}

/**
 * Similitud coseno L2 explícita. Dueño único: speakerCosineStrict.js
 * (misma fórmula que compareCosineSignatures); aquí solo se re-exporta con
 * el nombre histórico para no duplicar el cuerpo (V18).
 */
export { compareCosineSignatures as compareAudioSignatures }

export function formatEmbeddingPreview(vector = [], { head = 3, tail = 2 } = {}) {
  if (!Array.isArray(vector) || !vector.length) return ''
  if (vector.length <= head + tail) {
    return `[${vector.map((v) => Number(v).toFixed(3)).join(', ')}]`
  }
  const start = vector.slice(0, head).map((v) => Number(v).toFixed(3))
  const end = vector.slice(-tail).map((v) => Number(v).toFixed(3))
  return `[${start.join(', ')}, …, ${end.join(', ')}] (${vector.length}d)`
}

/**
 * Firma de voz: embedding ECAPA-TDNN (192-D) vía Transformers.js.
 * @param {Float32Array|number[]} samples — PCM filtrado del turno
 */
export async function computeAudioSignature(samples = [], sampleRate = 48000) {
  if (!samples?.length) {
    return {
      vector: [],
      stats: { empty: true, dim: 0 },
    }
  }

  const vector = await computeSpeakerEmbedding(samples, sampleRate)
  return {
    vector: vector.length ? normalizeEmbeddingVector(vector) : [],
    stats: {
      dim: vector.length,
      source: 'wavlm-sv',
      sampleRate,
      samples: samples.length,
    },
  }
}

export function detectRole(text = '', language = 'es') {
  const normalized = stripDiacritics(text)
  const isEnglish = language === 'en'

  if (isEnglish) {
    if (/(student tutor|tutor|children|students|kids)/.test(normalized)) {
      return 'Tutor de Alumnos'
    }

    if (/(meeting coordinator|coordinator|technical council|cte|meeting)/.test(normalized)) {
      return 'Coordinador en Juntas'
    }

    if (/(teacher assistant|assistant|teacher|educator|instructor)/.test(normalized)) {
      return 'Asistente'
    }
    return ''
  }

  if (/(tutor de alumnos|tutor|ninos|alumnos de 5|alumnos de 6)/.test(normalized)) {
    return 'Tutor de Alumnos'
  }

  if (/(coordinador en juntas|coordinador|consejo tecnico|cte|junta)/.test(normalized)) {
    return 'Coordinador en Juntas'
  }

  if (/(asistente del maestro|asistente|docente|maestro|profesor)/.test(normalized)) {
    return 'Asistente'
  }

  return ''
}

const NAME_INTRO_PATTERNS = [
  /(?:^|\b)(?:yo\s+)?soy\s+([a-záéíóúüñ]+(?:\s+[a-záéíóúüñ]+){0,2})\b/i,
  /(?:^|\b)me\s+llamo\s+([a-záéíóúüñ]+(?:\s+[a-záéíóúüñ]+){0,2})\b/i,
  /(?:^|\b)mi\s+nombre\s+es\s+([a-záéíóúüñ]+(?:\s+[a-záéíóúüñ]+){0,2})\b/i,
  /(?:^|\b)llamame\s+([a-záéíóúüñ]+(?:\s+[a-záéíóúüñ]+){0,2})\b/i,
  /(?:^|\b)estoy\s+hablando\s+yo\s+([a-záéíóúüñ]{2,24})\b/i,
  /(?:^|\b)hablando\s+yo\s+([a-záéíóúüñ]{2,24})\b/i,
  /(?:^|\b)my\s+name\s+is\s+([a-záéíóúüñ]+(?:\s+[a-záéíóúüñ]+){0,2})\b/i,
]

const NAME_STOPWORDS = new Set([
  'maestro',
  'profesor',
  'profesora',
  'docente',
  'asistente',
  'alumno',
  'alumna',
  'tutor',
  'coordinador',
  'coordinadora',
  'director',
  'directora',
  'yo',
  'tu',
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'de',
  'del',
  'cuando',
  'quieras',
  'tienes',
  'quieren',
  'vino',
  'tinto',
  'ella',
  'representante',
  'okay',
  'flu',
  'generar',
  'minuta',
  'iniciar',
  'conversacion',
  'escucha',
  'cerrar',
])

const NAME_ARTICLE_TOKENS = new Set(['lo', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'al', 'del'])
const NAME_INVALID_PHRASES = [
  'lo antes posible',
  'antes posible',
  'lo mas pronto',
  'mas pronto',
  'lo posible',
  'tan pronto',
  'cuando quieras',
  'vino tinto',
  'generar minuta',
  'iniciar conversacion',
  'nadie para poder',
  'sin dificultades',
  'sin jadeos',
]

export function isPlausiblePersonName(candidate = '') {
  const normalized = normalizeSpaces(stripDiacritics(candidate)).toLowerCase()
  if (!normalized) return false
  if (NAME_INVALID_PHRASES.some((phrase) => normalized.includes(phrase))) return false

  // Wake words vienen SOLO de config (§9.4): un candidato que contenga una wake
  // word configurada no es un nombre.
  const normalizedCommand = normalizeVoiceCommandText(candidate)
  const wakeWords = FLU_CONFIG.voiceCommands?.wakeWords || []
  if (wakeWords.some((wakeWord) => {
    const key = normalizeVoiceCommandText(wakeWord)
    return key && normalizedCommand.includes(key)
  })) return false

  const tokens = normalized.split(' ').filter(Boolean)
  if (!tokens.length || tokens.length > 3) return false
  if (NAME_ARTICLE_TOKENS.has(tokens[0])) return false
  if (tokens.some((token) => NAME_STOPWORDS.has(token) || NAME_ARTICLE_TOKENS.has(token))) return false

  const nonNameWords = new Set([
    'antes',
    'posible',
    'pronto',
    'despues',
    'aqui',
    'ahora',
    'bien',
    'mal',
    'mas',
    'menos',
    'inutil',
    'util',
    'gentil',
  ])
  if (tokens.every((token) => nonNameWords.has(token))) return false

  return tokens.every((token) => token.length >= 2)
}

function toTitleCaseName(text = '') {
  return normalizeSpaces(text)
    .split(' ')
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

export function detectIntroducedName(text = '') {
  const normalized = normalizeSpaces(stripDiacritics(text))
  if (!normalized) return ''

  for (const pattern of NAME_INTRO_PATTERNS) {
    const match = normalized.match(pattern)
    if (!match?.[1]) continue

    const rawCandidate = normalizeSpaces(match[1]).toLowerCase()
    if (!rawCandidate) continue

    const tokens = rawCandidate.split(' ').filter(Boolean)
    if (!tokens.length || tokens.length > 3) continue

    // ASR suele pegar más frase tras el nombre («soy luis y no sustituyo…»). Probar prefijos.
    for (let count = tokens.length; count >= 1; count -= 1) {
      const candidate = tokens.slice(0, count).join(' ')
      if (tokens.slice(0, count).some((token) => NAME_STOPWORDS.has(token))) continue
      if (!isPlausiblePersonName(candidate)) continue
      return toTitleCaseName(candidate)
    }
  }

  return ''
}

/** Solo tras wake word (ok flu / oye flu …) + soy | me llamo | mi nombre es. */
export function detectWakeIntroducedName(text = '', wakeWords = []) {
  const split = splitTranscriptAtWakeWord(text, wakeWords)
  if (!split.wakeWordMatched) return ''

  const introText = normalizeSpaces(
    stripDiacritics(split.commandText || split.afterWake || ''),
  )
  if (!introText) return ''

  return detectIntroducedName(introText)
}

/** «yo Luis» / «soy Luis» sin wake, si el nombre ya está registrado en la sesión. */
export function detectSelfSpeakerName(text = '', registeredNames = []) {
  const snapshot = normalizeSpaces(stripDiacritics(text)).toLowerCase()
  if (!snapshot || !registeredNames?.length) return ''

  for (const rawName of registeredNames) {
    const name = normalizeSpaces(stripDiacritics(rawName)).toLowerCase()
    if (!name || name.split(/\s+/).length > 3) continue
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b(?:yo|soy)\\s+${escaped}\\b`).test(snapshot)) {
      return toTitleCaseName(name)
    }
    if (new RegExp(`\\b${escaped}\\b`).test(snapshot) && /\b(?:yo|soy)\b/.test(snapshot)) {
      return toTitleCaseName(name)
    }
  }
  return ''
}

export function extractTheme(text = '', role = '', wakeWords = []) {
  const normalizedText = stripDiacritics(removeWakeWord(text, wakeWords))
  const normalizedRole = stripDiacritics(role)
  let theme = normalizedText

  if (normalizedRole) {
    theme = theme.replace(normalizedRole, '')
  }

  theme = theme
    .replace(/(soy|quiero|vamos a|vamos a hablar de|hablar de|sobre|el tema de|tema|rol|como|como un|como una)/g, ' ')
    .replace(/\b(tutor de alumnos|coordinador en juntas|asistente del maestro|tutor|coordinador|asistente|maestro|profesor|docente)\b/g, ' ')

  theme = normalizeSpaces(theme)
  if (!theme) return FLU_CONFIG.sessionDefaults?.theme || ''
  return theme
}

export function formatClock(date = new Date()) {
  return date.toLocaleTimeString('es-MX', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

