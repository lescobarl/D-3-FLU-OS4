// @vitest-environment node
/**
 * COMPOSICIÓN DE PRODUCTO: la misma API que monta App produce una fila real.
 *
 * No simula el motor: usa `crearConversacion` con el almacén real en memoria y
 * un tramo declarado por el llamador. La bandera de encendido es la del plan
 * (`conversation.engine`), que por defecto sigue en `legacy`.
 */
import { describe, expect, it } from 'vitest'
import {
  CONVERSACION_CONFIG,
  crearAlmacenMemoria,
  crearConversacion,
  crearIdUuid,
  crearPartidorWake,
  motorConversacionActivo,
} from '../src/voice/conversation/index'
import type { EventoConversacion } from '../src/voice/conversation/index'
import type {
  ConfigPort,
  ConfiguracionConversacion,
} from '../src/voice/conversation/ports'

const TRAMO = { inicio: 16_000, fin: 32_000, sampleRate: 16_000 }

/** Configuración del plan con el motor nuevo encendido (solo para el test). */
function configNueva(): ConfiguracionConversacion {
  return { ...CONVERSACION_CONFIG, conversation: { engine: 'new' } }
}

/** Monta el motor como lo hace el producto: puertos reales y reloj inyectado. */
function crearProducto(configuracion: ConfiguracionConversacion) {
  const reloj = { ahora: () => 1_700_000_000_000 }
  const config: ConfigPort = {
    wakeWords: () => ['ok flu'],
    semillaEtiqueta: () => 'Hablante 1',
  }
  const almacen = crearAlmacenMemoria({ reloj })
  const eventos: EventoConversacion[] = []
  const api = crearConversacion({
    reloj,
    id: crearIdUuid(),
    registro: { registrar: () => undefined },
    almacen,
    config,
    partidor: crearPartidorWake(config),
    configuracion,
    ultimoTextoDicho: () => '',
  })
  api.subscribe((evento) => eventos.push(evento))
  return { api, almacen, eventos }
}

describe('composición de producto del motor de conversación', () => {
  it('la bandera del plan sigue apagada por defecto y solo `new` la enciende', () => {
    expect(motorConversacionActivo()).toBe(false)
    expect(motorConversacionActivo(configNueva())).toBe(true)
  })

  it('con engine new, un ASR final produce UNA fila persistida y su evento', async () => {
    const { api, almacen, eventos } = crearProducto(configNueva())
    await api.start({ turnId: 'turno-1', idioma: 'es' })

    await api.ingestAsr({
      tramoId: crearIdUuid().uuid(),
      texto: 'hola flu',
      final: true,
      idioma: 'es',
      tramo: TRAMO,
      turnId: 'turno-1',
    })
    const cierre = await api.stop('user')

    expect(cierre.filas).toHaveLength(1)
    expect(cierre.filas[0]).toMatchObject({
      texto: 'hola flu',
      revision: 1,
      deleted: false,
      etiqueta: 'Hablante 1',
    })
    const sessionId = cierre.sessionId
    if (!sessionId) throw new Error('la sesion cerrada no expone sessionId')
    expect(await almacen.leerSesion(sessionId)).toHaveLength(1)
    expect(eventos.filter((evento) => evento.tipo === 'row.committed')).toHaveLength(1)
  })
})
