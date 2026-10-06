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
