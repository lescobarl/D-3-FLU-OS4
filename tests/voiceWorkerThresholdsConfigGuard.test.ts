// ============================================================
// Gard: LOS UMBRALES DE IDENTIDAD DE VOZ SON LOS DE LA CONFIG (no de un literal del worker).
// ------------------------------------------------------------
// DEFECTO MEDIDO (debug.log del dueno, 2026-10-07 20:02-20:08 UTC):
//   `Match reason=new-voice-below-threshold sim=0.756` y `reason=cluster-reidentify sim=0.788`
//   -> el MISMO hablante alternaba 'luis', 'Hablante 1', 'Hablante 2', 'Hablante 3' cada turno.
//   Causa: `voiceId.worker.js` pasaba `matchThresholdCluster ?? 0.76`, `newVoiceThreshold ?? 0.68`,
//   `continuityThreshold ?? 0.74`. Al pasar el literal, `assignSpeaker` creia que el valor venia
//   decidido y NO leia `voiceIdentity.capture.conversationSpeakerThresholds` (0.66 / 0.64). Una voz
//   que puntua 0.68-0.79 caia por debajo de 0.76 -> "voz nueva" -> Hablante N.
// El guard tiene DOS caras: (A) estructural (el worker no incrusta el literal) y (B) comportamiento
//   con su PRUEBA DE DETECTOR (el mismo vector cambia de resultado si se le inyecta 0.76).
// ============================================================
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assignSpeaker } from '../src/voice/lib/speakerCore.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const WORKER = resolve(process.cwd(), 'src/voice/workers/voiceId.worker.js')
const CLIENT = resolve(process.cwd(), 'src/voice/lib/voiceIdWorkerClient.js')

// Un literal numerico pegado a una de las claves que deben salir de la config.
const SHADOWED_KEY = /(matchThresholdCluster|newVoiceThreshold|continuityThreshold)\s*:[^,\n{}]*?\?\?\s*0\.\d+/

describe('los umbrales de identidad salen de la config, no de un literal del worker', () => {
  it('el worker NO incrusta un umbral por defecto (\\\\?\\\\? 0.x) para match/newVoice/continuity', () => {
    const src = readFileSync(WORKER, 'utf8')
    const offenders = src
      .split(/\r?\n/)
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => SHADOWED_KEY.test(line))
      .map(({ line, n }) => `voiceId.worker.js:${n}  ${line}`)
    expect(offenders, `el worker no puede decidir el umbral; debe dejarlo a FLU_CONFIG:\n${offenders.join('\n')}`).toEqual([])
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
})

// El MISMO vector (coseno 0.70 con el cluster 'luis') debe REUTILIZAR el cluster por defecto.
const SIG = [1, 0, 0, 0]
const V070 = [0.7, Math.sqrt(1 - 0.49), 0, 0]
const BASE = {
  clusters: [{ label: 'luis', signature: SIG }],
  lastSpeaker: 'Hablante 1',
  lastSignature: [0, 1, 0, 0],
  reservedLabels: [],
}

describe('una voz que puntua 0.70 con el cluster NO es una voz nueva (reutiliza el cluster)', () => {
  it('con los umbrales de la config resuelve al hablante del cluster', () => {
    const out = assignSpeaker(V070, BASE as any)
    expect(out.speakerName, `resolvio "${out.speakerName}" (${out.reason})`).toBe('luis')
  })
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('si se le inyecta el literal viejo 0.76, la MISMA voz se vuelve "voz nueva"', () => {
    const out = assignSpeaker(V070, { ...BASE, matchThresholdCluster: 0.76 } as any)
    expect(out.speakerName, `con 0.76 resolvio "${out.speakerName}" (${out.reason})`).not.toBe('luis')
  })
})
