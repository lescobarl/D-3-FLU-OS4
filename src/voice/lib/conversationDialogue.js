/**
 * Turnos de conversación: un participante = una fila en log + contexto Gemini.
 * Flu usa el mismo mecanismo que los hablantes automáticos (sin canal paralelo).
 */
import { cleanForSpeech } from './audioMath.js'
import { resolveRowSpeakerLabel } from './conversationRow.js';
import { FLU_CONFIG } from './fluConfig.js'
import { equalsTrimmed } from '../../lib/textUtils.ts'
import { pickText } from '../../lib/uiStrings.ts'

const FALLBACK_SPEAKER = FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker

export const FLU_DIALOGUE_SPEAKER = 'Flu'

const DIALOGUE_SOURCE = Object.freeze({
  LOG: 'log',
  QUERY: 'query',
  PARTICIPANT: 'participant',
  CAPTURE: 'capture',
})

export function isFluSpeaker(speaker = '') {
  return equalsTrimmed(speaker, FLU_DIALOGUE_SPEAKER)
}

/**
 * ÚNICA regla de la frase canónica de un turno: el texto que el MÓDULO commiteó
 * (o el fallback de la captura del ASR), recortado. Las dos puertas que la
 * aplican — el cierre del turno (`commitTurnPhrase` en el hook) y la petición a
 * la IA sobre la fila commiteada — usan esta misma regla: display === fila por
 * construcción, sin un segundo criterio de texto.
 * @param {unknown} text Texto canónico del módulo.
 * @param {unknown} [fallback] Texto de respaldo (captura del ASR).
 * @returns {string} Frase canónica del turno ('' si no hay texto).
 * @revisor CREAR NUEVO — la regla canónica del turno sale del hook a este
 *   módulo; el hook delega en ella en este mismo cambio.
 */
export function fraseCanonicaDelTurno(text, fallback = '') {
  return String(text || '').trim() || String(fallback || '').trim()
}

function trimDialogueHistory(history = [], max = FLU_CONFIG.limits.contextHistoryMax) {
  const limit = Number(max)
  if (!Number.isFinite(limit) || limit <= 0) return [...history]
  return history.length <= limit ? [...history] : history.slice(-limit)
}


export function appendDialogueEntry(history = [], entry = {}, max = FLU_CONFIG.limits.contextHistoryMax) {
  // OS4: incluye respuesta_voz — las respuestas de Gemini llegan bajo ese campo
  // en el contrato y, si se conserva esa forma, debe persistirse igual que text.
  const text = cleanForSpeech(entry.text || entry.transcript || entry.respuesta_voz || '')
  if (!text) return [...history]

  const speaker =
    String(entry.speaker || '').trim() ||
    (entry.role === 'assistant' ? FLU_DIALOGUE_SPEAKER : FALLBACK_SPEAKER)

  const normalized = {
    role: entry.role === 'assistant' || isFluSpeaker(speaker) ? 'assistant' : 'user',
    speaker,
    text,
    phase: entry.phase || 'SESION_ACTIVA',
    source: entry.source || DIALOGUE_SOURCE.LOG,
  }

  return trimDialogueHistory([...history, normalized], max)
}



/**
 * §9 ÚNICA FUENTE DE VERDAD: deriva el diálogo de Gemini DESDE el store
 * `conversationHistory`. No existe un almacén de diálogo independiente; el motor
 * de voz consume estas vistas de solo lectura.
 */
export function deriveDialogueHistory(conversationHistory = []) {
  const list = Array.isArray(conversationHistory) ? conversationHistory : []
  return list.map((entry) => ({
    role: entry?.role === 'flu' ? 'assistant' : entry?.role === 'system' ? 'system' : 'user',
    speaker: resolveRowSpeakerLabel(entry) || (entry?.role === 'flu' ? FLU_DIALOGUE_SPEAKER : FALLBACK_SPEAKER),
    text: entry?.text || '',
    phase: entry?.phase || 'SESION_ACTIVA',
    source: DIALOGUE_SOURCE.LOG,
    // Turno de la fila (lo acuña el módulo): la petición a la IA lo recorta
    // para que el turno vigente viaje SOLO como petición final.
    turnId: entry?.turnId ?? null,
  }))
}

/** Textos de las filas de usuario commiteadas, derivados del store. */
export function deriveUserRowTexts(conversationHistory = []) {
  const list = Array.isArray(conversationHistory) ? conversationHistory : []
  return list.filter((entry) => entry?.role === 'user').map((entry) => entry?.text || '')
}

