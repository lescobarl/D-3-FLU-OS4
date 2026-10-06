// ============================================================
// speakerClusterAccumulation.test.ts — SIMULACIÓN determinista del defecto real
// ------------------------------------------------------------
// MEDIDO en la app (debug.log del dueño, 2026-10-06): el comparador de voces
// recibia SIEMPRE `inClusters=0`, asi que cada turno empezaba de cero y todas las
// voces (Luis, la mujer de la TV) caian en "Hablante 1". La causa: el primer
// cluster NUNCA se persistia, porque el preflight de identidad resuelve de forma
// ASINCRONA y el commit ya habia consumido su slot (vacio). Sin cluster guardado,
// no hay con que comparar y la diarizacion no puede separar a nadie.
//
// Esta simulacion usa las piezas REALES: la cola de identidad, el pipeline por
// turno, la resolucion del commit y la persistencia de clusters. No toca el
// microfono ni el worker: el snapshot de audio se sustituye por un resultado fijo.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  startContinuousIdentityPipeline,
  finalizeTurnIdentityPipeline,
  resetTurnIdentityPipeline,
} from '../src/voice/lib/turnIdentityPipeline.js'
import {
  resolveTurnSpeakerAtCommit,
  applyResolvedSpeakerToSessionRefs,
} from '../src/voice/lib/turnSpeakerCommit.js'
import { flattenChunksWindow } from '../src/voice/lib/speakerClusters.js'

/** Deja correr la cola de identidad (idle + microtareas). */
const flush = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Resolver de identidad REAL-ish: devuelve un cluster y una firma 512-D. */
const readyPreflight = () => () =>
  Promise.resolve({
    speakerId: 'spk-1',
    speakerName: 'Hablante 1',
    signatureVector: [1, 0, 0],
    workingClusters: [{ label: 'Hablante 1', speakerId: 'spk-1', signature: [1, 0, 0] }],
    reason: 'resolved-idle',
  })

beforeEach(() => {
  resetTurnIdentityPipeline()
})

// El embeder descarta ventanas de audio muy cortas (min 0.35 s @16k). MEDIDO en la
// app: la captura del turno salio de ~8 ms (`TurnAudio snap=384`) y el preflight
// respondia `no-vector` -> sin firma, sin cluster. Por eso la captura impone un
// MINIMO (`minSamplesMs`); el primitivo que lo aplica es `flattenChunksWindow`.
describe('la captura del turno impone un minimo de audio (no ventanas casi vacias)', () => {
  it('minSamples ENSANCHA una ventana de turno casi vacia hasta el minimo', () => {
    const chunks = [new Float32Array(48000)] // 1 s @48k
    const w = flattenChunksWindow(chunks, {
      totalSamples: 48000,
      sinceSample: 47616, // el limite de turno acaba de marcar el inicio (384 muestras)
      maxSamples: 86400,
      minSamples: 43200, // minimo exigido (0.9 s @48k)
    })
    expect(w.length, 'debe ensancharse al minimo, no quedarse en 384').toBe(43200)
  })
})

describe('la separacion de voces exige que el cluster se ACUMULE entre turnos', () => {
  it('con preflight YA resuelto, el pipeline entrega el cluster y el commit lo persiste', async () => {
    startContinuousIdentityPipeline(1, readyPreflight)
    await flush()

    const pre = finalizeTurnIdentityPipeline(1, readyPreflight())
    expect(pre?.ready, 'el slot debe estar listo tras un tick previo').toBe(true)
    expect(pre?.workingClusters?.length).toBe(1)

    const resolved = resolveTurnSpeakerAtCommit({
      phrase: 'hola',
      preflight: pre,
      clusters: [],
      lastLogged: '',
    })
    expect(resolved.workingClusters?.length, 'el commit debe recibir el cluster').toBe(1)

    const setSpeakerClusters = vi.fn()
    applyResolvedSpeakerToSessionRefs(resolved, { setSpeakerClusters })
    expect(setSpeakerClusters).toHaveBeenCalledTimes(1)
    expect(setSpeakerClusters.mock.calls[0][0].length).toBe(1)
  })

  it('un preflight CONTINUO tambien persiste sus clusters (el commit pierde la carrera)', async () => {
    const setSpeakerClusters = vi.fn()
    startContinuousIdentityPipeline(1, readyPreflight, { onClusters: setSpeakerClusters })
    await flush()
    expect(
      setSpeakerClusters,
      'si el commit siempre llega antes que el embedding, el continuo debe persistir',
    ).toHaveBeenCalled()
    expect(setSpeakerClusters.mock.calls[0][0].length).toBe(1)
  })

  it('si el preflight resuelve TARDE, el cluster se persiste igual (no se pierde)', async () => {
    const setSpeakerClusters = vi.fn()

    // Sin tick previo: el snapshot final se agenda y resuelve DESPUES del commit.
    const pre = finalizeTurnIdentityPipeline(7, readyPreflight(), {
      onClusters: setSpeakerClusters,
    })
    expect(pre?.ready, 'el slot del commit aun no esta listo (es asincrono)').not.toBe(true)

    await flush()

    expect(
      setSpeakerClusters,
      'el cluster del turno debe persistirse cuando el preflight resuelve, aunque sea tarde',
    ).toHaveBeenCalled()
    expect(setSpeakerClusters.mock.calls[0][0].length).toBe(1)
  })
})

// Prueba de DETECTOR del propio guard (no es decorativo, prueba de mutación): el
// caso infractor es un preflight que resuelve DESPUES del commit; contra el codigo
// previo (slot consumido -> `if (!slot) return`) el cluster NO se persiste y este
// bloque cae. Con el arreglo, si.
describe('el detector no es decorativo (prueba de mutación)', () => {
  it('persistir los clusters del snapshot final NO depende de que el slot siga vivo', async () => {
    const setSpeakerClusters = vi.fn()
    finalizeTurnIdentityPipeline(99, readyPreflight(), { onClusters: setSpeakerClusters })
    await flush()
    expect(setSpeakerClusters, 'sin esto la diarizacion no puede separar voces').toHaveBeenCalled()
  })
})
