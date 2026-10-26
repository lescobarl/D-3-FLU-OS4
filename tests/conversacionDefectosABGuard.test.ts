// @vitest-environment node
/**
 * DEFECTO A (decision del dueno 2026-10-23) — un dueno por pregunta.
 *
 * A: la fila 5 del replay (id de fuente 1792789182623, 22 palabras) llevaba DOS locuciones
 *    pegadas (la segunda es la fila 1792789202635). NO se corrige uniendo: se corrige con
 *    el tramo/frontera. Hoy el tramo es la ventana del TURNO (limitacion L1 declarada en
 *    docs/cola-conversacion.md): dos locuciones sin pausa suficiente comparten tramo y fila,
 *    y ESO SE FIJA AQUI para que nadie venda "una locucion = una fila" como cerrado.
 *
 * B (variantes del MISMO tramo) se retiro con la tuberia vieja de conversacion
 * (corte 2026-10-25): su dueno era `unirVariantesDelMismoTramo` del ingress borrado.
 * En el modulo nuevo la union vive en el flujo de texto (`src/voice/conversation/texto.ts`)
 * y se mide en sus propios guards (`conversacionProducto`, `conversacionFixtures`).
 */
import { describe, expect, it } from 'vitest'
import { crearCajaDeLaFrase, resolverEmisionDeLaCaja } from '../src/voice/lib/conversationStreamCommit.js'
import { estadoDeLocucion } from '../src/voice/core/locucion.js'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow } from '../src/voice/lib/conversationTurnRow'

const filas = () => useIntegrationStore.getState().conversationHistory

beforeEach(() => {
  useIntegrationStore.setState({ conversationHistory: [], conversationEpoch: 0 } as never)
})

/** Las DOS locuciones de la fila 5 del replay (fuente: ids 1792789182623 y 1792789202635). */
const LOCUCION_1 =
  'voy a decir El Comando para que sustituya todos los nombres todos mis intervenciones con con nombre propio Okay flu Soy Luis'
const LOCUCION_2 =
  'magistrado Luis ya le puso Luis a todo a todas las las intervenciones Eso es correcto hasta aquí vamos bien voy a poner ahora a la mujer a hablar cedo la palabra'

describe('DEFECTO A — dos locuciones no se pegan (se separan por tramo/frontera)', () => {
  it('son DOS locuciones, no una variante (dueno unico: estadoDeLocucion)', () => {
    expect(estadoDeLocucion(LOCUCION_1, LOCUCION_2).locucionNueva).toBe(true)
  })

  it('la caja NO pega la locucion ajena a la que esta abierta', () => {
    const ref = { current: LOCUCION_1 }
    const caja = crearCajaDeLaFrase({ publishedLiveRef: ref, setLiveTranscript: () => {} })

    const publicacion = caja.publicarEnLaCaja(LOCUCION_2, { canonica: true })

    expect(publicacion.aplicado, 'la caja no adopta otra locucion').toBe(false)
    expect(ref.current, 'la caja sigue siendo la locucion abierta').toBe(LOCUCION_1)
    expect(ref.current, 'MUTACION: si se pegara, la fila llevaria "magistrado" dos veces').not.toContain('magistrado')
  })

  it('MUTACION: sin tramo ni frontera NO hay union (la emision ajena queda bloqueada)', () => {
    const decision = resolverEmisionDeLaCaja(LOCUCION_1, LOCUCION_2)
    expect(decision.aplica).toBe(false)
    expect(decision.motivo).toBe('bloqueado')
    expect(decision.destino).not.toContain('magistrado')
  })

  it('la ventana del TURNO NO funde las dos locuciones: dos filas con la MISMA ventana', () => {
    // La ventana CON VOZ es del TURNO: las dos locuciones caen dentro y la comparten. Usarla
    // como identidad las fundia en UNA fila (auditoria 2026-10-24). La identidad es el turno;
    // la separacion la pone la frontera de audio del ingress.
    const ventanaDelTurno = { inicio: 0, fin: 96000 }
    const primera = commitUserTurnRow({ text: LOCUCION_1, turnId: 1, turnWindow: ventanaDelTurno })
    const segunda = commitUserTurnRow({ text: LOCUCION_2, turnId: 2, turnWindow: ventanaDelTurno })

    expect(primera.action).toBe('added')
    expect(segunda.action, 'la ventana compartida no reutiliza la fila').toBe('added')
    expect(filas()).toHaveLength(2)
  })

  it('MUTACION: la ventana del turno se guarda como dato, no decide nada', () => {
    commitUserTurnRow({ text: LOCUCION_1, turnId: 1, turnWindow: { inicio: 0, fin: 96000 } })
    commitUserTurnRow({ text: LOCUCION_2, turnId: 2, turnWindow: { inicio: 168000, fin: 264000 } })

    expect(filas()).toHaveLength(2)
    expect((filas()[0] as { turnWindow?: unknown }).turnWindow).toEqual({ inicio: 0, fin: 96000 })
  })

  it('MUTACION: la MISMA locucion creciendo SI entra en la caja (no se bloquea todo)', () => {
    const ref = { current: LOCUCION_1 }
    const caja = crearCajaDeLaFrase({ publishedLiveRef: ref, setLiveTranscript: () => {} })

    const crecida = `${LOCUCION_1} magistrado`
    const publicacion = caja.publicarEnLaCaja(crecida)

    expect(publicacion.aplicado, 'una locucion que crece sigue su curso').toBe(true)
    expect(ref.current).toBe(crecida)
  })
})
