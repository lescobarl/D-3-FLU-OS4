// @vitest-environment node
/**
 * PUERTOS Y ADAPTADORES del módulo CONVERSACIÓN.
 *
 * Mide los contratos y los adaptadores REALES que hoy pueden construirse dentro
 * de la frontera del módulo: tabla de config, bandera de motor, ids, reloj,
 * almacén en memoria con tupla de sync, splitter de wake, TTS y ASR de nube.
 *
 * No mide las reglas de frontera/revisión/fila (tienen sus propios guards) ni
 * finge los adaptadores que la fachada pública todavía no expone: micrófono,
 * embeddings y escritura Dexie. Esos quedan declarados PENDIENTES.
 */
import { describe, expect, it } from 'vitest'
import {
  crearAlmacenMemoria,
  crearConfigFlu,
  crearIdUuid,
  crearPartidorWake,
  crearRegistroCaughtError,
  crearRelojSistema,
} from '../src/voice/conversation/adapters'
import {
  CONVERSACION_CONFIG,
  motorConversacionActivo,
} from '../src/voice/conversation/ports'
import type {
  AsrPort,
  ConfigPort,
  ConfiguracionConversacion,
  EmbebedorPort,
  FilaNueva,
  RelojPort,
  TtsPort,
  VadPort,
} from '../src/voice/conversation/ports'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Fila nueva mínima: datos de test, no valores del dominio. */
const filaNueva = (locutionId: string): FilaNueva => ({
  locutionId,
  sessionId: 's1',
  turnId: 't1',
  texto: 'hola',
  tramo: { inicio: 0, fin: 16000, sampleRate: 16000 },
  etiqueta: 'Hablante 1',
  evidencia: 'semilla',
  idioma: 'es',
  overlap: false,
  provisional: false,
  reason: 'user',
})

const configDePrueba = (): ConfigPort => ({
  wakeWords: () => ['ok flu'],
  semillaEtiqueta: () => 'Hablante 1',
  localFallbackHabilitado: () => false,
})

describe('configuración del plan — una sola fuente', () => {
  it('los defaults son exactamente los de la tabla', () => {
    expect(CONVERSACION_CONFIG).toEqual({
      minSilenceMs: 900,
      silenceCloseMs: 5000,
      orphanBufferMs: 8000,
      asr: { engine: 'auto', lang: 'es' },
      maxRetentionMin: 120,
      overlapMargin: null,
      conversation: { engine: 'legacy' },
    })
  })

  it('la tabla está congelada: nadie la cambia en caliente', () => {
    expect(Object.isFrozen(CONVERSACION_CONFIG)).toBe(true)
    expect(Object.isFrozen(CONVERSACION_CONFIG.asr)).toBe(true)
    expect(Object.isFrozen(CONVERSACION_CONFIG.conversation)).toBe(true)
  })

  it('legacy por defecto; new solo con la bandera inyectada', () => {
    expect(motorConversacionActivo()).toBe(false)
    const nueva: ConfiguracionConversacion = {
      ...CONVERSACION_CONFIG,
      conversation: { engine: 'new' },
    }
    expect(motorConversacionActivo(nueva)).toBe(true)
    const vieja: ConfiguracionConversacion = {
      ...CONVERSACION_CONFIG,
      conversation: { engine: 'legacy' },
    }
    expect(motorConversacionActivo(vieja)).toBe(false)
  })
})

describe('identidad y tiempo inyectados', () => {
  it('los ids son UUIDv4 y no se repiten', () => {
    const ids = crearIdUuid()
    const primero = ids.uuid()
    const segundo = ids.uuid()
    expect(primero).toMatch(UUID_V4)
    expect(segundo).toMatch(UUID_V4)
    expect(primero).not.toBe(segundo)
  })

  it('el reloj del sistema devuelve una marca finita', () => {
    const marca = crearRelojSistema().ahora()
    expect(Number.isFinite(marca)).toBe(true)
    expect(marca).toBeGreaterThan(0)
  })
})

