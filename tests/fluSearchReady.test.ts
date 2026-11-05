// @vitest-environment jsdom
/**
 * fluSearchReady — Hito #4: evento SEARCH_READY para que FLU anuncie de forma
 * natural que los resultados web ya están.
 */
import { describe, expect, it } from 'vitest'
import { dispatchFluSearchReady, onFluSearchReady } from '../src/core/events/fluEvents'

describe('SEARCH_READY — aviso de resultados listos (#4)', () => {
  it('dispatch → listener recibe la consulta', () => {
    const received: any[] = []
    const off = onFluSearchReady((payload) => received.push(payload))
    dispatchFluSearchReady({ query: 'cómo se generan los volcanes', lang: 'es' })
    off()
    expect(received).toEqual([{ query: 'cómo se generan los volcanes', lang: 'es' }])
  })

  it('tras remover el listener ya no recibe', () => {
    const received: any[] = []
    const off = onFluSearchReady((payload) => received.push(payload))
    off()
    dispatchFluSearchReady({ query: 'otra' })
    expect(received).toEqual([])
  })
})
