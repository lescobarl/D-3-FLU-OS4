// @vitest-environment jsdom
/**
 * IMPORTACIÓN DE BACKUP — medida por FUNCIÓN, no por file picker.
 *
 * `BackupSystem.restoreLatestBackup()` parsea el JSON persistido en
 * `flu-backup-<id>` (la misma clave que escribe `saveBackup`) y restaura
 * `conversation_state` en el store. La persistencia de conversación es la que
 * lleva esas N filas a `conversations`:
 *   - `legacy`: N filas escritas, una vez cada una;
 *   - `new`: N filas en total, sin duplicar ni reescribir las que ya existían.
 *
 * La tabla va por `id`, así que un put repetido ACTUALIZA, no duplica: lo que
 * se mide aquí es el conteo de escrituras, no una barrera contra filas dobles.
 */
import 'fake-indexeddb/auto'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BackupSystem,
  type BackupData,
  type BackupMetadata,
  type ConversationStateData,
} from '../src/core/autonomy/backupSystem'
import { STORAGE_KEYS } from '../src/core/config/appConfig'
import { localSet } from '../src/core/storage/localStore'
import { fluDb } from '../src/core/db/fluDatabase'
import { putConversationRecord } from '../src/core/db/conversationRowWriter'
import { useConversationPersistence } from '../src/hooks/useConversationPersistence'
import { useIntegrationStore } from '../src/store/integrationStore'
import type { ConversationEntry } from '../src/types/bridge'

const PARTICIPANTE = 'user-a'
const ID_BACKUP = 'backup-import-prueba'
const UPDATED_AT = '2026-10-25T12:00:00.000Z'
const N_FILAS = 3

/** Siembra el override de runtime del motor en la URL real del documento. */
function fijarMotorEnUrl(motor: 'new' | 'legacy' | null) {
  const url = new URL(window.location.href)
  if (motor) url.searchParams.set('conversationEngine', motor)
  else url.searchParams.delete('conversationEngine')
  window.history.replaceState(null, '', url.toString())
}

/** Filas de usuario tal como viajan dentro de `conversation_state` en un JSON. */
function entradaBackup(indice: number): ConversationEntry {
  return {
    id: `loc-backup-${indice}`,
    role: 'user',
    text: `frase importada ${indice}`,
    timestamp: Date.parse(UPDATED_AT) + indice,
    speakerId: 'usuario',
    speakerName: '',
    sessionId: `sesion-importada-${indice}`,
    meta: { origin: 'import', sessionId: `sesion-importada-${indice}` },
  }
}

/** Escribe en localStorage el JSON que `restoreLatestBackup` va a parsear. */
function sembrarBackupJson(): void {
  const metadata: BackupMetadata = {
    id: ID_BACKUP,
    timestamp: Date.parse(UPDATED_AT),
    strategy: 'full',
    components: ['conversation_state'],
    size: 0,
    checksum: 'prueba',
    appVersion: 'test',
  }
  const conversationState: ConversationStateData = {
    conversationHistory: Array.from({ length: N_FILAS }, (_, indice) => entradaBackup(indice)),
    conversationState: 'IDLE',
    eventLog: [],
    lastUpdated: Date.parse(UPDATED_AT),
  }
  const backup: BackupData = {
    metadata,
    components: { conversation_state: conversationState },
  }
  // `saveBackup` persiste exactamente este JSON en esta clave.
  localSet(`${STORAGE_KEYS.BACKUP_PREFIX}${ID_BACKUP}`, JSON.stringify(backup))
  localSet(STORAGE_KEYS.BACKUP_LIST, JSON.stringify([metadata]))
}

/** Restaura el backup por la misma ruta que usa el producto (último backup). */
function restaurarUltimoBackup(sistema: BackupSystem): void {
  const resultado = sistema.restoreLatestBackup()
  expect(resultado.success).toBe(true)
  expect(resultado.restoredComponents).toEqual(['conversation_state'])
}

/** Fila ya persistida que la importación NO debe reescribir en modo `new`. */
async function sembrarFilaExistente(entrada: ConversationEntry): Promise<void> {
  await putConversationRecord({
    id: entrada.id,
    role: 'user',
    text: entrada.text,
    timestamp: entrada.timestamp,
    speakerId: 'usuario',
    speakerName: '',
    meta: entrada.meta ?? null,
    participantId: PARTICIPANTE,
    sessionId: entrada.sessionId,
    sync: { revision: 1, updated_at: UPDATED_AT, deleted: false },
  })
}

beforeEach(async () => {
  window.localStorage.clear()
  await fluDb.conversations.clear()
  useIntegrationStore.setState({ conversationHistory: [] })
  fijarMotorEnUrl(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  fijarMotorEnUrl(null)
})

describe('importación de backup — N filas por función, en ambos motores', () => {
  it('legacy: N filas del JSON → N filas en conversations en un solo bulkPut, sin duplicados', async () => {
    fijarMotorEnUrl('legacy')
    sembrarBackupJson()
    const sistema = new BackupSystem({ enabled: true })
    const bulkPut = vi.spyOn(fluDb.conversations, 'bulkPut')

    renderHook(() => useConversationPersistence(PARTICIPANTE))
    act(() => {
      restaurarUltimoBackup(sistema)
    })

    await waitFor(async () => {
      expect(await fluDb.conversations.count()).toBe(N_FILAS)
    })
    expect(bulkPut).toHaveBeenCalledTimes(1)
    expect(bulkPut.mock.calls[0]?.[0]).toHaveLength(N_FILAS)
    const filas = await fluDb.conversations.toArray()
    expect(new Set(filas.map((fila) => fila.id)).size).toBe(N_FILAS)
  })

  it('new: N filas con una ya existente → N total, sin duplicar ni reescribir la existente', async () => {
    fijarMotorEnUrl('new')
    sembrarBackupJson()
    const existente = entradaBackup(0)
    await sembrarFilaExistente(existente)
    const sistema = new BackupSystem({ enabled: true })
    const bulkPut = vi.spyOn(fluDb.conversations, 'bulkPut')
    // El store ya conoce la fila existente; la carga asíncrona no compite con
    // la restauración y el montaje la reconoce idéntica (no la reescribe).
    useIntegrationStore.setState({ conversationHistory: [existente] })

    renderHook(() => useConversationPersistence(PARTICIPANTE))
    act(() => {
      restaurarUltimoBackup(sistema)
    })

    await waitFor(async () => {
      expect(await fluDb.conversations.count()).toBe(N_FILAS)
    })
    // Solo se escriben las que faltaban: la existente se reconoció idéntica.
    expect(bulkPut).toHaveBeenCalledTimes(1)
    const escritas = bulkPut.mock.calls[0]?.[0] ?? []
    expect(escritas).toHaveLength(N_FILAS - 1)
    expect(escritas.map((fila) => fila.id).sort()).toEqual(['loc-backup-1', 'loc-backup-2'])

    const previa = await fluDb.conversations.get(existente.id)
    expect(previa?.sync.revision).toBe(1)
    const filas = await fluDb.conversations.toArray()
    expect(new Set(filas.map((fila) => fila.id)).size).toBe(N_FILAS)
  })
})
