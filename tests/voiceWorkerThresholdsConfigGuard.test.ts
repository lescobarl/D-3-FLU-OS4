// ============================================================
// Guard: LOS UMBRALES DE IDENTIDAD DE VOZ SON LOS DE LA CONFIG (no de un literal).
// ------------------------------------------------------------
// DEFECTO MEDIDO (debug.log del dueno, 2026-10-07 20:02-20:08 UTC):
//   `Match reason=new-voice-below-threshold sim=0.756` y `reason=cluster-reidentify sim=0.788`
//   -> el MISMO hablante alternaba 'luis', 'Hablante 1', 'Hablante 2', 'Hablante 3' cada turno.
//   Causa: se pasaba `matchThresholdCluster ?? 0.76`, `newVoiceThreshold ?? 0.68`,
//   `continuityThreshold ?? 0.74`: al venir el literal, NO se leia
//   `voiceIdentity.capture.conversationSpeakerThresholds` (0.66 / 0.64).
//
// P9.57: el worker solo EMBEBE; la decision es del DUENO UNICO
// (`resolveConversationSpeaker`), que lee los umbrales de la config.
// Guard de DOS caras: (A) estructural (nadie incrusta el literal) y (B) de
// COMPORTAMIENTO con prueba de DETECTOR (el veredicto depende de la similitud:
// 0.70 reutiliza el cluster, 0.50 abre etiqueta nueva).
// ============================================================
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveConversationSpeaker } from '../src/voice/lib/speakerDiarization.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { getMinSamples, getTargetSampleRate } from '../src/voice/lib/embeddingConfig.js'
import { getConversationMinVoicedSamples } from '../src/voice/lib/micCapture.js'

const WORKER = resolve(process.cwd(), 'src/voice/workers/voiceId.worker.js')
const CLIENT = resolve(process.cwd(), 'src/voice/lib/voiceIdWorkerClient.js')

const SHADOWED_KEY = /(matchThresholdCluster|newVoiceThreshold|continuityThreshold)\s*:[^,\n{}]*?\?\?\s*0\.\d+/

describe('los umbrales de identidad salen de la config, no de un literal', () => {
  it('el worker NO incrusta un umbral por defecto (?? 0.x) para match/newVoice/continuity', () => {
    const src = readFileSync(WORKER, 'utf8')
    const offenders = src
      .split(/\r?\n/)
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => SHADOWED_KEY.test(line))
      .map(({ line, n }) => `voiceId.worker.js:${n}  ${line}`)
    expect(offenders, `el worker no decide identificacion; debe dejarlo a FLU_CONFIG:\n${offenders.join('\n')}`).toEqual([])
  })

  it('el cliente NO envia un umbral literal (la fuente es la config)', () => {
    const src = readFileSync(CLIENT, 'utf8')
    const offenders = src
      .split(/\r?\n/)
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => SHADOWED_KEY.test(line))
      .map(({ line, n }) => `voiceIdWorkerClient.js:${n}  ${line}`)
    expect(offenders).toEqual([])
  })

  it('la config declara los umbrales medidos (0.66 reutilizacion de cluster / 0.64 voz nueva)', () => {
    const t = FLU_CONFIG.voiceIdentity?.capture?.conversationSpeakerThresholds || {}
    expect(t.productionClusterReuseThreshold).toBe(0.66)
    expect(t.cosineNewVoiceThreshold).toBe(0.64)
  })

  it('conversationMinVoicedMs ES el piso del embedder (no una copia que puede divergir)', () => {
    const capture = FLU_CONFIG.voiceIdentity?.capture || {}
    const pisoEmbedderMs = Math.round(Number(capture.embedding?.minSampleRatio) * 1000)
    expect(capture.conversationMinVoicedMs, 'MinVoiced debe igualar el piso real del embedder').toBe(pisoEmbedderMs)
    expect(getConversationMinVoicedSamples(getTargetSampleRate())).toBe(getMinSamples())
  })
})

const SIG = [1, 0, 0, 0]

/** Decision por el DUENO UNICO: vector con coseno `cos` frente al cluster 'luis'. */
function decidir(cos = 0.7): string {
  const vector = [cos, Math.sqrt(Math.max(0, 1 - cos * cos)), 0, 0]
  return resolveConversationSpeaker({
    signatureVector: vector,
    speakerClusters: [{ label: 'luis', signature: SIG }],
    lastSpeaker: 'Hablante 1',
    lastSignature: [0, 1, 0, 0],
    voicedSampleCount: 86400,
    sampleRate: 48000,
    atTurnBoundary: false,
    allowNewCluster: true,
  } as any)
}

describe('una voz que puntua 0.70 con el cluster NO es una voz nueva (reutiliza el cluster)', () => {
  it('con los umbrales de la config resuelve al hablante del cluster', () => {
    expect(decidir(0.7)).toBe('luis')
  })
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('una voz ORTOGONAL (coseno 0) NO reutiliza el cluster', () => {
    expect(decidir(0), 'el veredicto debe depender de la similitud, no ser constante').not.toBe('luis')
  })
})
