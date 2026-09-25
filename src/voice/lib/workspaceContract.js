import { cleanForSpeech, isVisualRequestText, stripDiacritics, splitTranscriptAtWakeWord } from './audioMath.js'
import { FLU_CONFIG } from './fluConfig.js'
import { VISUAL_CONFIG } from './visualConfig.js'

const VISUAL_WORKSPACE_TIPOS = ['image_prompt', 'diagram', '3d']

// Tipos de generación de documento/video (disparan documentGeneration).
const GENERATION_WORKSPACE_TIPOS = ['doc', 'video']

const HORARIO_WORKSPACE_MODOS = ['semana', 'dia', 'proxima', 'recordatorios']

const VISUAL_COMMAND_PATTERNS = [
  /^(ok\s+flu[,]?\s*)+/i,
  /\b(genera(rme)?|crea(r)?|muestra(r)?|haz(me)?|dibuja(r)?)\s+(?:(?:una?|la|el|un)\s+)?(imagen|foto|visual|ilustraci[oó]n|diagrama|render)\s+(?:de|del|de la|sobre|con)?\s*/gi,
  /\b(ahora\s+)?(genera(r)?|crea(r)?)\s+(?:(?:una?|la|el|un)\s+)?(imagen|foto|visual)\s+(?:de|del|de la|sobre)?\s*/gi,
  /\b(quiero|necesito|puedes)\s+(ver|mostrar|generar)\s+(?:(?:una?|la|el|un)\s+)?(imagen|foto|visual)\s+(?:de|del|de la|sobre)?\s*/gi,
  /\b(incluye|incluir|con)\s+(?:(?:una?|la|el|un)\s+)?(imagen|foto|visual)\s*(?:de|del|de la|sobre)?\s*/gi,
]

function normalizeBareText(text = '') {
  return stripDiacritics(cleanForSpeech(text).toLowerCase())
}

/**
 * Quita del transcript el verbo/gatillo de generación al inicio
 * ("crea un video de un conejo saltando" → "de un conejo saltando") para usar
 * el resto como asunto del documento/video cuando el modelo no aportó contenido.
 */
function stripGenerationLead(text = '', voiceCommands = null) {
  const cleaned = cleanForSpeech(text)
  if (!cleaned) return ''
  const vc = voiceCommands || (FLU_CONFIG.voiceCommands || {})
  const split = splitTranscriptAtWakeWord(cleaned, vc.wakeWords || [])
  const body = cleanForSpeech(split.afterWake || split.commandText || cleaned)
  if (!body) return ''
  const phrases = [...(vc.generateDocument || []), ...(vc.generateVideo || [])]
    .map((phrase) => normalizeBareText(phrase))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  const norm = normalizeBareText(body)
  for (const target of phrases) {
    if (!norm.startsWith(target)) continue
    const words = target.split(/\s+/).filter(Boolean).length
    return body.split(/\s+/).filter(Boolean).slice(words).join(' ')
  }
  return body
}

/**
 * Extrae sujeto visual del transcript (solo ancla de prompt a Gemini, no gate de imagen).
 * @param {string} transcript
 * @param {string} responseText
 */
export function extractVisualSubject(transcript = '', responseText = '') {
  let subject = cleanForSpeech(transcript)
  if (!subject) return ''

  for (const pattern of VISUAL_COMMAND_PATTERNS) {
    subject = subject.replace(pattern, ' ').trim()
  }

  subject = cleanForSpeech(subject)

  const response = cleanForSpeech(responseText).toLowerCase()
  const noiseWords = VISUAL_CONFIG.image.prompt.noiseWords || []
  for (const noise of noiseWords) {
    if (!noise) continue
    const normalizedNoise = stripDiacritics(String(noise)).toLowerCase()
    if (response.includes(normalizedNoise) && subject.toLowerCase().includes(normalizedNoise)) {
      subject = cleanForSpeech(subject.replace(new RegExp(normalizedNoise, 'ig'), ' '))
    }
  }

  if (response && subject.toLowerCase() === response.toLowerCase()) {
    return ''
  }

  return subject
}

export function isBareVisualRequest(transcript = '') {
  const cleaned = cleanForSpeech(transcript)
  if (!cleaned || !isVisualRequestText(cleaned)) return false
  const subject = extractVisualSubject(cleaned)
  if (!subject) return true
  const norm = normalizeBareText(subject)
  const patterns = VISUAL_CONFIG.image.prompt.bareVisualPatterns || []
  return patterns.some((pattern) => pattern.test(norm))
}

