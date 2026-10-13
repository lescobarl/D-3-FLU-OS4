// ============================================================
// duenoMedidaViva - La MEDIDA de audio del turno tiene que LLEGAR (puntos 4 y 6 del dueno).
// ------------------------------------------------------------
// CAUSA RAIZ MEDIDA (2026-10-13): el trabajo de identidad del turno (el snapshot FINAL, el
// unico que escribe clusters y resuelve el hablante) se despacha con `scheduleIdle` (tope
// 2500 ms) mientras el commit solo espera `commitPreflightTimeoutMs` (1500 ms). En una
// pestana ocupada `requestIdleCallback` no llega nunca dentro de ese plazo -> el commit ve
// `pending` SIEMPRE (`preReady:false` en 60/60 turnos de la sesion del dueno) y la medida
// acaba llegando tarde (o no llega). El embedding corre en un WORKER (fuera del hilo
// principal), asi que esperar a "idle" solo ANADE latencia: no protege a nadie.
//
// NACE ROJO: hoy el trabajo del turno NO corre si el navegador no esta ocioso.
// ============================================================
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  enqueueSpeakerIdentityJob,
  resetSpeakerIdentityQueue,
  getSpeakerIdentityQueueStats,
} from '../src/voice/lib/voiceIdentityQueue.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const esperar = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(() => {
  resetSpeakerIdentityQueue()
  vi.unstubAllGlobals()
})

describe('M1 - el trabajo de identidad del TURNO no puede depender de "idle"', () => {
  it('corre aunque el navegador NUNCA este ocioso (pestana ocupada)', async () => {
    // Pestaña ocupada: requestIdleCallback existe pero NO llama nunca.
    vi.stubGlobal('requestIdleCallback', () => 0)

    let ran = false
    enqueueSpeakerIdentityJob({
      rowId: 'final-turno-1',
      run: () => {
        ran = true
        return { ok: true }
      },
      priority: true,
    })

    await esperar(60)
    expect(ran, 'la medida del turno tiene que llegar sin esperar a idle').toBe(true)
    expect(getSpeakerIdentityQueueStats().hasPending, 'y no puede quedar colgada').toBe(false)
  })

  it('el trabajo OPORTUNISTA (ticks continuos) si puede esperar a idle', async () => {
    vi.stubGlobal('requestIdleCallback', () => 0)
    let ran = false
    enqueueSpeakerIdentityJob({
      rowId: 'tick-continuo',
      run: () => {
        ran = true
        return { ok: true }
      },
      priority: false,
    })
    await esperar(30)
    expect(ran, 'un tick continuo es oportunista: no se le exige el plazo del turno').toBe(false)
  })
})

describe('M2 - los dos plazos no pueden contradecirse', () => {
  it('mutacion (el detector no es decorativo): el tick oportunista SI se aplaza a idle, y corre cuando idle llega', async () => {
    const holder: { cb: ((deadline?: unknown) => void) | null } = { cb: null }
    vi.stubGlobal('requestIdleCallback', (fn: (deadline?: unknown) => void) => {
      holder.cb = fn
      return 1
    })
    let ran = false
    enqueueSpeakerIdentityJob({
      rowId: 'tick-oportunista',
      run: () => {
        ran = true
        return { ok: true }
      },
      priority: false,
    })
    await esperar(10)
    expect(ran, 'sin idle todavia no corre (la marca mide el aplazamiento)').toBe(false)
    if (holder.cb) holder.cb()
    await esperar(10)
    expect(ran, 'y con idle si corre').toBe(true)
  })

  it('el plazo del commit no es menor que el retraso con el que se despacha el trabajo del turno', () => {
    const commit = Number(FLU_CONFIG.voiceIdentity?.capture?.identityPipeline?.commitPreflightTimeoutMs) || 0
    // El despacho del trabajo del TURNO no usa idle (M1): su retraso es 0, asi que
    // cualquier plazo de commit > 0 es coherente. Se fija como invariante numerica.
    expect(commit, 'el commit tiene que esperar a la medida').toBeGreaterThan(0)
  })
})
