// @vitest-environment node
/**
 * ETAPA 3 — UNA FILA POR LOCUCIÓN. La VENTANA DEL TURNO no es identidad.
 *
 * La ventana de audio (`turnWindow`, antes `tramo`) es la del TURNO: dos locuciones del
 * mismo turno la COMPARTEN. Usarla como identidad fundía dos locuciones en UNA fila
 * (auditoría 2026-10-24). La identidad de la fila es el TURNO (`turnId`); la separación
 * entre locuciones la pone la frontera de audio del ingress.
 *
 * La regla retirada se reproduce aquí como MUTACIÓN: si alguien la reintroduce, el test de
 * "dos locuciones = dos filas" se pone rojo.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow } from '../src/voice/conversation'

const filas = () => useIntegrationStore.getState().conversationHistory
const VENTANA_DEL_TURNO = { inicio: 0, fin: 192000 }

beforeEach(() => {
  useIntegrationStore.setState({ conversationHistory: [], conversationEpoch: 0 } as never)
})

describe('ETAPA 3 — la ventana del turno NO decide la fila', () => {
  it('dos locuciones del MISMO turno con la MISMA ventana dan DOS filas', () => {
    const primera = commitUserTurnRow({
      text: 'voy a decir el comando para que sustituya todos los nombres',
      turnId: 1,
      turnWindow: VENTANA_DEL_TURNO,
    })
    const segunda = commitUserTurnRow({
      text: 'magistrado Luis ya le puso Luis a todas las intervenciones',
      turnId: 2,
      turnWindow: VENTANA_DEL_TURNO,
    })

    expect(primera.action).toBe('added')
    expect(segunda.action, 'la ventana compartida NO reutiliza la fila').toBe('added')
    expect(filas(), 'dos locuciones = dos filas').toHaveLength(2)
  })

  it('la ventana se GUARDA como dato de la fila (turnWindow), no como identidad', () => {
    commitUserTurnRow({ text: 'una locucion', turnId: 1, turnWindow: VENTANA_DEL_TURNO })

    const fila = filas()[0] as { turnWindow?: { inicio: number; fin: number }; tramo?: unknown }
    expect(fila.turnWindow).toEqual(VENTANA_DEL_TURNO)
    expect(fila.tramo, 'el campo se llamaba `tramo` y ya no existe').toBeUndefined()
  })

  it('una ventana inválida no se guarda y tampoco cambia la identidad (fin <= inicio)', () => {
    commitUserTurnRow({ text: 'una locucion', turnId: 1, turnWindow: { inicio: 5, fin: 5 } })
    commitUserTurnRow({ text: 'otra locucion', turnId: 2, turnWindow: { inicio: 5, fin: 5 } })

    expect(filas()).toHaveLength(2)
    expect((filas()[0] as { turnWindow?: unknown }).turnWindow).toBeUndefined()
  })

  it('la identidad es el ID ACUÑADO: el mismo id es una re-emisión de la MISMA locución', () => {
    // El id lo acuña el dueño del turno al abrirlo; en el pipeline de micro se acuña por
    // LOCUCIÓN (la frontera cierra el turno vivo). Dos locuciones distintas NO llegan aquí
    // con el mismo id: reciben ids distintos en la frontera (medido en el arnés real).
    const primera = commitUserTurnRow({ text: 'hola a todos', turnId: 7, turnWindow: VENTANA_DEL_TURNO })
    const reemision = commitUserTurnRow({ text: 'hola a todos', turnId: 7, turnWindow: VENTANA_DEL_TURNO })

    expect(primera.action).toBe('added')
    expect(reemision.action, 'la re-emisión de la misma locución reutiliza su fila').toBe('reused')
    expect(filas()).toHaveLength(1)
  })

  it('la ventana NO cruza epochs (una sesión nueva es audio nuevo)', () => {
    commitUserTurnRow({ text: 'de la sesion vieja', turnId: 1, epoch: 0, turnWindow: VENTANA_DEL_TURNO })
    commitUserTurnRow({ text: 'de la sesion nueva', turnId: 2, epoch: 1, turnWindow: VENTANA_DEL_TURNO })

    expect(filas()).toHaveLength(2)
  })
})

describe('MUTACIÓN — la identidad por ventana (regla retirada) está prohibida', () => {
  it('con la identidad por ventana activa las dos locuciones colapsarían en UNA fila', () => {
    // Regla RETIRADA, reproducida aquí: mismo `[inicio, fin]` = misma locución -> reuse.
    const identidadPorVentana = (
      a: { inicio: number; fin: number } | null | undefined,
      b: { inicio: number; fin: number } | null | undefined,
    ) => Boolean(a && b && a.inicio === b.inicio && a.fin === b.fin)

    // La mutación: con esa regla, el segundo commit NO escribiría fila.
    expect(identidadPorVentana(VENTANA_DEL_TURNO, VENTANA_DEL_TURNO)).toBe(true)

    // El escritor REAL ya no la usa: dos locuciones, dos filas (si la regla vuelve, esto
    // deja de cumplirse y el test cae).
    commitUserTurnRow({ text: 'primera locucion del turno', turnId: 1, turnWindow: VENTANA_DEL_TURNO })
    commitUserTurnRow({ text: 'segunda locucion del turno', turnId: 2, turnWindow: VENTANA_DEL_TURNO })
    expect(filas()).toHaveLength(2)
  })

  it('el escritor de la fila no consulta la ventana para reutilizar (guard de fuente)', () => {
    // Corte 2026-10-26: el escritor retirado (conversationTurnRow.ts) se sustituyo por el
    // del modulo nuevo (pasivo.ts); el guard lee el archivo VIVO.
    const fuente = readFileSync(join(process.cwd(), 'src', 'voice', 'conversation', 'pasivo.ts'), 'utf8')
    expect(fuente, 'la identidad por tramo/ventana no puede volver al escritor').not.toMatch(
      /mismoTramo|e\?\.tramo|tramoDeEntrada|turnWindow\s*===/,
    )
  })
})