export function isGenericVisualPrompt(text = '') {
  const norm = cleanForSpeech(text)
  if (!norm) return true
  const patterns = VISUAL_CONFIG.image.prompt.genericPromptPatterns || []
  return patterns.some((pattern) => pattern.test(norm))
}

/**
 * Detecta calificador visual explícito («con imágenes», «con fotos», «incluye
 * imágenes»). Aunque la frase sea de explicación («háblame de los aviones con
 * imágenes»), el usuario pidió imágenes de forma explícita → forzar image_prompt.
 * @param {string} transcript
 */
export function hasExplicitVisualQualifier(transcript = '') {
  const cleaned = cleanForSpeech(transcript)
  if (!cleaned) return false
  const patterns = VISUAL_CONFIG.image.prompt.explicitVisualQualifierPatterns || []
  return patterns.some((pattern) => {
    // Los patrones usan la bandera /g (stateful): reiniciamos lastIndex para
    // que .test() no dependa de llamadas anteriores sobre el mismo objeto.
    pattern.lastIndex = 0
    return pattern.test(cleaned)
  })
}

export function isVisualWorkspaceTipo(tipo = '') {
  return VISUAL_WORKSPACE_TIPOS.includes(String(tipo || '').trim().toLowerCase())
}

export function isGenerationWorkspaceTipo(tipo = '') {
  return GENERATION_WORKSPACE_TIPOS.includes(String(tipo || '').trim().toLowerCase())
}

/**
 * Detecta una petición EXPLÍCITA de generar video o documento en el transcript
 * del usuario ("genera un video de un conejo", "crea una carta sobre…"). Se usa
 * como fuente de verdad CLIENTE cuando el modelo devuelve un tipo incoherente
 * (video pedido → tipo text/doc, carta → tipo video/doc erróneo).
 *
 * Reglas (sin false positives de pregunta/cómo-se-hace):
 *   - Se evalúa sobre el texto tras la wake word (si la hubiera).
 *   - Se ignora si es pregunta ("¿qué es un video?", "cómo se crea una carta").
 *   - El transcript debe EMPEZAR con una frase canónica de generación de
 *     video/documento (voiceCommands.generateVideo / generateDocument).
 *
 * @param {string} transcript
 * @param {object|null|undefined} [voiceCommands]
 * @returns {'video'|'doc'|null} tipo explícito o null si no hay petición clara.
 */
export function detectExplicitGenerationTipo(transcript = '', voiceCommands = null) {
  const text = cleanForSpeech(transcript)
  if (!text) return null
  // Preguntas / cómo-se-hace no son órdenes de generación.
  if (
    /^(?:como|como\s+se|como\s+puedo|que\s+es|que\s+es\s+un|que\s+es\s+una|cual|cuales|cuando|donde|por\s+que|para\s+que|hay\s+que|explicame|dime|cuentame)\b/i.test(text)
  ) {
    return null
  }
  if (
    /como\s+(?:se\s+)?(?:crea|creo|crear|genera|genero|generar|hago|hacer|puedo|puedes)|que\s+significa|dime\s+(?:que|como)\b|aprende\s+a|ense[ñn]ame/i.test(
      text,
    )
  ) {
    return null
  }

  const vc = voiceCommands || (FLU_CONFIG.voiceCommands || {})
  const wakeWords = vc.wakeWords || []
  const split = splitTranscriptAtWakeWord(text, wakeWords)
  const body = cleanForSpeech(split.afterWake || split.commandText || text)
  if (!body) return null
  const norm = normalizeBareText(body)
  const startsWithCanonical = (phrases = []) =>
    phrases.some((phrase) => {
      const target = normalizeBareText(phrase)
      return Boolean(target && norm.startsWith(target))
    })

  if (startsWithCanonical(vc.generateVideo)) return 'video'
  if (startsWithCanonical(vc.generateDocument)) return 'doc'
  return null
}

/** Gate único: la IA incluyó workspace visual con brief usable. */
export function shouldGenerateWorkspaceImage(workspace = null) {
  if (!workspace || typeof workspace !== 'object') return false
  if (!isVisualWorkspaceTipo(workspace.tipo)) return false
  const core = cleanForSpeech(
    workspace.prompt_visual || workspace.contenido || workspace.titulo || '',
  )
  if (!core || isGenericVisualPrompt(core)) return false
  return true
}

