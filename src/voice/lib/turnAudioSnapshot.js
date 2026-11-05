/**
 * DUEÑO ÚNICO del audio del turno para diarización.
 *
 * El snapshot se captura UNA vez, al sellar el final y ANTES de que el buffer PCM
 * se vacíe (flush/cierre). Los consumidores (contrato de voz y preflight de
 * identidad) leen ESTE snapshot en vez del buffer vivo.
 *
 * Medido en la sesión real del dueño (2026-10-06): 24 de 25 turnos con
 * `SpeakerTrace snap=0` y un único embedding calculado → toda la sesión caía a
 * "Hablante 1": el audio existía en el buffer, pero se leía DESPUÉS de vaciarlo.
 */
import { relayLog } from '../../lib/clientLogRelay'
import { concatFloat32 } from './pcmChunks.js'
import { isSpeechSynthesisSpeaking } from './fluSpeech.js'
import { countVoicedSamples } from './voicedActivity.js'

// RETENCION ACOTADA por turno: la identidad se resuelve TARDE (el worker compite con
// el ASR) y el turno siguiente ya existe cuando llega la medida. Con UN solo slot, la
// captura del turno N+2 pisaba la del turno N y el resolver tardio caia al buffer PCM
// VIVO entero (medido 2026-10-18: preflight del turno 11 a las 20:20:53 leyo 419 ms y
// 10.088/18.509 ms de audio de OTROS turnos + eco del TTS; creo un "Hablante 2" con
// 0.091 de similitud). El mapa conserva los ultimos turnos y el turno sellado que ya
// no esta NO cae nunca al buffer vivo (ver `capturedTurnAudio`).
const SNAPSHOT_RETENTION = 16
const snapshotsByTurn = new Map()
let lastProbeAt = 0

function rememberSnapshot(turnId, samples) {
  // Reinsertar mueve la clave al final del Map: el orden es el de uso reciente.
  snapshotsByTurn.delete(turnId)
  snapshotsByTurn.set(turnId, { turnId, samples })
  while (snapshotsByTurn.size > SNAPSHOT_RETENTION) {
    snapshotsByTurn.delete(snapshotsByTurn.keys().next().value)
  }
}

/**
 * Captura el snapshot de audio del turno.
 *
 * La captura se REPITE en cada commit del turno (un `final` de SEGMENTO de Chrome no
 * lo cierra), asi que el slot se MEJORA cuando la ventana nueva trae mas VOZ que la
 * guardada. Antes era first-write-wins: el primer segmento, a menudo de 3-900 ms
 * (medido en el log del dueno 2026-10-18: `snap=128`/`snap=768`), quedaba como audio
 * definitivo del turno y el embedding final media silencio. Una captura vacia o con
 * menos voz no pisa una mejor.
 * @param {number} turnId
 * @param {{ buildWindow?: () => Float32Array|null, meta?: object }} [options]
 * @returns {Float32Array}
 */
export function captureTurnAudioSnapshot(turnId = 0, { buildWindow, meta = {} } = {}) {
  const id = Number(turnId) || 0
  const prior = snapshotsByTurn.get(id)
  const window = typeof buildWindow === 'function' ? buildWindow() : null
  const samples = window?.length ? new Float32Array(window) : new Float32Array(0)
  const sampleRate = Number(meta.sampleRate) || 0
  const priorVoiced = prior?.samples?.length ? countVoicedSamples(prior.samples, { sampleRate }) : -1
  const nextVoiced = samples.length ? countVoicedSamples(samples, { sampleRate }) : -1
  const mejor = !prior || !prior.samples?.length || nextVoiced > priorVoiced
  if (!mejor) return prior.samples
  rememberSnapshot(id, samples)
  // BANDERA DE DIAGNOSTICO (dueno 2026-10-11): la MISMA voz mide bestSim 0.20-0.57 en unos
  // turnos y 0.83-0.99 en otros. Se anota la VENTANA (ms) y si FLU HABLABA al sellarla: si
  // los turnos basura coinciden con `flu=hablando`, la voz de FLU (eco) esta entrando en la
  // ventana del turno. Un solo dato, una sola linea. NO se toca ningun umbral de audio.
  const ventanaMs = sampleRate ? Math.round((samples.length / sampleRate) * 1000) : 0
  relayLog(
    'LOG',
    'TurnAudio',
    `capture turn=${turnId} snap=${samples.length} ms=${ventanaMs} voz=${Math.max(0, nextVoiced)} flu=${isSpeechSynthesisSpeaking() ? 'hablando' : 'callada'} total=${meta.total ?? 0} since=${meta.since ?? 0} chunks=${meta.chunks ?? 0} sr=${sampleRate}`,
  )
  return samples
}

/** Snapshot del turno SOLO si pertenece a ese turno (si no, `null`). */
function readTurnAudioSnapshot(turnId = 0) {
  const entry = snapshotsByTurn.get(Number(turnId) || 0)
  return entry?.samples?.length ? entry.samples : null
}

/**
 * DUENO UNICO de "hay audio CAPTURADO de este turno":
 * - snapshot del turno → ese audio (aunque el turno ya este sellado);
 * - turno ACTIVO sin snapshot → `null` = "aun no capturado": el resolver extrae la
 *   VENTANA del turno del buffer vivo (`getTurnStartSample`), nunca el buffer entero;
 * - turno SELLADO sin snapshot → vacio: no hay audio de ESE turno. El buffer vivo
 *   pertenece a otro turno y usarlo mezcla voces (defecto medido 2026-10-18).
 * @param {number} turnId
 * @param {number} [activeTurnId]
 * @returns {Float32Array|null}
 */
export function capturedTurnAudio(turnId, activeTurnId = 0) {
  const id = Number(turnId) || 0
  const snap = readTurnAudioSnapshot(id)
  if (snap) return snap
  // Sin id atado o turno ACTIVO: aun no capturado -> el resolver usa la ventana del turno.
  return !id || id === (Number(activeTurnId) || 0) ? null : new Float32Array(0)
}

/** Audio del turno para diarización: snapshot del dueño único, o el buffer vivo SOLO
 *  mientras el turno sigue ACTIVO. */
export function turnAudioForDiarize(turnId, { chunks = [], activeTurnId = 0 } = {}) {
  const captured = capturedTurnAudio(turnId, activeTurnId)
  return captured || concatFloat32(chunks)
}

/**
 * Sonda (throttle 2s) del estado del buffer PCM: distingue "el micrófono dejó de
 * alimentar" de "el buffer se vació antes de consumirse".
 */
export function probePcmBlock({ total = 0, chunks = 0, listening = false, conversation = false, now = Date.now() } = {}) {
  if (now - lastProbeAt < 2000) return
  lastProbeAt = now
  relayLog(
    'LOG',
    'MicPcm',
    `total=${total} chunks=${chunks} listening=${listening} conv=${conversation}`,
  )
}
