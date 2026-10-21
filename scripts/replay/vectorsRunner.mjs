/**
 * RUNNER del modo `vectors`: reconstruye el estado PREVIO de cada commit a partir de
 * `turns.ndjson` y pregunta al RESOLUTOR REAL de diarizacion (`resolveConversationSpeaker`)
 * quien hablaba. No reimplementa diarizacion ni inventa estado.
 *
 * CONTRATO (lo que hace fiel al modo):
 *  - `speaker` del commit es el RESULTADO a comparar, JAMAS una entrada;
 *  - el estado previo sale de la instantanea ANTERIOR (el `base` para el primer turno, el
 *    commit anterior en el resto): `clusters`, `lastSpeaker`, `primary`, `lastSignature`,
 *    `speakerHighWater` (maximo indice ya visto, reconstruido de esos mismos clusters);
 *  - el vector del turno y la duracion salen de la propia grabacion (`signature` y
 *    `audioStartSample`/`audioEndSample`);
 *  - umbrales y pisos de voz salen de la CONFIG (`micCapture`), no de constantes locales;
 *  - si falta el VECTOR del turno o la DURACION, el turno NO se evalua: se cuenta como
 *    `skipped` con su motivo y, si no queda ningun turno evaluable, el modo es
 *    `not-conclusive` (nunca un OK falso).
 *
 * LIMITES DECLARADOS (no son bugs del runner, son lo que el snapshot NO guarda):
 *  - `voicedSampleCount` es el tramo del turno (`audioEndSample - audioStartSample`), no la
 *    cuenta de muestras con voz: el NDJSON no la graba, asi que es una COTA SUPERIOR;
 *  - la etiqueta viva pudo salir del preflight asincrono del worker (Whisper/WavLM sobre el
 *    audio); aqui se re-ejecuta el RESOLUTOR sobre la firma grabada, que es la evidencia
 *    disponible y reproducible. Un mismatch puede venir de esa diferencia, y el reporte lo
 *    ensena en vez de taparlo.
 */
import { DEFAULT_SAMPLE_RATE } from '../../src/voice/lib/audioConstants.js'
import { FLU_CONFIG } from '../../src/voice/lib/fluConfig.js'
import {
  getConversationMinVoicedForNewSamples,
  getConversationMinVoicedSamples,
  getVoiceIdentityCaptureConfig,
} from '../../src/voice/lib/micCapture.js'

/**
 * Convierte los participantes del `base` en clusters de sesion (ancla registrada).
 * @param {Array<object>} participants
 * @returns {Array<object>}
 */
function clustersDesdeBase(participants = []) {
  return (participants || [])
    .filter((p) => Array.isArray(p?.voiceVector) && p.voiceVector.length)
    .map((p) => ({
      label: String(p.name || '').trim(),
      signature: [...p.voiceVector],
      signatureHistory: [[...p.voiceVector]],
      anchorVerified: p.voiceAnchorVerified === true,
    }))
    .filter((cluster) => cluster.label)
}

/**
 * Clusters tal como quedaron en una instantanea de turno.
 * @param {Array<object>} clusters
 * @returns {Array<object>}
 */
function clustersDeTurno(clusters = []) {
  return (clusters || [])
    .filter((c) => String(c?.label || '').trim() && Array.isArray(c?.signature) && c.signature.length)
    .map((c) => ({
      label: String(c.label).trim(),
      signature: [...c.signature],
      signatureHistory: Array.isArray(c.signatureHistory) && c.signatureHistory.length ? c.signatureHistory : [[...c.signature]],
      anchorVerified: c.anchorVerified === true,
    }))
}

/**
 * Primary de la sesion ANTES del primer commit: el participante ACTIVO del `base` (nombre
 * propio y ancla verificada). Con cero o varios candidatos NO se adivina: `''` + aviso.
 * @param {Array<object>} participants
 * @param {(label: string) => boolean} esNombrePropio
 * @returns {{ primary: string, aviso: string }}
 */
function primaryDesdeBase(participants = [], esNombrePropio) {
  const candidatos = (participants || [])
    .filter((p) => p?.voiceAnchorVerified === true && esNombrePropio(String(p?.name || '').trim()))
    .map((p) => String(p.name).trim())
  if (candidatos.length === 1) return { primary: candidatos[0], aviso: '' }
  return { primary: '', aviso: candidatos.length ? 'primary-ambiguo' : 'primary-desconocido' }
}

/**
 * Ejecuta el modo `vectors` sobre una sesion.
 * @param {{ session: object, thresholds?: object }} input
 * @returns {Promise<object>}
 */
