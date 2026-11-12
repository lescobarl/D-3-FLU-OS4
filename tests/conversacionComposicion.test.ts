// @vitest-environment node
/**
 * COMPOSICIÓN DEL EVENTO — frontera de transporte (`composicion.ts`).
 *
 * Prueba el dueño SIN el producto real: la frontera avanza con una fila
 * commiteada, recorta la re-emisión retenida del enunciado anterior y deja
 * intacta la composición del motor que REEMPLAZA el array (longitud 1).
 *
 * FALSIFICACIÓN incluida: sin la frontera (`FRONTERA_INICIAL`) el mismo evento
 * acumulado repite la frase ya escrita. Es la razón de ser del módulo.
 */
import { describe, expect, it } from 'vitest'
import {
  FRONTERA_INICIAL,
  avanzarFrontera,
  componerEvento,
  traeFinal,
} from '../src/voice/conversation/composicion.ts'
import type {
  EventoComposicion,
  FronteraComposicion,
} from '../src/voice/conversation/composicion.ts'

/** Frase del enunciado YA commiteado. */
const P = 'uno dos tres cuatro'
/** Enunciado NUEVO que llega detrás del final retenido. */
const Q = 'cinco seis siete ocho'

/**
 * Evento ACUMULADO, la forma real de Chrome: la instancia conserva TODOS los
 * resultados y `resultIndex` marca el primero que cambió.
 */
function acumulado(
  resultados: ReadonlyArray<{ texto: string; final: boolean }>,
  resultIndex: number,
): EventoComposicion {
  return {
    resultIndex,
    results: resultados.map((resultado) => ({
      0: { transcript: resultado.texto },
      isFinal: resultado.final,
      length: 1,
    })),
  }
}

/** Frontera con el índice 0 cubierto por una fila commiteada. */
const CUBIERTO_P: FronteraComposicion = avanzarFrontera({
  ...FRONTERA_INICIAL,
  ultimoFinal: 0,
})

describe('composición del evento — frontera de transporte', () => {
  it('traeFinal mira SOLO los resultados nuevos desde resultIndex', () => {
    expect(traeFinal(acumulado([{ texto: P, final: true }], 0))).toBe(true)
    expect(
      traeFinal(
        acumulado(
          [
            { texto: P, final: true },
            { texto: Q, final: false },
          ],
          1,
        ),
      ),
    ).toBe(false)
    expect(traeFinal({ resultIndex: 0 })).toBe(false)
  })

  it('el final se compone desde la frontera: la re-emisión retenida no viaja', () => {
    // Chrome acumula: [P final retenido, Q final nuevo] con resultIndex 1.
    const compuesta = componerEvento(
      acumulado(
        [
          { texto: P, final: true },
          { texto: Q, final: true },
        ],
        1,
      ),
      CUBIERTO_P,
    )
    expect(compuesta.trozo).toBe(Q)
    expect(compuesta.hayFinal).toBe(true)
  })

  it('el interino también queda por encima de la frontera', () => {
    const compuesta = componerEvento(
      acumulado(
        [
          { texto: P, final: true },
          { texto: Q, final: false },
        ],
        1,
      ),
      CUBIERTO_P,
    )
    expect(compuesta.trozo).toBe(Q)
    expect(compuesta.hayFinal).toBe(false)
  })

  it('FALSIFICACIÓN: sin la frontera, el evento acumulado REPITE la frase escrita', () => {
    const conFrontera = componerEvento(
      acumulado(
        [
          { texto: P, final: true },
          { texto: Q, final: true },
        ],
        1,
      ),
      CUBIERTO_P,
    )
    const sinFrontera = componerEvento(
      acumulado(
        [
          { texto: P, final: true },
          { texto: Q, final: true },
        ],
        1,
      ),
      FRONTERA_INICIAL,
    )
    expect(sinFrontera.trozo).toContain(P)
    expect(conFrontera.trozo).not.toContain(P)
  })

  it('el motor que REEMPLAZA el array (longitud 1) sigue transcribiendo tras el commit', () => {
    // `total` (1) no supera la frontera (1): la frontera no aplica y el
    // segmento se entrega entero. Si aplicara, se tragaría cada segmento.
    const compuesta = componerEvento(
      {
        resultIndex: 0,
        results: [{ 0: { transcript: 'segmento del motor local' }, isFinal: true, length: 1 }],
      },
      CUBIERTO_P,
    )
    expect(compuesta.trozo).toBe('segmento del motor local')
  })

  it('una instancia NUEVA del reconocedor descarta la frontera vieja', () => {
    // Reinicio del fallback u onend: sus índices empiezan en 0 y trae MENOS
    // resultados que el corte (la frontera vieja no aplica).
    const compuesta = componerEvento(
      acumulado([{ texto: P, final: true }], 0),
      { corte: 2, ultimoFinal: 1 },
    )
    expect(compuesta.trozo).toBe(P)
    // Frontera reiniciada; el final del evento nuevo vuelve a fijar el visto.
    expect(compuesta.frontera).toEqual({ corte: 0, ultimoFinal: 0 })
  })

  it('avanzarFrontera es monótona: cubre el final visto y nunca retrocede', () => {
    const conFinal = componerEvento(
      acumulado(
        [
          { texto: P, final: true },
          { texto: Q, final: true },
        ],
        0,
      ),
      FRONTERA_INICIAL,
    )
    expect(conFinal.frontera.ultimoFinal).toBe(1)
    const trasCommit = avanzarFrontera(conFinal.frontera)
    expect(trasCommit.corte).toBe(2)
    // Un commit sin final nuevo no mueve el corte.
    expect(avanzarFrontera(trasCommit)).toEqual(trasCommit)
  })
})
