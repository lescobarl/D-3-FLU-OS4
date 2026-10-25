// @vitest-environment node
/**
 * ADAPTADOR DE ASR: mapea una instancia inyectada (Web Speech / Whisper local)
 * al contrato `AsrPort` sin cambiar de motor ni aplicar umbrales.
 *
 * El doble imita la superficie REAL que consumen la fachada `api/speech`
 * (`acquireSpeechRecognition`) y el motor local de `api/audio`: eventos
 * `onstart/onresult/onerror/onend`, `start/stop/abort` y `pushAudio`.
 */
import { describe, expect, it } from 'vitest'
import {
  crearAsrReconocimiento,
} from '../src/voice/conversation/adaptersAsr'
import type {
  FuenteAsr,
  MotorReconocimiento,
} from '../src/voice/conversation/adaptersAsr'
import type {
  EstadoAsr,
  MotorAsr,
  OpcionesAsr,
  ResultadoAsr,
} from '../src/voice/conversation/ports'

type Llamadas = {
  start: number
  stop: number
  abort: number
  audio: Array<{ muestras: number; rate: number }>
}

/** Doble de la instancia de reconocimiento (nube y local comparten forma). */
function crearMotor({ conCola = false }: { conCola?: boolean } = {}): {
  motor: MotorReconocimiento
  llamadas: Llamadas
} {
  const llamadas: Llamadas = { start: 0, stop: 0, abort: 0, audio: [] }
  const motor: MotorReconocimiento = {
    onstart: null,
    onresult: null,
    onerror: null,
    onend: null,
    start: () => {
      llamadas.start += 1
    },
    stop: () => {
      llamadas.stop += 1
    },
    abort: () => {
      llamadas.abort += 1
    },
    pushAudio: (muestras, sampleRate) => {
      llamadas.audio.push({ muestras: muestras.length, rate: sampleRate })
    },
    ...(conCola ? { whenIdle: () => Promise.resolve() } : {}),
  }
  return { motor, llamadas }
}

/** Fuente inyectada con los dos motores del doble. */
function crearFuente(nube: MotorReconocimiento, local: MotorReconocimiento): FuenteAsr {
  return {
    nubeSoportada: () => true,
    localSoportada: () => true,
    crearNube: () => nube,
    crearLocal: async () => local,
  }
}

/** Acumula resultados y estados sin depender de mocks parciales. */
function crearSalida(motor: MotorAsr): {
  opciones: OpcionesAsr
  resultados: ResultadoAsr[]
  estados: Array<{ estado: EstadoAsr; detalle?: string }>
} {
  const resultados: ResultadoAsr[] = []
  const estados: Array<{ estado: EstadoAsr; detalle?: string }> = []
  return {
    opciones: {
      idioma: 'es',
      motor,
      alResultado: (resultado) => {
        resultados.push(resultado)
      },
      alEstado: (estado, detalle) => {
        estados.push(detalle ? { estado, detalle } : { estado })
      },
    },
    resultados,
    estados,
  }
}

describe('adaptador de ASR — un motor por sesión', () => {
  it('soportado responde por motor consultando la fuente inyectada', () => {
    const { motor } = crearMotor()
    const asr = crearAsrReconocimiento({
      fuente: {
        nubeSoportada: () => true,
        localSoportada: () => false,
        crearNube: () => motor,
        crearLocal: async () => motor,
      },
    })
    expect(asr.soportado('cloud')).toBe(true)
    expect(asr.soportado('local')).toBe(false)
  })

  it('abre un solo motor y traduce onstart/onresult a estado y resultado', async () => {
    const { motor, llamadas } = crearMotor()
    const { opciones, resultados, estados } = crearSalida('cloud')
    const asr = crearAsrReconocimiento({
      fuente: crearFuente(motor, motor),
    })

    await expect(asr.iniciar(opciones)).resolves.toBe('starting')
    expect(llamadas.start).toBe(1)

    motor.onstart?.()
    const final = Object.assign([{ transcript: 'que tal' }], { isFinal: true })
    motor.onresult?.({
      results: [[{ transcript: 'hola ' }], final],
    })

    expect(estados).toEqual([{ estado: 'active' }])
    expect(resultados).toEqual([{ texto: 'hola que tal', final: true, idioma: 'es' }])
  })

  it('sin permiso del navegador publica no-permission, no error', async () => {
    const { motor } = crearMotor()
    const { opciones, estados } = crearSalida('cloud')
    const asr = crearAsrReconocimiento({
      fuente: crearFuente(motor, motor),
    })
    await asr.iniciar(opciones)
    motor.onerror?.({ error: 'not-allowed' })
    expect(estados).toEqual([{ estado: 'no-permission', detalle: 'not-allowed' }])
  })

  it('un error del motor se publica con su código', async () => {
    const { motor } = crearMotor()
    const { opciones, estados } = crearSalida('cloud')
    const asr = crearAsrReconocimiento({
      fuente: crearFuente(motor, motor),
    })
    await asr.iniciar(opciones)
    motor.onerror?.({ error: 'network' })
    expect(estados).toEqual([{ estado: 'error', detalle: 'network' }])
  })

  it('si start() lanza, devuelve error y no deja el motor abierto', async () => {
    const { motor, llamadas } = crearMotor()
    motor.start = () => {
      throw new Error('microfono ocupado')
    }
    const { opciones } = crearSalida('cloud')
    const asr = crearAsrReconocimiento({
      fuente: crearFuente(motor, motor),
    })
    await expect(asr.iniciar(opciones)).resolves.toBe('error')
    asr.empujarAudio(new Float32Array(4), 16000)
    expect(llamadas.audio).toEqual([])
  })

  it('solo el motor local recibe PCM por empujarAudio', async () => {
    const { motor: nube, llamadas: llamadasNube } = crearMotor()
    const { motor: local, llamadas: llamadasLocal } = crearMotor()
    const asr = crearAsrReconocimiento({
      fuente: crearFuente(nube, local),
    })

    await asr.iniciar(crearSalida('cloud').opciones)
    asr.empujarAudio(new Float32Array(4), 16000)
    expect(llamadasNube.audio).toEqual([])

    const { opciones } = crearSalida('local')
    await asr.iniciar(opciones)
    asr.empujarAudio(new Float32Array(4), 16000)
    expect(llamadasLocal.audio).toEqual([{ muestras: 4, rate: 16000 }])
  })

  it('detener espera la cola local antes de parar y deja de publicar eventos', async () => {
    const { motor, llamadas } = crearMotor({ conCola: true })
    const { opciones, resultados } = crearSalida('local')
    const asr = crearAsrReconocimiento({
      fuente: crearFuente(motor, motor),
    })
    await asr.iniciar(opciones)

    asr.detener()
    motor.onresult?.({ results: [[{ transcript: 'tarde' }]] })
    await Promise.resolve()
    await Promise.resolve()

    expect(llamadas.stop).toBe(1)
    expect(resultados).toEqual([])
  })

  it('abortar cierra el motor y silencia sus eventos', async () => {
    const { motor, llamadas } = crearMotor()
    const { opciones, estados, resultados } = crearSalida('cloud')
    const asr = crearAsrReconocimiento({
      fuente: crearFuente(motor, motor),
    })
    await asr.iniciar(opciones)

    asr.abortar()
    motor.onstart?.()
    motor.onresult?.({ results: [[{ transcript: 'tarde' }]] })
    motor.onerror?.({ error: 'network' })

    expect(llamadas.abort).toBe(1)
    expect(estados).toEqual([])
    expect(resultados).toEqual([])
  })
})
