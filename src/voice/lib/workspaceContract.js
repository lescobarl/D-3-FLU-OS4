import { cleanForSpeech, isVisualRequestText, stripDiacritics } from './audioMath.js'
import { FLU_CONFIG } from './fluConfig.js'
import { VISUAL_CONFIG } from './visualConfig.js'

const VISUAL_WORKSPACE_TIPOS = ['image_prompt', 'diagram', '3d']

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

export function isVisualWorkspaceTipo(tipo = '') {
  return VISUAL_WORKSPACE_TIPOS.includes(String(tipo || '').trim().toLowerCase())
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
 * @param {object|null|undefined} workspace
 */
export function normalizeWorkspaceContract(workspace) {
  if (!workspace || typeof workspace !== 'object') return null

  const tipo = String(workspace.tipo || 'text').trim().toLowerCase()
  const titulo = cleanForSpeech(workspace.titulo || '')
  const contenido = cleanForSpeech(workspace.contenido || '')
  const promptVisual = cleanForSpeech(workspace.prompt_visual || '')
  const puntos_clave = Array.isArray(workspace.puntos_clave)
    ? workspace.puntos_clave.map((item) => String(item || '').trim()).filter(Boolean)
    : []

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

  if (isBareVisualRequest(transcript)) {
    return language === 'en'
      ? [
          'Visual request without a concrete subject in this utterance.',
          'Infer prompt_visual from the recent conversation thread (user turns and session topic).',
          'Use a specific renderable scene (subject, setting, style). Never generic abstract placeholders.',
          'If the thread has no visual topic, ask briefly in respuesta_voz and use workspace.tipo text.',
        ].join(' ')
      : [
          'Petición visual sin sujeto concreto en esta frase.',
          'Infiere prompt_visual del hilo reciente de conversación (turnos del usuario y tema de sesión).',
          'Escena renderizable específica (sujeto, entorno, estilo). Prohibido placeholder abstracto genérico.',
          'Si no hay tema visual en el hilo, pregunta brevemente en respuesta_voz y usa workspace.tipo text.',
        ].join(' ')
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
