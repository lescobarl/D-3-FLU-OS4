/**
 * Un final ASR → varias filas solo cuando hay evidencia fuerte (prior embebido + timbre distinto).
 * No trocea monólogos/TV; evita alternancia H2/H3 por ruido de snapshots.
 */
import { cleanForSpeech, speechWords } from './audioMath.js'
import { FLU_CONFIG } from './fluConfig.js'
import { normalizeSpeakerLabel } from './voiceIdentity.js'

export function getAsrTurnSegmentationCfg(config = FLU_CONFIG) {
  return config.transcript?.asrSegmentation || {}
}

function snapshotVector(entry = {}) {
  const vector = entry.signatureVector || entry.vector
  return Array.isArray(vector) ? vector : []
}

function isWeakSnapshot(entry = {}) {
  const vector = snapshotVector(entry)
  return (
    entry.reason === 'no-audio' ||
    entry.reason === 'no-vector' ||
    !vector.length
  )
}

/** Snapshots → bloques por etiqueta (solo cambio de speakerName, sin coseno inter-snapshot). */
export function collapseSnapshotSpeakerRuns(snapshots = []) {
  const rows = (Array.isArray(snapshots) ? snapshots : []).filter((row) => !isWeakSnapshot(row))
  if (!rows.length) return []

  const runs = []
  let current = null

  const pushCurrent = () => {
    if (current?.weight > 0) runs.push(current)
    current = null
  }

  for (const row of rows) {
    const speaker = normalizeSpeakerLabel(row.speakerName || '')
    if (!speaker) continue

    if (!current) {
      current = {
        speaker,
        weight: 1,
        signatureVector: snapshotVector(row),
      }
      continue
    }

    if (speaker !== current.speaker) {
      pushCurrent()
      current = { speaker, weight: 1, signatureVector: snapshotVector(row) }
    } else {
      current.weight += 1
      current.signatureVector = snapshotVector(row)
    }
  }

  pushCurrent()
  return runs
}

/** Fusiona bloques de 1 snapshot (ruido) y adyacentes con misma etiqueta. */
export function stabilizeSpeakerRuns(runs = [], config = FLU_CONFIG) {
  const segCfg = getAsrTurnSegmentationCfg(config)
  const minWeight = Number(segCfg.minSnapshotsPerRun) || 2
  if (!runs.length) return []

  const debounced = []
  for (const run of runs) {
    const last = debounced[debounced.length - 1]
    if (run.weight < minWeight && last) {
      last.weight += run.weight
      if (run.weight >= last.weight) {
        last.speaker = run.speaker
        last.signatureVector = run.signatureVector
      }
    } else {
      debounced.push({ ...run })
    }
  }

  const merged = []
  for (const run of debounced) {
    const last = merged[merged.length - 1]
    if (last && last.speaker === run.speaker) {
      last.weight += run.weight
    } else {
      merged.push({ ...run })
    }
  }
  return merged
}

/** H2/H3/H2/H3 en snapshots = ruido de diarización, no partir ASR. */
export function isOscillatingDiarization(runs = []) {
  if (runs.length < 3) return false
  const labels = runs.map((run) => run.speaker)
  if (new Set(labels).size !== 2) return false
  let alternations = 0
  for (let index = 1; index < labels.length; index += 1) {
    if (labels[index] !== labels[index - 1]) alternations += 1
  }
  return alternations >= Math.ceil(labels.length * 0.6)
}

