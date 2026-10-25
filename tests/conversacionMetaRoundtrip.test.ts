// @vitest-environment node
/**
 * IDA Y VUELTA de `meta.conversacion` — la función única de mapeo se usa en los
 * dos sentidos y TODOS los campos se leen de vuelta desde Dexie.
 *
 * Si un campo no vuelve, no está conservado: el test falla. La fila se escribe
 * por el escritor único (`conversationRowWriter`) y se relee abriendo la base.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { fluDb } from '../src/core/db/fluDatabase'
import { mapearMetaConversacion } from '../src/core/db/conversationRowMapping'
import {
  escribirRegistroConversacion,
  registroDesdeFilaConversacion,
} from '../src/core/db/conversationRowWriter'
import type { RegistroConversacion } from '../src/core/db/conversationRowWriter'

const LOCUTION_ID = '00000000-0000-4000-8000-000000000051'
const SESSION_ID = 'sesion-roundtrip'
const UPDATED_AT = '2026-10-25T12:00:00.000Z'

function registro(): RegistroConversacion {
  return {
    locutionId: LOCUTION_ID,
    sessionId: SESSION_ID,
    turnId: 'turno-9',
    texto: 'hola flu, prueba de ida y vuelta',
    inicioMs: 12_345,
    finMs: 67_890,
    sampleRate: 48_000,
    etiqueta: 'Luis',
    evidencia: 'medida',
    idioma: 'en',
    overlap: true,
    provisional: true,
    reason: 'watchdog',
    sync: { revision: 3, updated_at: UPDATED_AT, deleted: false },
  }
}

/** Entrada de la función ÚNICA de mapeo (tramo anidado), derivada del registro. */
function origen(origenRegistro: RegistroConversacion) {
  return {
    tramo: {
      inicio: origenRegistro.inicioMs,
      fin: origenRegistro.finMs,
      sampleRate: origenRegistro.sampleRate,
    },
    turnId: origenRegistro.turnId,
    etiqueta: origenRegistro.etiqueta,
    evidencia: origenRegistro.evidencia,
    idioma: origenRegistro.idioma,
    overlap: origenRegistro.overlap,
    provisional: origenRegistro.provisional,
    reason: origenRegistro.reason,
  }
}

describe('meta.conversacion — ida y vuelta por el escritor único', () => {
  beforeEach(async () => {
    await fluDb.conversations.clear()
  })

  it('escribe una fila y TODOS los campos tipados se leen de vuelta', async () => {
    const registroEscrito = registro()
    await escribirRegistroConversacion(registroEscrito, {
      participantId: 'user-a',
      speakerId: 'speaker_7',
      speakerName: 'Luis',
    })

    await fluDb.open()
    const fila = await fluDb.conversations.get(LOCUTION_ID)
    if (!fila) throw new Error('la fila no se persistio')

    expect({
      id: fila.id,
      role: fila.role,
      text: fila.text,
      timestamp: fila.timestamp,
      speakerId: fila.speakerId,
      speakerName: fila.speakerName,
      participantId: fila.participantId,
      sessionId: fila.sessionId,
    }).toEqual({
      id: LOCUTION_ID,
      role: 'user',
      text: 'hola flu, prueba de ida y vuelta',
      timestamp: Date.parse(UPDATED_AT),
      speakerId: 'speaker_7',
      speakerName: 'Luis',
      participantId: 'user-a',
      sessionId: SESSION_ID,
    })

    // Los nueve campos tipados de `meta.conversacion`, no un JSON opaco.
    expect(fila.meta?.conversacion).toEqual({
      tramo: { inicio: 12_345, fin: 67_890 },
      sampleRate: 48_000,
      turnId: 'turno-9',
      etiqueta: 'Luis',
      evidencia: 'medida',
      idioma: 'en',
      overlap: true,
      provisional: true,
      reason: 'watchdog',
    })
    expect(fila.meta?.origin).toBe('conversation-module')
    expect(fila.meta?.sessionId).toBe(SESSION_ID)

    // Sentido inverso: de la fila persistida al registro plano, con la MISMA
    // función de mapeo. El registro recuperado es idéntico al escrito.
    const recuperado = registroDesdeFilaConversacion(fila)
    expect(recuperado).toEqual(registroEscrito)
    expect(mapearMetaConversacion(origen(registroEscrito))).toEqual(fila.meta?.conversacion)
  })
})