/** Hablantes de las filas de usuario commiteadas, derivados del store. */
export function deriveUserRowSpeakers(conversationHistory = []) {
  const list = Array.isArray(conversationHistory) ? conversationHistory : []
  return list
    .filter((entry) => entry?.role === 'user')
    .map((entry) => resolveRowSpeakerLabel(entry) || FALLBACK_SPEAKER)
}

/**
 * §9.3: Última frase de usuario commiteada, derivada del store (fuente única de
 * la frase visible). Reemplaza el escaneo inline duplicado en App/consumidores.
 */
export function deriveUserLastText(conversationHistory = []) {
  const list = Array.isArray(conversationHistory) ? conversationHistory : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const entry = list[index]
    if (!entry) continue
    const role = String(entry.role || '').toLowerCase()
    const speaker = String(resolveRowSpeakerLabel(entry) || '')
    if (role === 'user' || (speaker && speaker !== FLU_DIALOGUE_SPEAKER)) {
      return String(entry.text || '').trim()
    }
  }
  return ''
}

/**
 * Última frase que FLU ha dicho, derivada del store.
 *
 * El detector de eco del ingress solo comparaba contra filas de USUARIO, así que
 * no podía reconocer el TTS de FLU re-capturado por el micrófono: esa voz entraba
 * como turno de una persona y se mezclaba con el hablante real («FLU y yo como
 * Hablante 1»). Esta vista le da al ingress lo que FLU acaba de decir.
 */
export function deriveAssistantLastText(conversationHistory = []) {
  const entry = lastFluEntry(conversationHistory)
  return entry ? String(entry.text || '').trim() : ''
}

/** Cuando se dijo esa ultima frase (ms epoch), para el detector de ECO del ingress. */
/**
 * Contexto de eco de la propia voz de FLU para el ingress: el texto que FLU dijo
 * y el instante en que TERMINO de hablar (el ingress lo usa para no tomar su TTS
 * por un turno de persona). La fila de FLU se escribe ANTES de hablar, asi que
 * anclar la ventana de eco solo a la fila la dejaba expirada mientras FLU seguia
 * hablando y su cola entraba como turno de persona; con el fin del habla, la
 * ventana cubre el TTS completo. Fuente unica del instante de habla: fluSpeech.
 */
export function resolveEchoContext(conversationHistory = [], completedSpeechAt = 0) {
    return {
        lastAssistantText: deriveAssistantLastText(conversationHistory),
        lastAssistantAtMs: Math.max(deriveAssistantLastAtMs(conversationHistory), Number(completedSpeechAt) || 0),
    }
}

function deriveAssistantLastAtMs(conversationHistory = []) {
  const entry = lastFluEntry(conversationHistory)
  const at = Number(entry?.timestamp)
  return Number.isFinite(at) && at > 0 ? at : 0
}

/** Seleccion UNICA de "la ultima frase de FLU": las dos vistas vienen de aqui. */
function lastFluEntry(conversationHistory = []) {
  const list = Array.isArray(conversationHistory) ? conversationHistory : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const entry = list[index]
    if (entry?.role === 'flu') return entry
  }
  return null
}

/**
 * §9.3: ÚNICA derivación de la frase visible (burbuja · bitácora · barra).
 * Todas las vistas la consumen con los MISMOS insumos → misma cadena exacta.
 * No normaliza: solo selecciona la fuente vigente por prioridad.
 */
export function selectVisiblePhrase({
  live = '',
  lastTranscript = '',
  lastUserText = '',
  currentTranscript = '',
} = {}) {
  return String(live || lastTranscript || lastUserText || currentTranscript || '').trim()
}

export function getDialogueContextSlice(history = [], max = FLU_CONFIG.limits.contextHistoryMax) {
  return trimDialogueHistory(history, max)
}

/**
 * Historial del contexto SIN las filas de un turno.
 *
 * El turno vigente viaja SOLO como petición final de la IA; si además entrara
 * en el historial, el modelo lo leería como una petición anterior sin
 * responder. El turnId de cada fila lo escribió el módulo.
 * @param {Array<object>} history Entradas del diálogo (con `turnId`).
 * @param {string|number} turnId Turno que se está pidiendo.
 * @returns {Array<object>} Historial sin las filas de ESE turno.
 * @revisor CREAR NUEVO — único recorte del turno vigente en el contexto; sale
 *   del hook a la derivación del diálogo y el hook delega en este cambio.
 */
