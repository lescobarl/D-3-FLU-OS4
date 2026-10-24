// @vitest-environment node
/**
 * ETAPA 3 · UNA FILA POR TRAMO (una sola puerta, un solo escritor).
 *
 * La identidad del AUDIO es el tramo: dos commits con el mismo `[inicio, fin]` son la MISMA
 * locución y comparten fila, aunque el ASR la reemita (el defecto medido: 10 filas
 * duplicadas de 23 commits, 43 %). Un tramo inválido no identifica nada y no deduplica.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow, mismoTramo } from '../src/voice/lib/conversationTurnRow'

const filas = () => useIntegrationStore.getState().conversationHistory

beforeEach(() => {
  useIntegrationStore.setState({ conversationHistory: [], conversationEpoch: 0 } as never)
})

describe('ETAPA 3 · el tramo es la identidad del audio', () => {
  it('MISMO tramo = MISMA fila (el ASR reemite la locución)', () => {
    const primero = commitUserTurnRow({ text: 'hola a todos', turnId: 1, tramo: { inicio: 0, fin: 96000 } })
    const segundo = commitUserTurnRow({ text: 'hola a todos', turnId: 2, tramo: { inicio: 0, fin: 96000 } })

    expect(primero.action).toBe('added')
    expect(segundo.action, 'el mismo audio no abre otra fila').toBe('reused')
    expect(segundo.id).toBe(primero.id)
    expect(filas()).toHaveLength(1)
  })

  it('MUTACIÓN: otro tramo = otra fila (dos locuciones distintas)', () => {
    commitUserTurnRow({ text: 'primera locucion', turnId: 1, tramo: { inicio: 0, fin: 96000 } })
    commitUserTurnRow({ text: 'segunda locucion', turnId: 2, tramo: { inicio: 96000, fin: 192000 } })

    expect(filas()).toHaveLength(2)
  })

  it('MUTACIÓN: un tramo inválido no deduplica (fin <= inicio)', () => {
    commitUserTurnRow({ text: 'una locucion', turnId: 1, tramo: { inicio: 0, fin: 0 } })
    commitUserTurnRow({ text: 'otra locucion', turnId: 2, tramo: { inicio: 5, fin: 5 } })

    expect(filas()).toHaveLength(2)
  })

  it('el tramo NO cruza epochs (una sesión nueva es audio nuevo)', () => {
    commitUserTurnRow({ text: 'de la sesion vieja', turnId: 1, epoch: 0, tramo: { inicio: 0, fin: 96000 } })
    commitUserTurnRow({ text: 'de la sesion nueva', turnId: 2, epoch: 1, tramo: { inicio: 0, fin: 96000 } })

    expect(filas()).toHaveLength(2)
  })

  it('mismoTramo: solo el MISMO audio (sin tolerancias)', () => {
    expect(mismoTramo({ inicio: 0, fin: 10 }, { inicio: 0, fin: 10 })).toBe(true)
    expect(mismoTramo({ inicio: 0, fin: 10 }, { inicio: 0, fin: 11 })).toBe(false)
    expect(mismoTramo({ inicio: 0, fin: 0 }, { inicio: 0, fin: 0 }), 'un tramo vacío no es identidad').toBe(false)
    expect(mismoTramo(null, { inicio: 0, fin: 10 })).toBe(false)
  })
})
