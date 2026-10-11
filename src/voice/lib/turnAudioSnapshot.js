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

let slot = null
let lastProbeAt = 0

/**
 * Captura (idempotente por turno) el snapshot de audio del turno.
 * @param {number} turnId
 * @param {{ buildWindow?: () => Float32Array|null, meta?: object }} [options]
 * @returns {Float32Array}
 */
export function captureTurnAudioSnapshot(turnId = 0, { buildWindow, meta = {} } = {}) {
  if (slot && slot.turnId === turnId) return slot.samples
  const window = typeof buildWindow === 'function' ? buildWindow() : null
  const samples = window?.length ? new Float32Array(window) : new Float32Array(0)
  slot = { turnId, samples }
  // BANDERA DE DIAGNOSTICO (dueno 2026-10-11): la MISMA voz mide bestSim 0.20-0.57 en unos
  // turnos y 0.83-0.99 en otros. Se anota la VENTANA (ms) y si FLU HABLABA al sellarla: si
  // los turnos basura coinciden con `flu=hablando`, la voz de FLU (eco) esta entrando en la
  // ventana del turno. Un solo dato, una sola linea. NO se toca ningun umbral de audio.
  const ventanaMs = meta.sampleRate ? Math.round((samples.length / meta.sampleRate) * 1000) : 0
  relayLog(
    'LOG',
    'TurnAudio',
    `capture turn=${turnId} snap=${samples.length} ms=${ventanaMs} flu=${isSpeechSynthesisSpeaking() ? 'hablando' : 'callada'} total=${meta.total ?? 0} since=${meta.since ?? 0} chunks=${meta.chunks ?? 0} sr=${meta.sampleRate ?? 0}`,
  )
  return samples
}

/** Snapshot del turno SOLO si pertenece a ese turno (si no, `null`). */
export function readTurnAudioSnapshot(turnId = 0) {
  if (slot && slot.turnId === turnId && slot.samples?.length) return slot.samples
  return null
}

/** Audio del turno para diarización: snapshot del dueño único, o el buffer vivo. */
export function turnAudioForDiarize(turnId, chunks = []) {
  const snap = readTurnAudioSnapshot(turnId)
  return snap?.length ? snap : concatFloat32(chunks)
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