export async function runVectorsSession({ session, thresholds } = {}) {
  const diarizacion = await import('../../src/voice/lib/speakerDiarization.js')
  const etiquetas = await import('../../src/voice/lib/speakerLabels.js')
  const { resolveConversationSpeaker } = diarizacion
  const { canonicalSpeakerName, isProperSpeakerName, parseSpeakerIndex, reservedSpeakerLabels } = etiquetas

  const captureCfg = getVoiceIdentityCaptureConfig(FLU_CONFIG)
  const sampleRate = Number(session?.meta?.sampleRate) || Number(session?.manifest?.sampleRate) || DEFAULT_SAMPLE_RATE
  const umbrales = thresholds || captureCfg.conversationSpeakerThresholds || {}
  const minVoicedSamples = getConversationMinVoicedSamples(sampleRate, FLU_CONFIG)
  const minVoicedSamplesForNew = getConversationMinVoicedForNewSamples(sampleRate, FLU_CONFIG)

  const filas = Array.isArray(session?.turns) ? session.turns : []
  const base = filas.find((row) => String(row?.kind || '') === 'base') || null
  const commits = filas.filter((row) => String(row?.kind || '') === 'commit')
  const participantesBase = Array.isArray(base?.participants) ? base.participants : []
  const primaryInicial = primaryDesdeBase(participantesBase, isProperSpeakerName)
  const reservedLabels = reservedSpeakerLabels(
    participantesBase.filter((p) => isProperSpeakerName(String(p?.name || '').trim())).map((p) => String(p.name).trim()),
  )

  const turnos = []
  let speakerMatches = 0
  let speakerMismatches = 0
  const skipped = []
  const motivos = []
  const avisos = primaryInicial.aviso ? [primaryInicial.aviso] : []

  for (let i = 0; i < commits.length; i += 1) {
    const commit = commits[i]
    const previo = i === 0 ? null : commits[i - 1]
    const vector = Array.isArray(commit?.signature) ? commit.signature : []
    const desde = Number(commit?.audioStartSample)
    const hasta = Number(commit?.audioEndSample)
    const voiced = Number.isFinite(desde) && Number.isFinite(hasta) ? hasta - desde : 0

    if (!vector.length) {
      skipped.push({ index: i, motivo: 'sin-vector' })
      if (!motivos.includes('sin-vector')) motivos.push('sin-vector')
      continue
    }
    if (!(voiced > 0)) {
      skipped.push({ index: i, motivo: 'sin-duracion' })
      if (!motivos.includes('sin-duracion')) motivos.push('sin-duracion')
      continue
    }

    // ESTADO PREVIO: nunca el resultado de este commit.
    const clustersPrevios = previo ? clustersDeTurno(previo.clusters) : clustersDesdeBase(participantesBase)
    const lastSpeaker = String(previo?.lastSpeaker || '').trim()
    const lastSignature = previo && Array.isArray(previo.signature) && previo.signature.length ? previo.signature : null
    const primary = previo ? String(previo.primary || '').trim() : primaryInicial.primary
    const highWater = clustersPrevios.reduce((max, cluster) => {
      const index = Number(parseSpeakerIndex(cluster.label))
      return Number.isFinite(index) && index > max ? index : max
    }, 0)
    const texto = String(commit?.text || '')
    const diagnosis = {}

    const observed = resolveConversationSpeaker({
      signatureVector: vector,
      speakerClusters: clustersPrevios,
      lastSpeaker,
      lastSignature,
      voicedSampleCount: voiced,
      minVoicedSamples,
      minVoicedSamplesForNew,
      utteranceText: texto,
      sampleRate,
      atTurnBoundary: true,
      allowNewCluster: true,
      reservedLabels,
      sessionPrimary: primary,
      preferSpeaker: lastSpeaker,
      speakerHighWater: highWater,
      thresholds: umbrales,
      diagnosis,
    })

    // NOMBRES CANONICOS a los dos lados; el `speaker` de la fuente es el ESPERADO.
    const esperado = canonicalSpeakerName(String(commit?.speaker || '').trim())
    const obtenido = canonicalSpeakerName(String(observed || '').trim())
    const match = esperado === obtenido
    if (match) speakerMatches += 1
    else speakerMismatches += 1
    turnos.push({
      index: i,
      text: texto.slice(0, 120),
      expected: esperado,
      observed: obtenido,
      match,
      reason: String(diagnosis?.reason || ''),
    })
  }

  const evaluados = speakerMatches + speakerMismatches
  const conclusive = evaluados > 0
  if (!conclusive) {
    if (!commits.length) motivos.push('sin-commits')
    if (!motivos.length) motivos.push('sin-evidencia')
  }

  return {
    turns: turnos,
    speakerMatches,
    speakerMismatches,
    skipped,
    evaluated: evaluados,
    conclusive,
    notConclusive: conclusive ? [] : motivos,
    avisos,
    commits: commits.length,
    reconstructed: {
      base: Boolean(base),
      baseParticipants: participantesBase.length,
      prevStateFrom: base ? 'base+commit-anterior' : 'commit-anterior',
      sessionPrimaryInicial: primaryInicial.primary,
      highWaterFrom: 'clusters-previos',
      voicedSampleCount: 'audioEndSample-audioStartSample',
    },
  }
}
