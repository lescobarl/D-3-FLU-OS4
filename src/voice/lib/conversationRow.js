/**
 * Contrato atómico del log de conversación (UI + IndexedDB).
 * speakerId / speakerName: solo etiquetas. signature: embedding 512-D opcional por fila.
 */
import { cleanForSpeech, stripDiacritics } from './audioMath.js'
import { FLU_CONFIG } from './fluConfig.js'
import { resolveRowVoiceName } from './speakerDirectory.js'
import { normalizeSpeakerLabel, parseSpeakerIndex, isProperSpeakerName } from './voiceIdentity.js'
import { autoSpeakerLabel, getFallbackSpeaker, isAutoSpeakerLabel } from './speakerCore.js'
import { equalsTrimmed } from '../../lib/textUtils.ts'

export const SPEAKER_ID_CALCULATING = 'calculando'
/** Clave estable de la fila EN ESPERA (`Hablante X`), distinta de la no identificada. */
export const SPEAKER_ID_PENDING = 'speaker_pending'
/** Clave estable de la fila NO IDENTIFICADA (`Hablante XX`). */
export const SPEAKER_ID_UNIDENTIFIED = 'speaker_unidentified'
const SPEAKER_ID_FLU = 'flu'

const SPEAKER_ID_PATTERN = /^speaker_[a-z0-9_]+$/

function getIdentifyingSpeakerName(config = FLU_CONFIG) {
  const label = String(config?.ui?.identifyingSpeakerName || '').trim()
  return label || 'Identificando...'
}

export function isCalculatingSpeakerId(speakerId = '') {
  return equalsTrimmed(speakerId, SPEAKER_ID_CALCULATING)
}

function isValidSpeakerId(speakerId = '') {
  const id = String(speakerId || '').trim()
  if (!id) return false
  if (id === SPEAKER_ID_CALCULATING || id === SPEAKER_ID_FLU) return true
  return SPEAKER_ID_PATTERN.test(id)
}

export function labelToSpeakerId(label = '', config = FLU_CONFIG) {
  const name = normalizeSpeakerLabel(cleanForSpeech(label))
  if (!name) return SPEAKER_ID_CALCULATING
  const index = parseSpeakerIndex(name)
  if (index != null) return `speaker_${index}`
  const lower = name.toLowerCase()
  const pending = String(config?.voiceIdentity?.labels?.pendingSpeaker || '').trim()
  const fallback = String(getFallbackSpeaker(config)).trim()
  // X (EN ESPERA) y XX (NO IDENTIFICADO) son estados distintos y NUNCA comparten
  // clave: una fila en espera no puede leerse como la no identificada.
  if (pending && lower === pending.toLowerCase()) return SPEAKER_ID_PENDING
  if (fallback && lower === fallback.toLowerCase()) return SPEAKER_ID_UNIDENTIFIED
  // Cualquier otra agrupacion anonima (p. ej. una grafia heredada) es no identificada.
  if (isAutoSpeakerLabel(name, config)) return SPEAKER_ID_UNIDENTIFIED
  const slug = stripDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug ? `speaker_name_${slug}` : SPEAKER_ID_CALCULATING
}

/**
 * ETIQUETA VISIBLE de una fila de conversacion: se resuelve AL MOSTRAR y por la VOZ.
 *
 * Mandato del dueno (2026-10-13): el NOMBRE no vive en la conversacion (la conversacion es
 * texto insertado y no se reescribe ninguna fila). La fila guarda LA VOZ (`speakerId`) y
 * aqui se resuelve su nombre; sin nombre registrado para esa voz, la etiqueta provisional
 * de su id ("Hablante N"): NO se adivina. FLU, el sistema y las filas viejas que YA traen
 * su nombre escrito se muestran tal cual (compatibilidad).
 *
 * Mandato 2026-10-18 (bug de voz, debug.log): una voz SIN EVIDENCIA REGISTRADA (p. ej. la
 * mujer sin ancla) NUNCA cae al respaldo generico «Hablante XX» ni a un nombre derivado de
 * su clave. Su etiqueta es la de SU VOZ: si el id es `speaker_N`, «Hablante N» (la misma
 * que asigna la diarizacion); sin id automatico, "Identificando...".
 */
