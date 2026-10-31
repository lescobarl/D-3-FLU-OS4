// @vitest-environment jsdom
/**
 * CONTEO DE ESCRITURAS por locución — un solo escritor, sin doble escritura.
 *
 * Con `engine: legacy` no hay módulo: `useConversationPersistence` escribe la
 * fila de usuario UNA vez por el escritor único (si no, las filas desaparecen).
 * Con `engine: new` el módulo ya escribió la fila por el MISMO escritor: la
 * persistencia NO la reescribe (revision queda en 1); sí escribe la fila
 * importada que falta (backup/import) y el resto de roles.
 *
 * La escritura se cuenta con espías reales sobre `fluDb.conversations`, no con
 * un doble: el flujo es el del producto.
 */
import 'fake-indexeddb/auto'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fluDb } from '../src/core/db/fluDatabase'
import { escribirRegistroConversacion } from '../src/core/db/conversationRowWriter'
import type { RegistroConversacion } from '../src/core/db/conversationRowWriter'
import { metaDeFilaConversacion } from '../src/core/db/conversationRowMapping'
import { useConversationPersistence } from '../src/hooks/useConversationPersistence'
import { useIntegrationStore } from '../src/store/integrationStore'
import type { ConversationEntry } from '../src/types/bridge'
import { labelToSpeakerId } from '../src/voice/lib/conversationRow.js'

const UPDATED_AT = '2026-10-25T12:00:00.000Z'

const REGISTRO_MODULO: RegistroConversacion = {
  locutionId: 'loc-modulo',
  sessionId: 'sesion-modulo',
  turnId: 'turno-1',
  texto: 'hola flu',
  inicioMs: 0,
  finMs: 16_000,
  sampleRate: 16_000,
  etiqueta: 'Hablante 1',
  evidencia: 'semilla',
  firma: null,
  idioma: 'es',
  overlap: false,
  provisional: false,
  reason: 'user',
  sync: { revision: 1, updated_at: UPDATED_AT, deleted: false },
}

/** Entrada del store idéntica a la fila que el módulo acaba de escribir. */
function entradaModulo(): ConversationEntry {
  return {
    id: REGISTRO_MODULO.locutionId,
    role: 'user',
    text: REGISTRO_MODULO.texto,
    timestamp: Date.parse(UPDATED_AT),
    speakerId: labelToSpeakerId(REGISTRO_MODULO.etiqueta),
    speakerName: REGISTRO_MODULO.etiqueta,
    sessionId: REGISTRO_MODULO.sessionId,
    meta: metaDeFilaConversacion(
      {
        tramo: {
          inicio: REGISTRO_MODULO.inicioMs,
          fin: REGISTRO_MODULO.finMs,
          sampleRate: REGISTRO_MODULO.sampleRate,
        },
        turnId: REGISTRO_MODULO.turnId,
        etiqueta: REGISTRO_MODULO.etiqueta,
        evidencia: REGISTRO_MODULO.evidencia,
        idioma: REGISTRO_MODULO.idioma,
        overlap: REGISTRO_MODULO.overlap,
        provisional: REGISTRO_MODULO.provisional,
        reason: REGISTRO_MODULO.reason,
      },
      REGISTRO_MODULO.sessionId,
    ),
  }
}

/** Fila de usuario restaurada de un backup que NO existe en la base. */
function entradaImportada(): ConversationEntry {
  return {
    id: 'loc-importada',
    role: 'user',
    text: 'hola desde el backup',
    timestamp: Date.parse(UPDATED_AT) - 1_000,
    speakerId: 'usuario',
    speakerName: '',
    sessionId: 'sesion-importada',
    meta: { origin: 'import', sessionId: 'sesion-importada' },
  }
}

/** Copia un valor con las claves de objeto en orden inverso (mismo contenido). */
function invertirClaves<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map(invertirClaves) as T
  if (!valor || typeof valor !== 'object') return valor
  const origen = valor as Record<string, unknown>
  const salida: Record<string, unknown> = {}
  for (const clave of Object.keys(origen).reverse()) {
    salida[clave] = invertirClaves(origen[clave])
  }
  return salida as T
}