/**
 * Normaliza workspace devuelto por Gemini. Sin workspace de la IA → null (sin sintetizar desde voz).
 * NO duplica `generationTopic.normalizeWorkspaceDocumentFields`: aquí se
 * normaliza el contrato completo (tipo/prompt_visual/puntos_clave).
 * @param {object|null|undefined} workspace
 * @param {{ transcript?: string, voiceCommands?: object }} [options]
 */
export function normalizeWorkspaceContract(workspace, options = {}) {
  if (!workspace || typeof workspace !== 'object') return null

  const transcript = cleanForSpeech(options?.transcript || '')
  const explicitTipo = transcript
    ? detectExplicitGenerationTipo(transcript, options?.voiceCommands)
    : null

  const tipo = explicitTipo
    || String(workspace.tipo || 'text').trim().toLowerCase()
  const titulo = cleanForSpeech(workspace.titulo || '')
  const contenido = cleanForSpeech(workspace.contenido || '')
  const promptVisual = cleanForSpeech(workspace.prompt_visual || '')
  const puntos_clave = Array.isArray(workspace.puntos_clave)
    ? workspace.puntos_clave.map((item) => String(item || '').trim()).filter(Boolean)
    : []

  // Cuando la petición explícita es doc/video pero el modelo no dio contenido
  // (devolvió tipo text con solo texto), el asunto se recupera del transcript
  // para que el generador tenga un tema real que desarrollar.
  const explicitLeadStripped = transcript
    ? stripGenerationLead(cleanForSpeech(transcript), options?.voiceCommands)
    : ''

  // Horario de clases: se preserva el tipo y el modo para el renderer del Pizarrón.
  if (tipo === 'horario') {
    const modo = HORARIO_WORKSPACE_MODOS.includes(String(workspace.modo || '').trim().toLowerCase())
      ? String(workspace.modo).trim().toLowerCase()
      : 'semana'
    if (!titulo && !contenido && !puntos_clave.length) return null
    return {
      titulo,
      tipo: 'horario',
      modo,
      contenido,
      puntos_clave,
    }
  }

  if (isVisualWorkspaceTipo(tipo)) {
    const visualCore = promptVisual || contenido || titulo
    if (!visualCore || isGenericVisualPrompt(visualCore)) return null
    return {
      titulo: titulo || visualCore,
      tipo,
      contenido: contenido || visualCore,
      prompt_visual: visualCore,
      puntos_clave,
    }
  }

  // Generación de documento/video: se preserva el tipo para que el dispatch de
  // onContractResolved dispare documentGeneration.generate('pdf'|'video'). El
  // tipo se CORRIGE por petición explícita del usuario cuando el modelo emite
  // uno incoherente (Bug #5/#6: "crea un video" → text/doc, "genera una carta"
  // → video).
  if (isGenerationWorkspaceTipo(tipo)) {
    const core = contenido || titulo || promptVisual || (explicitTipo ? explicitLeadStripped : '')
    if (!core) return null
    return {
      titulo: titulo || (explicitTipo ? 'Documento' : 'Documento'),
      tipo,
      contenido: core,
      prompt_visual: promptVisual,
      puntos_clave,
    }
  }

  if (!titulo && !contenido && !puntos_clave.length && !promptVisual) return null

  return {
    titulo,
    tipo: 'text',
    contenido,
    prompt_visual: promptVisual,
    puntos_clave,
  }
}

/**
 * Recorta el historial al tramo más reciente para resúmenes/minutas.
 * @param {Array<object>} history
 * @param {number|null|undefined} limit
 */
export function selectConversationSummaryWindow(history = [], limit) {
  const rows = Array.isArray(history) ? history.filter(Boolean) : []
  const max =
    Number.isFinite(limit) && limit > 0
      ? limit
      : FLU_CONFIG.limits.conversationSummaryWindowMax || rows.length

  return [...rows]
    .sort((left, right) => (Number(left?.timestamp) || 0) - (Number(right?.timestamp) || 0))
    .slice(-max)
}

/**
 * Bloque de ancla visual para prompts Gemini (contexto al modelo, no gate en cliente).
 * @param {string} transcript
 * @param {string} language
 */