describe('almacén — una fila por locución y tupla [revision, updated_at, deleted]', () => {
  it('guardar asigna la tupla; actualizar incrementa revisión; el borrado es lógico', async () => {
    let ahora = 1000
    const reloj: RelojPort = { ahora: () => ahora }
    const almacen = crearAlmacenMemoria({ reloj })

    const guardada = await almacen.guardar(filaNueva('loc-1'))
    expect(guardada).toMatchObject({ revision: 1, updated_at: 1000, deleted: false })

    ahora = 2000
    const promovida = await almacen.actualizar('loc-1', { provisional: true })
    expect(promovida).toMatchObject({ revision: 2, updated_at: 2000, provisional: true })

    ahora = 3000
    const borrada = await almacen.actualizar('loc-1', { deleted: true })
    expect(borrada).toMatchObject({ revision: 3, deleted: true })

    const deSesion = await almacen.leerSesion('s1')
    expect(deSesion).toHaveLength(1)
    expect(deSesion[0].deleted).toBe(true)
  })

  it('no se inserta dos veces la misma locución', async () => {
    const almacen = crearAlmacenMemoria({ reloj: { ahora: () => 1 } })
    await almacen.guardar(filaNueva('loc-1'))
    await expect(almacen.guardar(filaNueva('loc-1'))).rejects.toThrow(/duplicada/)
  })

  it('actualizar una fila inexistente devuelve null, no inventa fila', async () => {
    const almacen = crearAlmacenMemoria({ reloj: { ahora: () => 1 } })
    expect(await almacen.actualizar('no-existe', { provisional: false })).toBeNull()
  })
})

describe('splitter de wake — canónica completa, presentación sin wake', () => {
  it('la frase canónica conserva la wake; la presentación la quita', () => {
    const partidor = crearPartidorWake(configDePrueba())
    expect(partidor.partir('ok flu hola mundo')).toEqual({
      canonica: 'ok flu hola mundo',
      paraMostrar: 'hola mundo',
      comando: 'hola mundo',
      wakeWordMatched: true,
    })
    expect(partidor.partir('hola mundo')).toEqual({
      canonica: 'hola mundo',
      paraMostrar: 'hola mundo',
      comando: '',
      wakeWordMatched: false,
    })
  })

  it('con ruido delante, la presentación empieza en la wake', () => {
    const partidor = crearPartidorWake(configDePrueba())
    expect(partidor.partir('ruido de la tele ok flu hola')).toMatchObject({
      canonica: 'ruido de la tele ok flu hola',
      paraMostrar: 'hola',
      wakeWordMatched: true,
    })
  })
})

describe('config viva — sale de FLU_CONFIG, no inventa wake', () => {
  it('expone wake, semilla y la política de fallback local', () => {
    const config = crearConfigFlu()
    expect(config.wakeWords().length).toBeGreaterThan(0)
    expect(config.semillaEtiqueta()).not.toBe('')
    expect(typeof config.localFallbackHabilitado()).toBe('boolean')
  })
})

describe('puertos inyectables — VAD, embeddings y registro', () => {
  it('VAD y embeddings se implementan sin el módulo (contrato usable)', async () => {
    const vad: VadPort = { medir: () => ({ hayVoz: true, silencioMs: 0 }) }
    const embebedor: EmbebedorPort = { medir: async () => null }
    expect(vad.medir(new Float32Array(0), 16000)).toEqual({ hayVoz: true, silencioMs: 0 })
    expect(await embebedor.medir(new Float32Array(0), 16000)).toBeNull()
  })

  it('el registro del proyecto está detrás del puerto', () => {
    const registro = crearRegistroCaughtError()
    expect(typeof registro.registrar).toBe('function')
  })

  it('TTS y ASR se implementan sin el módulo (contrato usable)', async () => {
    const dichos: string[] = []
    const tts: TtsPort = {
      hablar: async (texto) => {
        dichos.push(texto)
      },
      hablando: () => dichos.length > 0,
      detener: () => {
        dichos.length = 0
      },
      ultimoTexto: () => dichos[dichos.length - 1] ?? '',
    }
    await tts.hablar('hola', 'es')
    expect(tts.ultimoTexto()).toBe('hola')
    expect(tts.hablando()).toBe(true)
    tts.detener()
    expect(tts.hablando()).toBe(false)

    const vistos: string[] = []
    const asr: AsrPort = {
      soportado: () => true,
      iniciar: async (opciones) => {
        opciones.alEstado('active')
        opciones.alResultado({ texto: 'hola', final: true, idioma: 'es' })
        return 'active'
      },
      empujarAudio: () => undefined,
      detener: () => undefined,
      abortar: () => undefined,
    }
    const estado = await asr.iniciar({
      idioma: 'es',
      motor: 'cloud',
      alResultado: (resultado) => vistos.push(resultado.texto),
      alEstado: (nuevo) => vistos.push(nuevo),
    })
    expect(estado).toBe('active')
    expect(vistos).toEqual(['active', 'hola'])
    asr.detener()
    asr.abortar()
  })
})