beforeEach(async () => {
  await fluDb.conversations.clear()
  useIntegrationStore.setState({ conversationHistory: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('conteo de escrituras — el módulo es el único escritor de la conversación', () => {
  it('fila de usuario ausente en la base → exactamente UNA escritura y UNA fila', async () => {
    const bulkPut = vi.spyOn(fluDb.conversations, 'bulkPut')
    useIntegrationStore.setState({ conversationHistory: [entradaModulo()] })

    renderHook(() => useConversationPersistence('user-a'))

    await waitFor(async () => {
      expect(await fluDb.conversations.count()).toBe(1)
    })
    expect(bulkPut).toHaveBeenCalledTimes(1)
    const fila = await fluDb.conversations.get(REGISTRO_MODULO.locutionId)
    expect(fila).toMatchObject({
      role: 'user',
      text: 'hola flu',
      sessionId: 'sesion-modulo',
      participantId: 'user-a',
      sync: { revision: 1, deleted: false },
    })
    expect(fila?.meta?.conversacion?.turnId).toBe('turno-1')
  })

  it('new: la fila del módulo NO se reescribe y la importada que falta se escribe UNA vez', async () => {
    await escribirRegistroConversacion(REGISTRO_MODULO, {
      participantId: 'user-a',
      speakerId: labelToSpeakerId(REGISTRO_MODULO.etiqueta),
      speakerName: REGISTRO_MODULO.etiqueta,
    })
    const bulkPut = vi.spyOn(fluDb.conversations, 'bulkPut')
    useIntegrationStore.setState({
      conversationHistory: [entradaModulo(), entradaImportada()],
    })

    renderHook(() => useConversationPersistence('user-a'))

    // La segunda entrada (importada) termina el lote: si la del módulo se hubiera
    // reescrito, su revision habría subido a 2.
    await waitFor(async () => {
      expect(await fluDb.conversations.count()).toBe(2)
    })
    expect(bulkPut).toHaveBeenCalledTimes(1)
    const modulo = await fluDb.conversations.get(REGISTRO_MODULO.locutionId)
    expect(modulo?.sync.revision).toBe(1)
    expect(modulo?.meta?.conversacion?.turnId).toBe('turno-1')
    const importada = await fluDb.conversations.get('loc-importada')
    expect(importada).toMatchObject({
      role: 'user',
      text: 'hola desde el backup',
      sessionId: 'sesion-importada',
      meta: { origin: 'import', sessionId: 'sesion-importada' },
      sync: { revision: 1, deleted: false },
    })
  })

  it('new: el mismo meta con distinto orden de claves no repite la escritura', async () => {
    await escribirRegistroConversacion(REGISTRO_MODULO, {
      participantId: 'user-a',
      speakerId: labelToSpeakerId(REGISTRO_MODULO.etiqueta),
      speakerName: REGISTRO_MODULO.etiqueta,
    })
    const bulkPut = vi.spyOn(fluDb.conversations, 'bulkPut')
    const entrada = entradaModulo()
    // Mismo contenido, claves en orden inverso (como puede devolver un JSON
    // importado). La tabla va por `id`: si se reescribe, actualiza; lo que se
    // mide aquí es la OPTIMIZACIÓN de escritura, no la unicidad de la fila.
    const entradaConOrdenInvertido: ConversationEntry = {
      ...entrada,
      meta: invertirClaves(entrada.meta),
    }
    useIntegrationStore.setState({
      conversationHistory: [entradaConOrdenInvertido, entradaImportada()],
    })

    renderHook(() => useConversationPersistence('user-a'))

    await waitFor(async () => {
      expect(await fluDb.conversations.count()).toBe(2)
    })
    // El lote lleva SOLO la importada: la fila del módulo se reconoció idéntica.
    expect(bulkPut).toHaveBeenCalledTimes(1)
    expect(bulkPut.mock.calls[0]?.[0]?.map((fila) => fila.id)).toEqual(['loc-importada'])
    const modulo = await fluDb.conversations.get(REGISTRO_MODULO.locutionId)
    expect(modulo?.sync.revision).toBe(1)
  })
})
