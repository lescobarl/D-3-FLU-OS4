// @vitest-environment node
/**
 * REGLA 2 — la frontera decide cuándo cerrar; el VAD solo mide.
 *
 * Cada caso falla si se quita la rama que mide: voz presente, umbral de frontera
 * con texto ajeno, cierre por silencio sin texto ajeno, y locución cerrada.
 * Los umbrales se inyectan para probar el borde exacto sin esperar 5 s.
 */
import { describe, expect, it } from 'vitest'
import { decidirFrontera } from '../src/voice/conversation/frontera'
import type {
  DecisionFrontera,
  EntradaFrontera,
  UmbralesFrontera,
} from '../src/voice/conversation/frontera'
import { CONVERSACION_CONFIG } from '../src/voice/conversation/ports'
import { getTranscriptPauseCfg } from '../src/voice/lib/fluTranscriptPause.js'

const UMBRALES: UmbralesFrontera = { minSilenceMs: 900, silenceCloseMs: 5000 }

const entrada = (
  silencioMs: number,
  textoAjeno: boolean,
  hayVoz = false,
  abierta = true,
): EntradaFrontera => ({
  medida: { hayVoz, silencioMs },
  textoAjeno,
  abierta,
})

const decidir = (e: EntradaFrontera, u: UmbralesFrontera = UMBRALES): DecisionFrontera =>
  decidirFrontera(e, u)

describe('regla 2 — texto ajeno NO cierra por sí solo', () => {
  it('texto ajeno con 900 ms NO cierra: no es silencio ni cambio de hablante', () => {
    expect(decidir(entrada(900, true))).toEqual({ cerrar: false, causa: null })
  })

  it('un milisegundo menos tampoco cierra', () => {
    expect(decidir(entrada(899, true))).toEqual({ cerrar: false, causa: null })
  })

  it('sin texto ajeno, el umbral de frontera no cierra', () => {
    expect(decidir(entrada(900, false))).toEqual({ cerrar: false, causa: null })
  })

  it('con voz presente no cierra aunque la medida traiga silencio', () => {
    expect(decidir(entrada(9000, true, true))).toEqual({ cerrar: false, causa: null })
  })
})

describe('regla 2 — silencio sin texto ajeno', () => {
  it('silencio justo en silenceCloseMs cierra por silencio', () => {
    expect(decidir(entrada(5000, false))).toEqual({ cerrar: true, causa: 'silencio' })
  })

  it('un milisegundo menos no cierra por silencio', () => {
    expect(decidir(entrada(4999, false))).toEqual({ cerrar: false, causa: null })
  })

  it('si además llegó texto ajeno, la causa es la frontera (no el silencio)', () => {
    expect(decidir(entrada(5000, true))).toEqual({ cerrar: true, causa: 'frontera' })
  })
})

describe('regla 2 — sin locución abierta no hay cierre', () => {
  it('una locución cerrada no se vuelve a cerrar', () => {
    expect(decidir(entrada(9000, true, false, false))).toEqual({ cerrar: false, causa: null })
  })
})

describe('regla 2 — los umbrales salen de la tabla, no de literales', () => {
  it('la config real expone los dos umbrales y el tiempo sale de fluConfig', () => {
    expect(CONVERSACION_CONFIG.minSilenceMs).toBe(900)
    expect(CONVERSACION_CONFIG.silenceCloseMs).toBe(
      Number(getTranscriptPauseCfg().srGapCommitMs),
    )
  })

  it('con umbrales inyectados el borde se mueve con ellos', () => {
    const cortos: UmbralesFrontera = { minSilenceMs: 100, silenceCloseMs: 200 }
    expect(decidir(entrada(99, true), cortos)).toEqual({ cerrar: false, causa: null })
    expect(decidir(entrada(100, true), cortos)).toEqual({ cerrar: false, causa: null })
    expect(decidir(entrada(200, true), cortos)).toEqual({ cerrar: true, causa: 'frontera' })
    expect(decidir(entrada(200, false), cortos)).toEqual({ cerrar: true, causa: 'silencio' })
  })

  it('una medida inválida se trata como silencio cero, no como cierre', () => {
    expect(decidir(entrada(Number.NaN, true))).toEqual({ cerrar: false, causa: null })
    expect(decidir(entrada(-1, false))).toEqual({ cerrar: false, causa: null })
  })

  it('no muta la entrada', () => {
    const e = Object.freeze({
      medida: Object.freeze({ hayVoz: false, silencioMs: 5000 }),
      textoAjeno: true,
      abierta: true,
    })
    const antes = JSON.stringify(e)
    const decision: DecisionFrontera = decidirFrontera(e, UMBRALES)
    expect(JSON.stringify(e)).toBe(antes)
    expect(decision.cerrar).toBe(true)
  })
})