export function buildVisualAnchorBlock(transcript = '', language = 'es') {
  if (!isVisualRequestText(transcript)) return ''

  // Calificador visual explícito («con imágenes», «con fotos»): aunque la frase
  // sea de explicación, el usuario pidió imágenes → forzar image_prompt.
  if (hasExplicitVisualQualifier(transcript)) {
    const anchor = VISUAL_CONFIG.image.prompt.explicitVisualAnchor || {}
    const text = anchor[language] || anchor.es
    if (text) return text
  }

  if (isBareVisualRequest(transcript)) {
    // Regla #1 (sin hardcode): el texto del ancla vive en VISUAL_CONFIG.
    const anchor = VISUAL_CONFIG.image.prompt.bareVisualAnchor || {}
    const text = anchor[language] || anchor.es
    if (text) return text
  }

  const subject = extractVisualSubject(transcript)
  if (!subject) return ''

  if (language === 'en') {
    return [
      `Visual anchor: base workspace output on the current request subject ("${subject}").`,
      'Do not reuse summary, presentation or minute layout from prior assistant replies.',
    ].join(' ')
  }

  return [
    `Ancla visual: basa el workspace en el sujeto de la peticion actual ("${subject}").`,
    'No reutilices resumen, presentacion o minuta de respuestas anteriores del asistente.',
  ].join(' ')
}

/**
 * Frases de arranque conversacional que no forman parte del tema en sí y que se
 * eliminan al extraer el tema del hilo (p. ej. "Platícame de los conejos que
 * hablan" → "los conejos que hablan"). Config-driven (Regla #1): el listado vive
 * en VISUAL_CONFIG.image.prompt.topicLeadPatterns.
 */
function cleanConversationTopic(text = '') {
  let topic = cleanForSpeech(text)
  if (!topic) return ''
  const patterns = VISUAL_CONFIG.image.prompt.topicLeadPatterns || []
  for (const pattern of patterns) {
    if (!pattern) continue
    topic = topic.replace(pattern, ' ').trim()
  }
  topic = cleanForSpeech(topic)
  return topic
}

/**
 * Extrae el tema más reciente del hilo de conversación (turno de usuario) para
 * usarlo como sujeto de una petición visual sin sujeto concreto.
 * @param {Array<object>} history
 * @returns {string}
 */
export function extractConversationTopic(history = []) {
  const rows = Array.isArray(history) ? history.filter(Boolean) : []
  // Recorremos de atrás hacia adelante buscando el último turno de usuario con
  // texto sustancial (no eco de la propia respuesta del asistente).
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const entry = rows[i]
    const role = String(entry?.role || entry?.speaker || '').toLowerCase()
    const isUser = role === 'user' || role === 'usuario' || role === 'human'
    if (!isUser) continue
    const text = cleanForSpeech(entry?.text || entry?.content || entry?.transcript || '')
    if (!text) continue
    // Ignorar turnos que son meras peticiones visuales vacías o eco de la
    // respuesta del asistente (no aportan un tema concreto).
    if (isBareVisualRequest(text)) continue
    if (text.length < 3) continue
    const topic = cleanConversationTopic(text)
    if (!topic) continue
    return topic
  }
  return ''
}

/**
 * Fallback determinista (Regla #1: texto desde VISUAL_CONFIG, sin hardcode).
 * Cuando el usuario hace una petición visual SIN sujeto ("generame una imagen")
 * y el modelo no devolvió workspace.tipo=image_prompt, el servidor construye el
 * workspace de forma determinista a partir del tema del hilo de conversación.
 * Así la imagen SIEMPRE se genera cuando el hilo tiene un tema, sin depender de
 * que el modelo siga el ancla del prompt.
 *
 * @param {string} transcript
 * @param {Array<object>} history
 * @param {string} language
 * @returns {object|null} workspace image_prompt determinista o null si no hay tema.
 */
export function buildBareVisualFallbackWorkspace(transcript = '', history = [], language = 'es') {
  if (!isBareVisualRequest(transcript)) return null

  const subject = extractConversationTopic(history)
  if (!subject) return null

  const cfg = VISUAL_CONFIG.image.prompt.bareVisualFallback || {}
  const langCfg = cfg[language] || cfg.es || {}
  const promptVisual = typeof langCfg.promptVisual === 'function'
    ? langCfg.promptVisual(subject)
    : `Escena renderizable del tema conversado: ${subject}.`
  const titulo = langCfg.titulo || 'Imagen del tema conversado'

  return {
    titulo,
    tipo: 'image_prompt',
    contenido: promptVisual,
    prompt_visual: promptVisual,
    puntos_clave: [],
    _fallback: true,
    _subject: subject,
    _respuestaVoz: typeof langCfg.respuestaVoz === 'function'
      ? langCfg.respuestaVoz(subject)
      : '',
  }
}
