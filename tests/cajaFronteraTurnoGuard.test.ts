// @vitest-environment node
/**
 * GUARD: la caja marca FRONTERA cuando cambia el turno, también desde `null`.
 *
 * Auditoría 2026-10-23 (ítem 6): `turnoDelBoceto` nacía en `null`, que significaba a la vez
 * "todavía no se publicó nada" y "turno sin id". Con `turnId=null` la caja no marcaba cambio de
 * turno (`turnoActivo !== null` era falso y `turnoDelBoceto !== null` también), así que el
 * boceto de un turno podía heredarse en el siguiente.
 *
 * Aquí el sentinel interno es `undefined` (no publicado) y `null` es un turno SIN id: `null -> 5`
 * SÍ es frontera. El contrato público `turnoActual()` sigue devolviendo `null` cuando no hay dato.
 */
import { describe, expect, it } from 'vitest'
import { crearCajaDeLaFrase } from '../src/voice/lib/conversationStreamCommit.js'

type Caja = {
  publicarEnLaCaja: (texto: string, opciones?: { turnId?: number | string | null }) => { aplicado: boolean; destino: string }
  vaciarLaCaja: (opciones?: { visible?: boolean }) => void
  turnoActual: () => number | string | null
}

function caja(activeTurnId: number | null = null): { caja: Caja; ref: { current: string } } {
  const ref = { current: '' }
  const caja = crearCajaDeLaFrase({
    publishedLiveRef: ref,
    activeTurnIdRef: { current: activeTurnId },
  }) as Caja
  return { caja, ref }
}

describe('caja: frontera por identidad de turno', () => {
  it('publicar con turno SIN id y luego con id SI es cambio de turno', () => {
    const { caja: c } = caja(null)
    c.publicarEnLaCaja('vamos a preparar la receta', { turnId: null })
    expect(c.turnoActual(), 'un turno sin id no es "sin publicar"').toBeNull()

    const siguiente = c.publicarEnLaCaja('vamos a comprar el helado en la tienda', { turnId: 5 })

    expect(siguiente.aplicado, 'el boceto del turno sin id no puede heredarse').toBe(true)
    expect(siguiente.destino).toBe('vamos a comprar el helado en la tienda')
  })

  it('FALSIFICACION: dentro del MISMO turno no hay frontera (una emision ajena se bloquea)', () => {
    const { caja: c } = caja(null)
    c.publicarEnLaCaja('vamos a preparar la receta', { turnId: 5 })

    const otra = c.publicarEnLaCaja('vamos a comprar el helado en la tienda', { turnId: 5 })

    expect(otra.aplicado, 'mismo turno: manda la regla de la caja, no la frontera').toBe(false)
    expect(otra.destino).toBe('vamos a preparar la receta')
  })

  it('el vaciado deja la caja "sin publicar" (no inventa un turno)', () => {
    const { caja: c } = caja(null)
    c.publicarEnLaCaja('hola', { turnId: 3 })
    c.vaciarLaCaja()

    expect(c.turnoActual()).toBeNull()
  })
})
