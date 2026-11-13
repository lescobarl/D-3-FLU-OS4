// @vitest-environment node
/**
 * COMPOSICIÓN DEL EVENTO — frontera de transporte (`composicion.ts`).
 *
 * Prueba el dueño SIN el producto real: la frontera avanza con una fila
 * commiteada, recorta la re-emisión retenida del enunciado anterior, compone
 * entero el final COLAPSADO de Chrome y deja intacta la composición del motor
 * que REEMPLAZA el array (longitud 1).
 *
 * FALSIFICACIÓN incluida: sin la frontera (`FRONTERA_INICIAL`) el final VIEJO
 * no tapa al nuevo (gana el ÚLTIMO final del evento) y el interino queda
 * desprotegido — la frontera sigue siendo la única que cubre ese caso. Es la
 * razón de ser del módulo.
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
    expect(compuesta.nuevaInstancia).toBe(false)
  })

  it('el interino compone la HIPÓTESIS COMPLETA, no solo la cola de resultIndex', () => {
    // Chrome revisa resultados ANTERIORES: un interino con la hipótesis entera
    // y `resultIndex` en la cola debe entregar TODO desde la frontera. La cola
    // sola no puede corregir lo revisado y, pegada a la línea abierta,
    // duplicaba («batiendo», medido 2026-11-12).
    const compuesta = componerEvento(
      acumulado(
        [
          { texto: P, final: false },
          { texto: Q, final: false },
        ],
        1,
      ),
      FRONTERA_INICIAL,
    )
    expect(compuesta.trozo).toContain('uno dos tres cuatro')
    expect(compuesta.trozo).toContain('cinco seis siete ocho')
    expect(compuesta.nuevaInstancia).toBe(false)
  })

  it('FALSIFICACIÓN: sin la frontera, el final viejo no puede tapar al nuevo', () => {
    // 994bbf46 (2026-11-12): con la frontera rancia (corte 0), el evento
    // acumulado [P final, Q final] entregaba P (el más largo) y Q se perdía.
    // El ÚLTIMO final es la hipótesis más nueva del evento: viaja ella aunque
    // la frontera no cubra todavía la re-emisión retenida.
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
    expect(sinFrontera.trozo).toBe(Q)
    // La frontera sigue siendo necesaria: sin un final nuevo detrás, el final
    // viejo SOLO sí se re-compone [P final, Q INTERINO] y solo el avance de la
    // frontera (producto, al aplicar el final) evita que vuelva a viajar.
    const finalViejoConInterino = componerEvento(
      acumulado(
        [
          { texto: P, final: true },
          { texto: Q, final: false },
        ],
        1,
      ),
      FRONTERA_INICIAL,
    )
    expect(finalViejoConInterino.trozo).toContain(P)
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

  it('el final COLAPSADO de Chrome (un resultado, total == corte) se compone entero', () => {
    // Chrome reemplaza su array por la hipótesis completa del tramo (un solo
    // resultado) aunque el corte ya cubra el índice: es el final REAL, no la
    // re-emisión (la re-emisión pura la descartan la ingesta y el producto).
    const compuesta = componerEvento(
      acumulado([{ texto: `${P} ${Q} completo`, final: true }], 0),
      CUBIERTO_P,
    )
    expect(compuesta.trozo).toBe(`${P} ${Q} completo`)
    expect(compuesta.hayFinal).toBe(true)
  })

  it('una instancia NUEVA del reconocedor descarta la frontera vieja', () => {
    // Reinicio del fallback u onend: sus índices empiezan en 0 y trae MENOS
    // resultados que el corte (la frontera vieja no aplica).
    const compuesta = componerEvento(
      acumulado([{ texto: P, final: true }], 0),
      { corte: 2, ultimoFinal: 1 },
    )
    expect(compuesta.trozo).toBe(P)
    expect(compuesta.nuevaInstancia).toBe(true)
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
