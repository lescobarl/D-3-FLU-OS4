import { computeSpeakerEmbedding } from './speakerEmbedding.js'
import { FLU_CONFIG } from './fluConfig.js'
import { detectParticipantFloorCommand } from './participantFloor.js'
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

function levenshteinDistance(left = '', right = '') {
  const a = String(left)
  const b = String(right)
  if (!a.length) return b.length
  if (!b.length) return a.length

  const matrix = Array.from({ length: a.length + 1 }, (_, row) => [row])
  for (let column = 1; column <= b.length; column += 1) {
    matrix[0][column] = column
  }

  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost,
      )
    }
  }

  return matrix[a.length][b.length]
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

function speechWords(text = '') {
  return cleanForSpeech(text).toLowerCase().split(/\s+/).filter(Boolean)
}

/** Quita eco TV/ASR repetido al inicio de la pregunta tras «ok flu» (p. ej. «primeros partidos platicame…»). */
export function peelWakeQuestionEcho(question = '', echoSources = []) {
  let words = speechWords(question)
  if (words.length < 2) return cleanForSpeech(question)

  for (const source of echoSources) {
    const srcWords = speechWords(source)
    if (!srcWords.length) continue
    for (let len = Math.min(8, words.length - 1); len >= 1; len -= 1) {
      const prefixStr = words.slice(0, len).join(' ')
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

export function splitTranscriptAtWakeWord(text = '', wakeWords = []) {
  const normalizedText = normalizeVoiceCommandText(text)
  if (!normalizedText) {
    return {
      wakeWordMatched: false,
      beforeWake: '',
      afterWake: '',
      commandText: '',
      normalizedText: '',
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
export function resolveCommandConversationLogText(phrase = '', split = {}, passivePrefix = '') {
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
  const beforeWake = cleanForSpeech(split.beforeWake)
  const afterWakeRaw = cleanForSpeech(split.afterWake || split.commandText || '')
  /** Solo pelar eco TV (beforeWake); lastCommitted solo en wake inline con TV — no repetir fila del usuario. */
  const echoSources = beforeWake
    ? [beforeWake, cleanForSpeech(lastCommitted)].filter(Boolean)
    : [beforeWake].filter(Boolean)
  const afterWake = peelWakeQuestionEcho(afterWakeRaw, echoSources)

  if (split.wakeWordMatched && afterWake && isMinuteKnowledgeRequest(afterWake)) {
    return {
      kind: 'flu',
      question: afterWake,
      beforeWake,
    }
  }

  const floorCommand = detectParticipantFloorCommand(afterWake, voiceCommands)
  if (split.wakeWordMatched && floorCommand) {
    return { kind: 'command', command: floorCommand }
  }

  const command = detectSessionVoiceCommand(text, voiceCommands)
  if (command) return { kind: 'command', command }

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
    question: afterWake,
    beforeWake,
  }
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

  const action = resolveFinalConversationAction(phrase, voiceCommands, {
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

function hannWindow(length) {
  const window = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (length - 1 || 1)))
  }
  return window
}

function estimatePitch(frame, sampleRate) {
  const size = frame.length
  if (!size || !sampleRate) return 0

  let rms = 0
  for (let index = 0; index < size; index += 1) {
    rms += frame[index] * frame[index]
  }
  rms = Math.sqrt(rms / size)
  if (rms < 0.01) return 0

  let bestLag = 0
  let bestCorrelation = 0
  const minLag = Math.floor(sampleRate / 400)
  const maxLag = Math.min(Math.floor(sampleRate / 60), size - 1)

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0
    for (let index = 0; index < size - lag; index += 1) {
      correlation += frame[index] * frame[index + lag]
    }

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation
      bestLag = lag
    }
  }

  return bestLag ? sampleRate / bestLag : 0
}

function analyzeSpectrum(frame, sampleRate) {
  const size = frame.length
  if (!size || !sampleRate) {
    return {
      centroid: 0,
      dominantFrequency: 0,
      energy: 0,
      pitch: 0,
    }
  }

  const window = hannWindow(size)
  const sample = new Float32Array(size)
  let energy = 0

  for (let index = 0; index < size; index += 1) {
    sample[index] = frame[index] * window[index]
    energy += sample[index] * sample[index]
  }

  let dominantFrequency = 0
  let dominantMagnitude = 0
  let weightedFrequencySum = 0
  let weightedMagnitudeSum = 0
  const maxBins = Math.min(64, Math.floor(size / 2))

  for (let bin = 1; bin < maxBins; bin += 1) {
    let real = 0
    let imaginary = 0

    for (let sampleIndex = 0; sampleIndex < size; sampleIndex += 1) {
      const angle = (-2 * Math.PI * bin * sampleIndex) / size
      real += sample[sampleIndex] * Math.cos(angle)
      imaginary += sample[sampleIndex] * Math.sin(angle)
    }

    const magnitude = Math.hypot(real, imaginary)
    const frequency = (bin * sampleRate) / size
    weightedFrequencySum += frequency * magnitude
    weightedMagnitudeSum += magnitude
    if (magnitude > dominantMagnitude) {
      dominantMagnitude = magnitude
      dominantFrequency = frequency
    }
  }

  const centroid = weightedMagnitudeSum ? weightedFrequencySum / weightedMagnitudeSum : 0
  const pitch = estimatePitch(frame, sampleRate)
  let zeroCrossings = 0
  for (let index = 1; index < size; index += 1) {
    const prev = frame[index - 1]
    const current = frame[index]
    if ((prev >= 0 && current < 0) || (prev < 0 && current >= 0)) {
      zeroCrossings += 1
    }
  }
  const zeroCrossingRate = size > 1 ? zeroCrossings / (size - 1) : 0

  return {
    centroid,
    dominantFrequency,
    energy: energy / size,
    pitch,
    zeroCrossingRate,
  }
}

function downsampleBuffer(samples, sampleRate, targetRate = 16000) {
  if (!samples?.length || sampleRate <= targetRate) return samples
  const ratio = sampleRate / targetRate
  const length = Math.max(1, Math.floor(samples.length / ratio))
  const result = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    result[index] = samples[Math.min(samples.length - 1, Math.floor(index * ratio))]
  }
  return result
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

/** Similitud coseno L2 explícita (misma fórmula que voiceIdentity.compareAudioSignatures). */
export function compareAudioSignatures(sig1 = [], sig2 = []) {
  if (!Array.isArray(sig1) || !Array.isArray(sig2) || !sig1.length || !sig2.length) {
    return 0
  }
  const dim = Math.min(sig1.length, sig2.length)
  let dot = 0
  let norm1 = 0
  let norm2 = 0
  for (let i = 0; i < dim; i += 1) {
    const a = Number(sig1[i] || 0)
    const b = Number(sig2[i] || 0)
    dot += a * b
    norm1 += a * a
    norm2 += b * b
  }
  const denom = Math.sqrt(norm1) * Math.sqrt(norm2)
  if (!denom || !Number.isFinite(denom)) return 0
  const similarity = dot / denom
  if (!Number.isFinite(similarity)) return 0
  return Math.max(0, Math.min(1, similarity))
}

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
  'okay flu',
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

