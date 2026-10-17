/**
 * Resolución de hablante desde audio: vectores 512-D en clusters y filas (campo signature).
 */
import {
  getConversationMinVoicedForNewSamples,
  getConversationMinVoicedSamples,
  getVoiceIdentityCaptureConfig,
} from './micCapture.js'
import {
  ensureClusterSpeakerId,
  labelToSpeakerId,
  resolveSpeakerNameFromId,
} from './conversationRow.js'
import { resolveConversationSpeaker as matchSpeakerByVoice, getFallbackSpeaker } from './voiceIdentity.js'
import { isMeasuredIdentityMatch } from './speakerDiarization.js'
import { payloadSeparacionDeTurno } from './speakerCore.js'
import { getEmbeddingConfig } from './embeddingConfig.js'
import { relayLog } from '../../lib/clientLogRelay.ts'
import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'

/**
 * Linea del diagnostico de identidad (`Identity`). DUENO UNICO del campo que se lee:
 * `diagnosis.lastSim` (el nombre que escriben TODAS las vias del resolutor). Antes
 * leia `lastTurnSimilarity`, que la via PRINCIPAL no escribe -> `lastSim=0.000` en
 * TODAS las lineas (ciego 39/39, medido en la sesion del dueno).
 * @param {{ label?: string, diagnosis?: object, lastSpeaker?: string, preferSpeaker?: string, atTurnBoundary?: boolean, workingClusters?: unknown[], signatureVector?: number[], voicedSampleCount?: number }} [ctx]
 * @returns {string}
 */
export function formatIdentityDiagnosis({ label = '', diagnosis = {}, lastSpeaker = '', preferSpeaker = '', atTurnBoundary = false, workingClusters = [], signatureVector = [], voicedSampleCount = 0 } = {}) {
  const d = diagnosis || {}
  const lastSim = Number(d.lastSim ?? 0).toFixed(3)
  const auto = d.autoClusterCount ?? (Array.isArray(workingClusters) ? workingClusters.length : 0)
  const best = Number(d.bestSim)
  const bestTxt = Number.isFinite(best) ? ` bestSim=${best.toFixed(3)} best="${d.bestLabel || ''}"` : ''
  // SONDA DE VECTORES (2026-10-16): para MEDIR la separacion real entre voces en cada
  // resolucion. `dtype` confirma el modelo cargado (fp32/q8, raiz del fix de diarizacion);
  // `vec`/`voiced` son la calidad de la ventana; `pares` es el coseno del vector del turno
  // contra CADA cluster (dueño del coseno: speakerCore.payloadSeparacionDeTurno). El
  // sufijo se AÑADE al final: el prefijo del instrumento no cambia (guards de lastSim).
  const embCfg = getEmbeddingConfig()
  const dtype = embCfg.quantized === false ? 'fp32' : 'q8'
  const vec = Array.isArray(signatureVector) ? signatureVector.length : 0
  const paresTxt = vec
    ? payloadSeparacionDeTurno(signatureVector, workingClusters, [], 0).pares
      .map((p) => `${p.label}:${p.sim}`)
      .join(',')
    : ''
  return `label="${label}" reason=${d.reason || ''} lastSim=${lastSim} auto=${auto} last="${lastSpeaker || ''}" prefer="${preferSpeaker || ''}" boundary=${Boolean(atTurnBoundary)}${bestTxt} dtype=${dtype} vec=${vec} voiced=${Number(voicedSampleCount) || 0} pares=[${paresTxt}]`
}

/**
 * @param {number[]} vector — embedding 512-D (solo capa diarización)
 * @returns {{ speakerId: string, speakerName: string }}
 */
export function resolveSpeakerIdentityFromVector(
  vector = [],
  {
    speakerClusters = [],
    lastSpeaker = '',
    lastSignature = null,
    fallbackSpeaker = getFallbackSpeaker(),
    utteranceText = '',
    sampleRate = DEFAULT_SAMPLE_RATE,
    voicedSampleCount = 0,
    atTurnBoundary = true,
    allowNewCluster = false,
    preferSpeaker = '',
    reservedLabels = [],
    sessionPrimary = '',
  } = {},
) {
  const captureCfg = getVoiceIdentityCaptureConfig()
  const workingClusters = speakerClusters.map((cluster) => ensureClusterSpeakerId({
    ...cluster,
    signature: Array.isArray(cluster?.signature) ? [...cluster.signature] : cluster?.signature,
    signatureHistory: Array.isArray(cluster?.signatureHistory)
      ? cluster.signatureHistory.map((e) => (Array.isArray(e) ? [...e] : e))
      : cluster?.signatureHistory,
  }))

  let label = fallbackSpeaker
  const diagnosis = {}
  if (Array.isArray(vector) && vector.length) {
    label =
      matchSpeakerByVoice({
        signatureVector: vector,
        speakerClusters: workingClusters,
        lastSpeaker,
        lastSignature,
        voicedSampleCount,
        utteranceText,
        sampleRate,
        preferSpeaker,
        thresholds: captureCfg.conversationSpeakerThresholds,
        maxAutoSpeakers: captureCfg.conversationMaxAutoSpeakers ?? 0,
        atTurnBoundary,
        allowNewCluster,
        reservedLabels,
        sessionPrimary,
        minVoicedSamples: getConversationMinVoicedSamples(sampleRate),
        minVoicedSamplesForNew: getConversationMinVoicedForNewSamples(sampleRate),
        diagnosis,
      }) || fallbackSpeaker
  }
  if (typeof window !== 'undefined') {
    relayLog('LOG', 'Identity', formatIdentityDiagnosis({ label, diagnosis, lastSpeaker, preferSpeaker, atTurnBoundary, workingClusters, signatureVector: vector, voicedSampleCount }))
  }

  const matched = workingClusters.find(
    (c) => String(c?.label || '').trim() === String(label || '').trim(),
  )
  const speakerId = matched?.speakerId || labelToSpeakerId(label)
  const speakerName = resolveSpeakerNameFromId(speakerId, workingClusters)
  // Evidencia = COINCIDENCIA medida (dueno: `isMeasuredIdentityMatch`), no "hay clusters".
  return { speakerId, speakerName, workingClusters, label, signatureVector: vector, evidence: isMeasuredIdentityMatch(diagnosis.reason) }
}
