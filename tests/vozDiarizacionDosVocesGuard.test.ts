// ============================================================
// vozDiarizacionDosVocesGuard - SIMULACION determinista del escenario del dueno
// ------------------------------------------------------------
// ESCENARIO MOSTRADO (debug.log del dueno, 2026-10-07 14:10-14:18 UTC):
//   "solo hable yo (Luis) y despues una sola mujer" y aun asi la app abrio
//   Hablante 1, 2, 3 y 4 (+ el nombre 'luis'), 5 etiquetas para 2 voces reales
//   ("Hablante 4", "Preflight ... clusters=4").
//
// MEDICION: los embeddings reales de la MISMA voz dan coseno ~0.69-0.74 y los de
// voces DISTINTAS ~0.58 (medido y anotado en P8.98). El umbral de voz nueva estaba
// en 0.70, DENTRO de la banda de la misma voz: cada turno caia en la rama
// 'production-forced-new-voice-grey-zone' y abria un 'Hablante N' nuevo.
//
// Esta simulacion usa el resolver REAL (`resolveConversationSpeaker`) con un
// modelo de embeddings calibrado a esos cosenos medidos (2 voces alternando).
// Nace ROJO con los umbrales viejos (7 clusters para 2 voces) y queda VERDE con
// el umbral medido (0.64 de voz nueva / 0.66 de reutilizacion de cluster).
// ============================================================
import { describe, it, expect } from 'vitest'
import { resolveConversationSpeaker } from '../src/voice/lib/speakerDiarization.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { compareCosineSignatures } from '../src/voice/lib/speakerCore.js'

const DIM = 512

/** PRNG determinista (sin Math.random: la simulacion no depende de la maquina). */
function prng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function unitVec(seed: number) {
  const r = prng(seed)
  const v = new Array(DIM).fill(0)
  let n = 0
  for (let i = 0; i < DIM; i += 1) {
    v[i] = r() * 2 - 1
    n += v[i] * v[i]
  }
  n = Math.sqrt(n) || 1
  return v.map((x) => x / n)
}

function norm(v: number[]) {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1
  return v.map((x) => x / n)
}

const BASE_LUIS = norm([1, ...new Array(DIM - 1).fill(0)])

/** Base de la segunda voz con coseno `cosB` con la de Luis (0.806 -> turnos a 0.58). */
function baseWithCos(cosB: number) {
  const orth = unitVec(999)
  const s = Math.sqrt(Math.max(0, 1 - cosB * cosB))
  return norm(BASE_LUIS.map((x) => x * cosB).map((x, i) => x + orth[i] * s))
}

/** Varianza intra-voz: cada turno = base + ruido (coseno intra-voz ~0.72 con 0.62). */
const NOISE = 0.62
function turn(base: number[], seed: number) {
  const noise = unitVec(seed)
  return norm(base.map((x, i) => x + noise[i] * NOISE))
}

const TEXTO_LARGO =
  'okay este es una prueba de la diarizacion en este caso vamos a revisar como funciona yo soy Luis estoy hablando a ver como me registra'

function simular(thresholds: any) {
  const MUJER = baseWithCos(0.806)
  const secuencia = [
    { v: turn(BASE_LUIS, 1), voz: 'Luis' },
    { v: turn(BASE_LUIS, 2), voz: 'Luis' },
    { v: turn(MUJER, 3), voz: 'Mujer' },
    { v: turn(BASE_LUIS, 4), voz: 'Luis' },
    { v: turn(MUJER, 5), voz: 'Mujer' },
    { v: turn(BASE_LUIS, 6), voz: 'Luis' },
    { v: turn(MUJER, 7), voz: 'Mujer' },
  ]
  const clusters: any = []
  const etiquetas: string[] = []
  for (const t of secuencia) {
    const r = resolveConversationSpeaker({
      signatureVector: t.v,
      speakerClusters: clusters,
      lastSpeaker: clusters[clusters.length - 1]?.label || '',
      lastSignature: null,
      voicedSampleCount: 86400, // 1.8 s @48k (la ventana real del log)
      sampleRate: 48000,
      thresholds,
      utteranceText: TEXTO_LARGO,
      atTurnBoundary: true,
      allowNewCluster: true,
      sessionPrimary: '',
      preferSpeaker: clusters[clusters.length - 1]?.label || '',
    } as any)
    etiquetas.push(`${t.voz}=${r}`)
  }
  return { clusters: clusters.length, etiquetas }
}

const THRESHOLDS_REALES = FLU_CONFIG.voiceIdentity.capture.conversationSpeakerThresholds

describe('2 voces reales -> 2 clusters (sin inflado)', () => {
  it('la simulacion calibrada reproduce los cosenos medidos (misma ~0.70, distinta ~0.58)', () => {
    const LUIS = turn(BASE_LUIS, 1)
    const MUJER = turn(baseWithCos(0.806), 3)
    const misma = compareCosineSignatures(LUIS, turn(BASE_LUIS, 2))
    const distinta = compareCosineSignatures(LUIS, MUJER)
    expect(misma).toBeGreaterThan(0.66)
    expect(misma).toBeLessThan(0.80)
    expect(distinta).toBeGreaterThan(0.5)
    expect(distinta).toBeLessThan(0.66)
  })

  it('con los umbrales REALES, 7 turnos de 2 voces NO inflan clusters (máximo 2)', () => {
    const { clusters, etiquetas } = simular(THRESHOLDS_REALES)
    expect(clusters, `etiquetas: ${etiquetas.join(' | ')}`).toBeLessThanOrEqual(2)
    // La misma voz conserva SU etiqueta: nunca la de la otra persona.
    const luis = etiquetas.filter((e) => e.startsWith('Luis=')).map((e) => e.split('=')[1])
    const mujer = etiquetas.filter((e) => e.startsWith('Mujer=')).map((e) => e.split('=')[1])
    expect(new Set(luis).size).toBe(1)
    expect(new Set(mujer).size).toBe(1)
    expect([...new Set(luis)][0]).not.toBe([...new Set(mujer)][0])
  })
})

describe('PRUEBA DE DETECTOR: el umbral VIEJO infla (no es decorativo)', () => {
  it('un umbral de voz nueva DENTRO de la banda de la misma voz abre un cluster por turno', () => {
    const inflado = simular({ ...THRESHOLDS_REALES, cosineNewVoiceThreshold: 0.70, productionClusterReuseThreshold: 0.78 })
    expect(inflado.clusters).toBeGreaterThan(2)
  })
})