export function resolveRowSpeakerLabel(row = {}, config = FLU_CONFIG) {
    const escrita = String(row?.speakerName || row?.speaker || '').trim();
    // Filas NUEVAS del módulo: la etiqueta persistida manda. No se re-resuelve
    // por voz; el fallback por directorio queda solo para filas legacy/import.
    if (row?.meta?.origin === 'conversation-module') {
        // La etiqueta persistida es el estado REAL del módulo: N→N, X→X,
        // XX→XX y nombre→nombre. La vista NO reinterpreta ni colapsa estados:
        // `Hablante N` es una voz MEDIDA desconocida, no una no identificada.
        return escrita || speakerIdToDefaultName(String(row?.speakerId || '').trim(), config);
    }
    // FREEZE (mandato del dueno 2026-10-17): un NOMBRE PROPIO congelado en la fila se muestra
    // tal cual y NUNCA se re-resuelve desde el directorio. Una etiqueta AUTOMATICA escrita no
    // manda: la fila muestra la etiqueta de SU VOZ (clave por timbre cuando se midio), asi que
    // una voz distinta que reutiliza la clave no hereda el nombre (la mujer salia "Luis").
    if (escrita && isProperSpeakerName(escrita)) return escrita;
    const id = String(row?.speakerId || '').trim();
    // Solo una CLAVE DE VOZ valida identifica por voz: un `speakerId` que no lo es (p. ej. el
    // id sintetico de un snapshot de preflight) NO se resuelve por voz; la fila muestra la
    // etiqueta que YA trae escrita, nunca el respaldo generico.
    if (!id || !isValidSpeakerId(id)) return escrita;
    if (id === SPEAKER_ID_FLU) return 'Flu';
    // P11.10: con TIMBRE medido manda la VOZ (la clave pudo reciclarse en otra persona). Sin
    // firma NO se consulta el directorio: la fila usa su etiqueta provisional (freeze).
    const signature = normalizeRowSignature(row?.signature);
    const name = resolveRowVoiceName(id, signature);
    if (name) return name;
    if (signature?.length && id.startsWith('speaker_name_')) {
        // Voz medida que NO es la identidad de esa clave con nombre: no se afirma su nombre.
        return String(config?.voiceIdentity?.labels?.fallbackSpeaker || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker);
    }
    const respaldo = String(config?.voiceIdentity?.labels?.fallbackSpeaker || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker).trim();
    // Etiqueta AUTOMATICA escrita por la DIARIZACION (distinta del respaldo): es la etiqueta
    // de la voz MEDIDA (su cluster real, cosido por la clave). SIN timbre manda el rotulo
    // historico (la MISMA voz re-clusterizada conserva su «Hablante 3/4»). CON timbre, la
    // etiqueta es la de SU clave: un rotulo automatico de OTRA voz no manda (la mujer no
    // hereda «Hablante 1» de Luis).
    if (!signature?.length && isAutoSpeakerLabel(escrita) && escrita !== respaldo) return escrita;
    // La clave da la etiqueta de SU voz (`speaker_N` -> «Hablante N», estable) o el nombre
    // de su clave cuando la fila no trae timbre con que contradecirlo (freeze 2026-10-17).
    return speakerIdToDefaultName(id, config) || escrita;
}

export function speakerIdToDefaultName(speakerId = '', config = FLU_CONFIG) {
  const id = String(speakerId || '').trim()
  if (id === SPEAKER_ID_CALCULATING) return getIdentifyingSpeakerName(config)
  if (id === SPEAKER_ID_FLU) return 'Flu'
  if (id === SPEAKER_ID_PENDING) {
    return String(config?.voiceIdentity?.labels?.pendingSpeaker || '').trim()
  }
  if (id === SPEAKER_ID_UNIDENTIFIED) return getFallbackSpeaker(config)
  const autoMatch = id.match(/^speaker_(\d+)$/)
  // Plantilla UNICA de config (`autoSpeakerLabel`): no se re-escribe «Hablante N» aqui.
  if (autoMatch) return autoSpeakerLabel(Number(autoMatch[1]), config)
  const named = id.match(/^speaker_name_(.+)$/)
  if (named) {
    return named[1]
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }
  return config?.voiceIdentity?.labels?.fallbackSpeaker || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
}

export function resolveSpeakerNameFromId(speakerId = '', clusters = [], config = FLU_CONFIG) {
  const id = String(speakerId || '').trim()
  if (!id || id === SPEAKER_ID_CALCULATING) return getIdentifyingSpeakerName(config)
  const cluster = clusters.find((c) => String(c?.speakerId || '').trim() === id)
  if (cluster?.label) return normalizeSpeakerLabel(cluster.label)
  return speakerIdToDefaultName(id, config)
}

export function ensureClusterSpeakerId(cluster = {}) {
  const label = normalizeSpeakerLabel(cluster?.label || '')
  const speakerId = isValidSpeakerId(cluster?.speakerId)
    ? String(cluster.speakerId).trim()
    : labelToSpeakerId(label)
  return { ...cluster, label, speakerId }
}

/**
 * @param {number[]|null} [signature]
 * @returns {number[]|null}
 */
export function normalizeRowSignature(signature = null) {
  if (!Array.isArray(signature) || !signature.length) return null
  return signature.slice(0, 512).map((value) => Number(value) || 0)
}




export function formatRowClock(row = {}) {
  const ts = Number(row.timestamp)
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const date = new Date(ts)
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}