/** Prior embebido (no solo prefijo) dentro del final ASR → cortes de texto. */
export function findEmbeddedPriorSegments(phrase = '', priorTexts = [], priorSpeakers = [], config = FLU_CONFIG) {
  const cleaned = cleanForSpeech(phrase)
  if (!cleaned) return null

  const segCfg = getAsrTurnSegmentationCfg(config)
  const minChars = Number(segCfg.embeddedPriorMinChars) || 12

  const pairs = (Array.isArray(priorTexts) ? priorTexts : [])
    .map((text, index) => ({
      text: cleanForSpeech(text),
      speaker: normalizeSpeakerLabel(priorSpeakers?.[index] || ''),
    }))
    .filter((row) => row.text.length >= minChars)
    .sort((a, b) => b.text.length - a.text.length)

  for (const prior of pairs) {
    const idx = cleaned.toLowerCase().indexOf(prior.text.toLowerCase())
    if (idx < 0) continue

    const before = cleanForSpeech(cleaned.slice(0, idx))
    const after = cleanForSpeech(cleaned.slice(idx + prior.text.length))
    if (!before && !after) continue

    const segments = []
    if (before) segments.push({ text: before, speakerHint: null })
    segments.push({ text: prior.text, speakerHint: prior.speaker, skip: true })
    if (after) segments.push({ text: after, speakerHint: null })
    return { segments, prior }
  }

  return null
}

function assignEmbeddedSegments(embedded, speakerRuns = [], fallbackSpeaker = '', config = FLU_CONFIG) {
  const segCfg = getAsrTurnSegmentationCfg(config)
  const minWords = Number(segCfg.minWordsPerSegment) || 6
  const maxSegments = Number(segCfg.maxSegmentsPerFinal) || 2
  const fallback = normalizeSpeakerLabel(fallbackSpeaker) || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
  const firstSpeaker = speakerRuns[0]?.speaker || fallback
  const lastSpeaker = speakerRuns[speakerRuns.length - 1]?.speaker || fallback

  const novel = embedded.segments.filter((row) => !row.skip && cleanForSpeech(row.text))
  const segments = []

  for (const part of novel) {
    const text = cleanForSpeech(part.text)
    if (speechWords(text).length < minWords) continue
    const speaker =
      part.speakerHint ||
      (segments.length === 0 ? firstSpeaker : lastSpeaker) ||
      fallback
    segments.push({ text, speaker })
  }

  if (segments.length === 1) return segments
  if (segments.length === 2 && segments.length <= maxSegments) {
    if (new Set(segments.map((row) => row.speaker)).size >= 2) return segments
  }
  return []
}

/**
 * Plan de commit: [{ text, speaker }] o [] → una sola fila con texto completo.
 * Solo modo embedded-prior (TV ya commitida + voz nueva); sin troceo proporcional.
 */
export function planAsrTurnSegments({
  phrase = '',
  priorTexts = [],
  priorSpeakers = [],
  preflight = null,
  fallbackSpeaker = '',
  config = FLU_CONFIG,
} = {}) {
  const segCfg = getAsrTurnSegmentationCfg(config)
  if (segCfg.enabled === false) return []

  const capture = cleanForSpeech(phrase)
  if (!capture) return []

  const minCaptureWords = Number(segCfg.minCaptureWordsToSplit) || 15
  if (speechWords(capture).length < minCaptureWords) return []

  const snapshots = Array.isArray(preflight?.snapshots) ? preflight.snapshots : []
  const rawRuns = collapseSnapshotSpeakerRuns(snapshots)
  if (isOscillatingDiarization(rawRuns)) return []

  const speakerRuns = stabilizeSpeakerRuns(rawRuns, config)

  const minRuns = Number(segCfg.minSpeakerRuns) || 2
  if (speakerRuns.length < minRuns) return []

  const embedded = findEmbeddedPriorSegments(capture, priorTexts, priorSpeakers, config)
  if (!embedded?.segments?.length) return []

  return assignEmbeddedSegments(embedded, speakerRuns, fallbackSpeaker, config)
}

/** Cobertura del plan vs capture; < umbral → preferir fila única. */
export function segmentPlanCoversCapture(segmentPlan = [], capture = '', minRatio = 0.85) {
  const captureWords = speechWords(capture)
  if (!captureWords.length || !segmentPlan.length) return true
  const planWords = segmentPlan.reduce(
    (sum, row) => sum + speechWords(row.text).length,
    0,
  )
  return planWords >= captureWords.length * minRatio
}