export function sinTurnoDelHistorial(history = [], turnId = '') {
  const list = Array.isArray(history) ? history : []
  const clave = String(turnId ?? '').trim()
  if (!clave) return list
  return list.filter((entry) => String(entry?.turnId ?? '').trim() !== clave)
}

/**
 * ¿La entrada es un turno del usuario (no de FLU)? `flu` también es FLU.
 * @param {object|null} entrada Entrada del diálogo.
 * @returns {boolean}
 * @revisor CREAR NUEVO — el criterio de turno de usuario sale de gemini (dueño
 *   del prompt) al módulo de diálogo; el original se elimina en este cambio.
 */
export function esTurnoDeUsuario(entrada = null) {
  return !(entrada?.role === 'assistant' || entrada?.role === 'flu')
}

/**
 * Separa los turnos de usuario que quedaron SIN respuesta al final del
 * historial: viajan como CONTEXTO declarado, nunca como instrucciones. Si
 * entraran como mensajes de usuario, el modelo podría ejecutar una petición
 * vieja como si fuera la actual; la petición VIGENTE queda siempre al final.
 * @param {Array<object>} historial Entradas del diálogo.
 * @returns {{ conversacion: Array<object>, sinRespuesta: Array<object> }}
 * @revisor CREAR NUEVO — la separación de turnos sin respuesta sale de gemini
 *   al módulo de diálogo; gemini la consume en este mismo cambio.
 */
export function separarTurnosSinRespuesta(historial = []) {
  const conversacion = Array.isArray(historial) ? [...historial] : []
  const sinRespuesta = []
  while (conversacion.length && esTurnoDeUsuario(conversacion[conversacion.length - 1])) {
    sinRespuesta.unshift(conversacion.pop())
  }
  return { conversacion, sinRespuesta }
}

/**
 * Bloque de CONTEXTO declarado para los turnos sin respuesta (`hablante: texto`).
 * El texto vive en el catálogo (ES/EN) y el idioma lo resuelve `pickText`.
 * @param {Array<object>} entradas Turnos de usuario sin respuesta.
 * @param {string} language Idioma de la petición.
 * @returns {string} Bloque listo para un mensaje `system` ('' si no hay texto).
 * @revisor CREAR NUEVO — el formato del bloque de contexto sale de gemini al
 *   catálogo de textos + este módulo; gemini consume el resultado.
 */
export function formatearContextoSinRespuesta(entradas = [], language = 'es') {
  const lineas = (Array.isArray(entradas) ? entradas : [])
    .map((entrada) => {
      const texto = String(entrada?.text || entrada?.transcript || entrada?.respuesta_voz || '').trim()
      const hablante = String(entrada?.speaker || '').trim()
      return texto ? (hablante ? `${hablante}: ${texto}` : texto) : ''
    })
    .filter(Boolean)
  if (!lineas.length) return ''
  return pickText(language, 'contexto_dicho_por_el_usuario_sin_respuesta', {
    lineas: lineas.join('\n'),
  })
}

/**
 * Filas de audit log: pregunta/comando humano + respuesta Flu (sin campo response pegado).
 *
 * @param {{
 *   timestamp?: string,
 *   humanSpeaker?: string,
 *   humanTranscript?: string,
 *   fluText?: string,
 *   phase?: string,
 *   signature?: unknown,
 *   navigation?: object,
 *   navigationComando?: string | null,
 * }} [params]
 */
export function buildFluSpeechAuditRows(params = {}) {
  const {
    timestamp,
    humanSpeaker = '',
    humanTranscript = '',
    fluText = '',
    phase = 'SESION_ACTIVA',
    signature = null,
    navigation = {},
    navigationComando = null,
  } = params
  const rows = []
  const humanText = cleanForSpeech(humanTranscript)
  const fluSpeech = cleanForSpeech(fluText)

  if (humanText) {
    rows.push({
      timestamp,
      speaker: humanSpeaker || FALLBACK_SPEAKER,
      transcript: humanText,
      response: '',
      navigation: { ...navigation, comando: navigationComando },
      phase,
      signature,
    })
  }

  if (fluSpeech) {
    rows.push({
      timestamp,
      speaker: FLU_DIALOGUE_SPEAKER,
      transcript: fluSpeech,
      response: '',
      navigation: { ...navigation, comando: null },
      phase,
      signature,
    })
  }

  return rows
}
