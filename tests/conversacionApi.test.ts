// @vitest-environment node
/**
 * API del módulo CONVERSACIÓN — 7 llamadas, 6 eventos y reglas 1–6 de punta a
 * punta, con el almacén real en memoria y fixtures sintéticos.
 *
 * Cada caso falla si se quita la rama que mide: frontera tras aplicar texto,
 * no-pérdida de palabras, caja sin retroceso, cierre por stop, eco/barge-in,
 * huérfanos contados y una sola fila por tramo. Mandato 2026-10-30: el final
 * NO cierra (la puerta de abajo es el silencio de 5 s o el texto ajeno) y la
 * fila commiteada es INMUTABLE (insert-only): la reentrega no la reescribe.
 */
import { describe, expect, it } from 'vitest'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'
import { detectListeningControl } from '../src/voice/lib/audioMath.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import {
  crearConversacion,
  esEcoDeTts,
} from '../src/voice/conversation/index'
import type {
  AsrIngestado,
  BloqueAudio,
  ConversacionApi,
  DependenciasConversacion,
  EventoConversacion,
} from '../src/voice/conversation/index'
import {
  crearAlmacenMemoria,
  crearIdUuid,
  crearMedidorTramo,
  crearPartidorWake,
} from '../src/voice/conversation/adapters'
import { CONVERSACION_CONFIG } from '../src/voice/conversation/ports'
import { vozMsDeMuestras } from '../src/voice/conversation/muestras'
import type {
  AsrPort,
  ConfigPort,
  EntradaRespaldoLocal,
  EstadoAsr,
  MedidaVad,
  MotivoCierre,
  OpcionesAsr,
  ResultadoAsr,
  ResultadoRespaldoLocal,
  TranscriptorTramoPort,
} from '../src/voice/conversation/ports'

const SAMPLE_RATE = 16000
const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_C = '33333333-3333-4333-8333-333333333333'
const UUID_D = '44444444-4444-4444-8444-444444444444'
const UUID_E = '55555555-5555-4555-8555-555555555555'

const crearReloj = () => {
  let ahora = 1_700_000_000_000
  return {
    ahora: () => ahora,
    avanzar: (ms: number) => {
      ahora += ms
    },
  }
}

const crearRegistro = () => {
  const contextos: string[] = []
  return {
    contextos,
    registrar: (contexto: string) => {
      contextos.push(contexto)
    },
  }
}

const configDePrueba = (): ConfigPort => ({
  wakeWords: () => ['ok flu'],
  // Estados REALES del producto: XX (no identificado) y X (en espera). `N` lo
  // produce `etiquetaAnonima` para una voz medida.
  semillaEtiqueta: () => FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker,
  etiquetaPendiente: () => FLU_CONFIG.voiceIdentity.labels.pendingSpeaker,
  esEtiquetaAnonima: isAutoSpeakerLabel,
  umbralContinuidadVoz: () => 0.8,
  etiquetaAnonima: (indice) => `Hablante ${indice}`,
  echoMinPalabrasCola: () => 4,
})

function crearEscenario(extra: Partial<DependenciasConversacion> = {}) {
  const reloj = crearReloj()
  const registro = crearRegistro()
  const config = configDePrueba()
  const almacen = crearAlmacenMemoria({ reloj })
  const api = crearConversacion({
    reloj,
    id: crearIdUuid(),
    registro,
    almacen,
    config,
    partidor: crearPartidorWake(config),
    medidor: crearMedidorTramo(),
    ultimoTextoDicho: () => '',
    ...extra,
  })
  const eventos: EventoConversacion[] = []
  api.subscribe((evento) => eventos.push(evento))
  return { api, reloj, registro, almacen, config, eventos }
}

const VOZ = (silencioMs = 0): MedidaVad => ({ hayVoz: true, silencioMs })
const SILENCIO = (silencioMs: number): MedidaVad => ({ hayVoz: false, silencioMs })

const bloque = (inicio: number, fin: number, medida: MedidaVad): BloqueAudio => ({
  muestras: new Float32Array(fin - inicio),
  sampleRate: SAMPLE_RATE,
  inicio,
  fin,
  medida,
})

/** Abre una locución con un bloque con voz y devuelve su `tramoId`. */
async function abrirConVoz(api: ConversacionApi, inicio = 0): Promise<string> {
  const estado = await api.ingestAudio(bloque(inicio, inicio + SAMPLE_RATE, VOZ()))
  if (!estado.locucionAbierta) throw new Error('el audio con voz no abrio locucion')
  return estado.locucionAbierta.locutionId
}

/** Cierra la locución abierta por SILENCIO (puerta de abajo, mandato 2026-10-30). */
async function cerrarPorSilencio(api: ConversacionApi, inicio: number) {
  const muestras = Math.round((SAMPLE_RATE * CONVERSACION_CONFIG.silenceCloseMs) / 1000)
  return api.ingestAudio(
    bloque(inicio, inicio + muestras, SILENCIO(CONVERSACION_CONFIG.silenceCloseMs)),
  )
}

const asr = (tramoId: string, extra: Partial<AsrIngestado> = {}): AsrIngestado => ({
  tramoId,
  texto: 'hola',
  final: false,
  ...extra,
})

function crearAsrFalso(soportado: (motor: 'cloud' | 'local') => boolean = () => true) {
  let opciones: OpcionesAsr | null = null
  let iniciado = 0
  let detenido = 0
  const empujados: number[] = []
  const asrPort: AsrPort = {
    soportado,
    iniciar: async (recibidas) => {
      opciones = recibidas
      iniciado += 1
      recibidas.alEstado('active')
      return 'active'
    },
    empujarAudio: (muestras) => {
      empujados.push(muestras.length)
    },
    detener: () => {
      detenido += 1
    },
    abortar: () => undefined,
  }
  return {
    asrPort,
    empujados,
    resultado: (resultado: ResultadoAsr) => opciones?.alResultado(resultado),
    estado: (estado: EstadoAsr, detalle?: string) => opciones?.alEstado(estado, detalle),
    iniciado: () => iniciado,
    detenido: () => detenido,
  }
}

function crearDicho(ultimo: string) {
  let dicho = ultimo
  return {
    ultimoTextoDicho: () => dicho,
    dejaDeHablar: () => {
      dicho = ''
    },
  }
}

describe('ciclo de vida — 7 llamadas', () => {
  it('start abre una sesión con UUIDv4 y sin filas', async () => {
    const { api } = crearEscenario()
    const estado = await api.start()
    expect(estado.activa).toBe(true)
    expect(estado.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(estado.box).toEqual({ texto: '', abierta: false, textoPendiente: '' })
    expect(estado.filas).toEqual([])
    expect(estado.asr).toBe('idle')
  })

  it('un segundo start sin stop es un error, no una segunda sesión', async () => {
    const { api } = crearEscenario()
    await api.start()
    await expect(api.start()).rejects.toThrow(/ya iniciada/)
  })

  it('sin ultimoTextoDicho el modulo no arranca', () => {
    const reloj = crearReloj()
    const config = configDePrueba()
    const sinEco = {
      reloj,
      id: crearIdUuid(),
      registro: crearRegistro(),
      almacen: crearAlmacenMemoria({ reloj }),
      config,
      partidor: crearPartidorWake(config),
    }
    expect(() =>
      crearConversacion(sinEco as unknown as DependenciasConversacion),
    ).toThrow(/ultimoTextoDicho/)
  })

  it('ingerir antes de start no inventa sesión', async () => {
    const { api } = crearEscenario()
    await expect(api.ingestAudio(bloque(0, 100, VOZ()))).rejects.toThrow(/no iniciada/)
    await expect(api.ingestAsr(asr(UUID_A))).rejects.toThrow(/no iniciada/)
  })

  it('stop(aborted) no es un motivo de fila: aborted es estado del ASR', async () => {
    const { api } = crearEscenario()
    await api.start()
    const invalido: MotivoCierre = JSON.parse('"aborted"')
    await expect(api.stop(invalido)).rejects.toThrow(/no es un motivo de fila/)
  })

  it('subscribe devuelve la baja y deja de emitir', async () => {
    const { api } = crearEscenario()
    const propios: EventoConversacion[] = []
    const baja = api.subscribe((evento) => propios.push(evento))
    baja()
    await api.start()
    await api.stop('system')
    expect(propios).toEqual([])
  })
})

describe('regla 1 y 3 — el audio abre el tramo y el texto lo revisa', () => {
  it('el tramo de audio se expone y es el mismo id de la locución', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    const estado = api.snapshot()
    expect(estado.tramoAudio?.tramoId).toBe(tramoId)
    expect(estado.locucionAbierta?.locutionId).toBe(tramoId)
    expect(estado.tramoAudio).toMatchObject({
      inicio: 0,
      fin: SAMPLE_RATE,
      sampleRate: SAMPLE_RATE,
    })
  })

  it('más palabras extiende y menos palabras no se pinta', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr(asr(tramoId, { texto: 'hola' }))
    expect(api.snapshot().box.texto).toBe('hola')
    await api.ingestAsr(asr(tramoId, { texto: 'hola mundo entero' }))
    expect(api.snapshot().box.texto).toBe('hola mundo entero')
    await api.ingestAsr(asr(tramoId, { texto: 'hola mundo' }))
    expect(api.snapshot().box.texto).toBe('hola mundo entero')
  })

  it('el final del mismo tramo cierra UNA fila sin truncar la frase ya oída', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr(asr(tramoId, { texto: 'hola mundo entero' }))
    await api.ingestAsr(asr(tramoId, { texto: 'hola mundo', final: true }))
    // Regla 1/2/12 del dueño (2026-11-12): la transcripción no decrece. El final
    // puede ampliar o corregir, pero un final más corto NO borra la cola ya
    // visible. El silencio (puerta de abajo) cierra UNA fila insert-only.
    const estado = await cerrarPorSilencio(api, SAMPLE_RATE)
    expect(estado.filas).toHaveLength(1)
    expect(estado.filas[0]).toMatchObject({
      locutionId: tramoId,
      texto: 'hola mundo entero',
      provisional: false,
    })
    expect(estado.box).toEqual({ texto: '', abierta: false, textoPendiente: '' })
  })

  it('un final tardío suma el audio de la continuación al tramo abierto', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoA = await abrirConVoz(api, 0)
    await api.ingestAsr(asr(tramoA, { texto: 'hola' }))
    // El VAD corta el tramo vivo, pero la locución sigue ABIERTA.
    await api.ingestAudio(bloque(SAMPLE_RATE, SAMPLE_RATE * 2, SILENCIO(900)))
    // Habla nueva: abre OTRO tramo de audio mientras A sigue abierta.
    const inicioB = SAMPLE_RATE * 6
    const finB = inicioB + SAMPLE_RATE
    await api.ingestAudio(bloque(inicioB, finB, VOZ()))
    // Vuelve a cortar antes de que llegue el final del ASR.
    await api.ingestAudio(bloque(finB, finB + SAMPLE_RATE, SILENCIO(900)))
    // El final llega sin tramo (como lo entrega el producto): se atribuye a A y
    // debe sumar el audio de B; antes A medía solo su primer tramo (Hablante XX).
    const estado = await api.ingestAsr(asr('', { texto: 'hola mundo', final: true }))
    expect(estado.locucionAbierta?.tramo.fin).toBeGreaterThanOrEqual(finB)
    const cerrada = await cerrarPorSilencio(api, finB + SAMPLE_RATE)
    expect(cerrada.filas).toHaveLength(1)
    expect(cerrada.filas[0]?.texto).toBe('hola mundo')
    expect(cerrada.filas[0]?.tramo.fin).toBeGreaterThanOrEqual(finB)
  })

  it('dos llamadas concurrentes al mismo tramo no duplican la fila', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await Promise.all([
      api.ingestAsr(asr(tramoId, { texto: 'hola', final: true })),
      api.ingestAsr(asr(tramoId, { texto: 'hola', final: true })),
    ])
    const estado = await cerrarPorSilencio(api, SAMPLE_RATE)
    expect(estado.filas).toHaveLength(1)
  })
})

describe('regla 4 y stop — provisional o descarte contado', () => {
  it('silencio 5000 sin texto ajeno cierra la fila provisional', async () => {
    const { api, eventos } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr(asr(tramoId, { texto: 'hola' }))
    const estado = await api.ingestAudio(
      bloque(SAMPLE_RATE, SAMPLE_RATE * 6, SILENCIO(CONVERSACION_CONFIG.silenceCloseMs)),
    )
    expect(estado.filas).toHaveLength(1)
    expect(estado.filas[0]).toMatchObject({ texto: 'hola', provisional: true, reason: 'system' })
    expect(estado.box.abierta).toBe(false)
    expect(eventos).toContainEqual(
      expect.objectContaining({ tipo: 'locution.closed', causa: 'silencio' }),
    )
  })

  it('stop(user) a media frase deja fila provisional con reason user', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr(asr(tramoId, { texto: 'media frase' }))
    const estado = await api.stop('user')
    expect(estado.filas).toHaveLength(1)
    expect(estado.filas[0]).toMatchObject({
      texto: 'media frase',
      provisional: true,
      reason: 'user',
    })
  })

  it('stop(system) sin texto cuenta un descarte, no inventa fila', async () => {
    const { api, registro } = crearEscenario()
    await api.start()
    await abrirConVoz(api)
    const estado = await api.stop('system')
    expect(estado.filas).toEqual([])
    expect(estado.descartes).toEqual([
      expect.objectContaining({ motivo: 'sinTexto' }),
    ])
    expect(registro.contextos).toContain('conversacion.descarte')
  })

  it('stop a mitad de frase nunca pierde el texto ya escrito', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr(asr(tramoId, { texto: 'no se pierde' }))
    const estado = await api.stop('watchdog')
    expect(estado.filas[0]).toMatchObject({ texto: 'no se pierde', reason: 'watchdog' })
  })
})

describe('reentrega — el final tardío NO reescribe la fila (insert-only, mandato 2026-10-30)', () => {
  it('un final posterior NO promueve la fila cerrada por silencio', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr(asr(tramoId, { texto: 'hola' }))
    await api.ingestAudio(
      bloque(SAMPLE_RATE, SAMPLE_RATE * 6, SILENCIO(CONVERSACION_CONFIG.silenceCloseMs)),
    )
    const reentrega = await api.ingestAsr(
      asr(tramoId, { texto: 'hola mundo', final: true }),
    )
    expect(reentrega.filas).toHaveLength(1)
    expect(reentrega.filas[0]).toMatchObject({
      texto: 'hola',
      provisional: true,
      revision: 1,
    })
  })

  it('el final tardío tras stop(user) NO reescribe la fila de la sesión anterior', async () => {
    const { api, eventos } = crearEscenario()
    const filas = () =>
      eventos.flatMap((evento) => (evento.tipo === 'row.committed' ? [evento.fila] : []))
    const primera = await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr(asr(tramoId, { texto: 'hola' }))
    await api.stop('user')
    if (!primera.sessionId) throw new Error('sin sesion')
    const antes = filas()
    expect(antes).toHaveLength(1)
    expect(antes[0]).toMatchObject({
      sessionId: primera.sessionId,
      provisional: true,
      texto: 'hola',
    })

    // El tramo ya commiteó: la reentrega se ignora (`tramoYaCommiteado`), la
    // fila de la sesión anterior queda inmutable.
    await api.start()
    await api.ingestAsr(asr(tramoId, { texto: 'hola mundo', final: true }))
    const despues = filas()
    expect(despues).toHaveLength(1)
    expect(despues[0]).toMatchObject({
      sessionId: primera.sessionId,
      texto: 'hola',
      provisional: true,
      revision: 1,
    })
  })
})

describe('regla 5 — etiquetas con evidencia y solo la voz que habló', () => {
  it('dos voces medidas producen dos etiquetas distintas', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoUno = await abrirConVoz(api, 0)
    await api.ingestAsr(
      asr(tramoUno, { texto: 'uno', voz: { vozId: 'A', hablante: 'Hablante 1' } }),
    )
    await api.ingestAudio(bloque(SAMPLE_RATE, SAMPLE_RATE * 2, SILENCIO(900)))
    await api.ingestAudio(bloque(SAMPLE_RATE * 2, SAMPLE_RATE * 3, VOZ()))
    const tramoDos = api.snapshot().tramoAudio?.tramoId
    if (!tramoDos) throw new Error('sin tramo nuevo')
    await api.ingestAsr(
      asr(tramoDos, {
        texto: 'dos',
        final: true,
        voz: { vozId: 'B', hablante: 'Hablante 2' },
      }),
    )
    const estado = await cerrarPorSilencio(api, SAMPLE_RATE * 3)
    expect(estado.filas.map((fila) => fila.etiqueta)).toEqual(['Hablante 1', 'Hablante 2'])
    expect(estado.filas.every((fila) => fila.evidencia === 'medida')).toBe(true)
  })

  it('registerName bautiza solo la voz que lo dijo y no otra', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoUno = await abrirConVoz(api, 0)
    await api.ingestAsr(
      asr(tramoUno, { texto: 'ok flu soy ana', voz: { vozId: 'A', hablante: 'Hablante 1' } }),
    )
    const nombrada = await api.registerName({ nombre: 'Ana' })
    expect(nombrada.descartes).toEqual([])
    await api.ingestAsr(asr(tramoUno, { texto: 'ok flu soy ana', final: true }))
    const cerrada = await cerrarPorSilencio(api, SAMPLE_RATE)
    expect(cerrada.filas[0]).toMatchObject({ etiqueta: 'Ana', evidencia: 'nombre' })

    await api.ingestAudio(bloque(SAMPLE_RATE * 2, SAMPLE_RATE * 3, VOZ()))
    const tramoDos = api.snapshot().tramoAudio?.tramoId
    if (!tramoDos) throw new Error('sin tramo nuevo')
    await api.ingestAsr(
      asr(tramoDos, { texto: 'otra voz', final: true, voz: { vozId: 'B' } }),
    )
    const otra = await cerrarPorSilencio(api, SAMPLE_RATE * 3)
    // Sin medida de esa voz y sin etiqueta temporal, el estado honesto es XX.
    expect(otra.filas[1].etiqueta).toBe(FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker)
    expect(otra.filas[1].etiqueta).not.toBe('Ana')
  })

  it('un vector conocido en la base se presenta con su nombre propio (regla 8)', async () => {
    const { api } = crearEscenario({
      anclasBase: () => [{ name: 'Luis', vector: [1, 0] }],
      embebedor: {
        medir: async () => [1, 0],
        comparar: (a, b) => a[0]! * b[0]! + a[1]! * b[1]!,
      },
    })
    await api.start()
    const tramo = await abrirConVoz(api, 0)
    await api.ingestAsr(asr(tramo, { texto: 'hola soy luis', final: true }))
    const cerrada = await cerrarPorSilencio(api, SAMPLE_RATE)
    // El vector casa con el ancla medida de la base: nombre, no `Hablante N`.
    expect(cerrada.filas[0]?.etiqueta).toBe('Luis')
  })

  it('sin voz identificada el nombre queda PENDIENTE y bautiza la voz que cierra (problema 5)', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoUno = await abrirConVoz(api, 0)
    await api.ingestAsr(
      asr(tramoUno, { texto: 'ok flu soy ana', voz: { hablante: 'Hablante 1' } }),
    )
    // La medida de respaldo resuelve la voz AL CERRAR: sin vozId aún, el nombre
    // no se pierde — queda pendiente y se aplica a la voz que cierre la locución.
    const pendiente = await api.registerName({ nombre: 'Ana' })
    expect(pendiente.descartes).toEqual([])
    await api.ingestAsr(
      asr(tramoUno, { texto: 'ok flu soy ana', final: true, voz: { vozId: 'A' } }),
    )
    const cerrada = await cerrarPorSilencio(api, SAMPLE_RATE)
    expect(cerrada.filas[0]).toMatchObject({ etiqueta: 'Ana', evidencia: 'nombre' })

    // La voz quedó REGISTRADA: la siguiente fila de la MISMA voz lleva el nombre.
    await api.ingestAudio(bloque(SAMPLE_RATE * 2, SAMPLE_RATE * 3, VOZ()))
    const tramoDos = api.snapshot().tramoAudio?.tramoId
    if (!tramoDos) throw new Error('sin tramo nuevo')
    await api.ingestAsr(
      asr(tramoDos, { texto: 'sigo yo', final: true, voz: { vozId: 'A' } }),
    )
    const otra = await cerrarPorSilencio(api, SAMPLE_RATE * 3)
    expect(otra.filas[1]).toMatchObject({ etiqueta: 'Ana', evidencia: 'nombre' })
  })

  it('sin vector, el comando sustituye la etiqueta YA escrita y no bautiza a la siguiente', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoUno = await abrirConVoz(api, 0)
    // La fila del comando nace SIN voz medida: etiqueta provisional "Hablante 1".
    await api.ingestAsr(
      asr(tramoUno, { texto: 'ok flu soy ana', final: true, voz: { hablante: 'Hablante 1' } }),
    )
    const cerrada = await cerrarPorSilencio(api, SAMPLE_RATE)
    expect(cerrada.filas[0]).toMatchObject({ etiqueta: 'Hablante 1' })

    // El bautizo llega DESPUÉS del commit (row.committed): el WHERE es la etiqueta.
    await api.registerName({ nombre: 'Ana', etiqueta: 'Hablante 1' })
    expect(api.snapshot().filas[0]).toMatchObject({ etiqueta: 'Ana', evidencia: 'nombre' })

    // Otra voz: el nombre no puede colarse en ella.
    await api.ingestAudio(bloque(SAMPLE_RATE * 2, SAMPLE_RATE * 3, VOZ()))
    const tramoDos = api.snapshot().tramoAudio?.tramoId
    if (!tramoDos) throw new Error('sin tramo nuevo')
    await api.ingestAsr(
      asr(tramoDos, { texto: 'otra voz', final: true, voz: { vozId: 'B', hablante: 'Hablante 2' } }),
    )
    const otra = await cerrarPorSilencio(api, SAMPLE_RATE * 3)
    expect(otra.filas[1].etiqueta).not.toBe('Ana')
  })

  it('el nombre ? se rechaza y nunca llega a una fila', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr(asr(tramoId, { texto: 'hola', voz: { vozId: 'A' } }))
    await expect(api.registerName({ nombre: '?' })).rejects.toThrow(/nombre \?/)
  })
})

describe('regla 6 — la caja es la locución abierta y solo el cierre la vacía', () => {
  it('la frase canónica conserva la wake; la presentación la quita', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    const estado = await api.ingestAsr(asr(tramoId, { texto: 'ok flu hola mundo' }))
    expect(estado.box.texto).toBe('ok flu hola mundo')
    expect(estado.fraseCanonica).toBe('ok flu hola mundo')
    expect(estado.fraseParaMostrar).toBe('hola mundo')
  })

  it('la caja no retrocede con una revisión que pierde palabras', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr(asr(tramoId, { texto: 'tres palabras ahora' }))
    await api.ingestAsr(asr(tramoId, { texto: 'tres' }))
    expect(api.snapshot().box.texto).toBe('tres palabras ahora')
  })

  it('solo el cierre vacía la caja y la frase', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    // Mandato 2026-10-30: el final NO cierra ni vacía la caja; la puerta de
    // abajo (silencio de 5 s) sí.
    const trasFinal = await api.ingestAsr(asr(tramoId, { texto: 'hola', final: true }))
    expect(trasFinal.box).toEqual({ texto: 'hola', abierta: true, textoPendiente: '' })
    const cerrada = await cerrarPorSilencio(api, SAMPLE_RATE)
    expect(cerrada.box).toEqual({ texto: '', abierta: false, textoPendiente: '' })
    expect(cerrada.fraseCanonica).toBe('')
    expect(cerrada.fraseParaMostrar).toBe('')
  })
})

describe('eco y barge-in — la voz de FLU nunca es fila de usuario', () => {
  it('detecta eco por sufijo y cobertura de palabras, no por caracteres', () => {
    expect(esEcoDeTts('mundo entero', 'hola mundo entero', 4)).toBe(true)
    expect(esEcoDeTts('MUNDO, entero!', 'hola mundo entero', 4)).toBe(true)
    expect(esEcoDeTts('hola mundo', 'hola mundo entero', 4)).toBe(false)
    expect(esEcoDeTts('mundo entero y algo mas', 'hola mundo entero', 4)).toBe(false)
    expect(esEcoDeTts('', 'hola mundo entero', 4)).toBe(false)
    expect(esEcoDeTts('mundo', '', 4)).toBe(false)
  })

  it('la cola que ABRE el fragmento es eco (medido 18:12:34); un prefijo corto no', () => {
    const dicho =
      'He notado que repeti la informacion sobre los ratones. Te gustaria que continuemos con la loteria o prefieres que te cuente algo mas?'
    expect(esEcoDeTts('o prefieres que te cuente algo mas esta', dicho, 4)).toBe(true)
    expect(
      esEcoDeTts('o prefieres que te cuente algo mas esta Okay flu estabamos jugando Adivina quien', dicho, 4),
    ).toBe(true)
    expect(esEcoDeTts('te cuente algo', dicho, 4), 'solo 3 palabras de la cola no es eco').toBe(false)
    expect(esEcoDeTts('pon la alarma a las siete', dicho, 4)).toBe(false)
  })

  it('el eco se cuenta y no mueve la caja; lo ajeno interrumpe y sí entra', async () => {
    const dicho = crearDicho('hola mundo entero')
    const { api, eventos } = crearEscenario({ ultimoTextoDicho: dicho.ultimoTextoDicho })
    await api.start()
    const tramoId = await abrirConVoz(api)

    const eco = await api.ingestAsr(asr(tramoId, { texto: 'mundo entero', final: true }))
    expect(eco.filas).toEqual([])
    expect(eco.box.texto).toBe('')
    expect(eco.descartes).toEqual([expect.objectContaining({ motivo: 'eco' })])
    expect(eventos.some((evento) => evento.tipo === 'barge.in')).toBe(false)

    await api.ingestAsr(asr(tramoId, { texto: 'espera', final: true }))
    const cerrada = await cerrarPorSilencio(api, SAMPLE_RATE)
    expect(cerrada.filas[0].texto).toBe('espera')
    expect(eventos).toContainEqual(
      expect.objectContaining({ tipo: 'barge.in', texto: 'espera' }),
    )
  })

  it('sin voz de FLU no hay eco ni barge-in', async () => {
    const dicho = crearDicho('hola mundo entero')
    dicho.dejaDeHablar()
    const { api, eventos } = crearEscenario({ ultimoTextoDicho: dicho.ultimoTextoDicho })
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr(asr(tramoId, { texto: 'mundo entero', final: true }))
    const estado = await cerrarPorSilencio(api, SAMPLE_RATE)
    expect(estado.filas[0].texto).toBe('mundo entero')
    expect(eventos.some((evento) => evento.tipo === 'barge.in')).toBe(false)
  })
})

describe('ASR por puerto — un motor, estados y audio local', () => {
  it('arranca un motor, empuja audio local y drena el resultado en orden', async () => {
    const asrFalso = crearAsrFalso()
    const { api, eventos } = crearEscenario({
      asr: asrFalso.asrPort,
      configuracion: {
        ...CONVERSACION_CONFIG,
        asr: { engine: 'local', lang: 'es' },
      },
    })
    const arranque = await api.start()
    expect(arranque.asr).toBe('active')
    expect(asrFalso.iniciado()).toBe(1)

    const tramoId = await abrirConVoz(api)
    expect(asrFalso.empujados).toHaveLength(1)
    asrFalso.resultado({ texto: 'hola', final: true, idioma: 'es' })
    // El drenaje procesa el final; el silencio de 5 s (puerta de abajo) cierra.
    const estado = await cerrarPorSilencio(api, SAMPLE_RATE)
    expect(estado.filas[0]).toMatchObject({ locutionId: tramoId, texto: 'hola' })
    expect(eventos).toContainEqual(
      expect.objectContaining({ tipo: 'asr.status', estado: 'active' }),
    )
    await api.stop('system')
    expect(asrFalso.detenido()).toBe(1)
  })

  it('sin motor disponible el estado es no-permission y no arranca', async () => {
    const asrFalso = crearAsrFalso(() => false)
    const { api } = crearEscenario({ asr: asrFalso.asrPort })
    const estado = await api.start()
    expect(estado.asr).toBe('no-permission')
    expect(asrFalso.iniciado()).toBe(0)
  })

  it('un watchdog cierra la locución abierta con reason watchdog', async () => {
    const asrFalso = crearAsrFalso()
    const { api } = crearEscenario({
      asr: asrFalso.asrPort,
      configuracion: {
        ...CONVERSACION_CONFIG,
        asr: { engine: 'local', lang: 'es' },
      },
    })
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr(asr(tramoId, { texto: 'hola' }))
    asrFalso.estado('watchdog')
    const estado = await api.ingestAudio(
      bloque(SAMPLE_RATE, SAMPLE_RATE * 2, VOZ()),
    )
    expect(estado.filas[0]).toMatchObject({
      texto: 'hola',
      reason: 'watchdog',
      provisional: true,
    })
  })

  it('con motor cloud no se empuja audio al puerto', async () => {
    const asrFalso = crearAsrFalso()
    const { api } = crearEscenario({
      asr: asrFalso.asrPort,
      configuracion: {
        ...CONVERSACION_CONFIG,
        asr: { engine: 'cloud', lang: 'es' },
      },
    })
    await api.start()
    await abrirConVoz(api)
    expect(asrFalso.empujados).toEqual([])
  })
})

describe('huérfanos y descartes contados', () => {
  it('un ASR sin tramo con TEXTO no inventa fila al expirar: se cuenta huérfano', async () => {
    const { api, reloj } = crearEscenario()
    await api.start()
    const antes = await api.ingestAsr(asr(UUID_A, { texto: 'viejo', final: true }))
    expect(antes.filas).toEqual([])
    expect(antes.box.abierta).toBe(false)

    reloj.avanzar(CONVERSACION_CONFIG.orphanBufferMs + 1)
    await api.ingestAsr(
      asr(UUID_B, {
        texto: 'nuevo',
        final: true,
        tramo: { inicio: 0, fin: SAMPLE_RATE, sampleRate: SAMPLE_RATE },
      }),
    )
    // Sin tramo/audio no hay locución: al stop no se inventa una fila. «viejo»
    // se cuenta como huérfano; la norma es no crear registros tras cerrar.
    const cerrada = await cerrarPorSilencio(api, SAMPLE_RATE)
    expect(cerrada.filas.map((fila) => fila.texto)).toEqual(['nuevo'])

    const detenida = await api.stop('system')
    expect(detenida.filas.map((fila) => fila.texto)).toEqual(['nuevo'])
    expect(detenida.descartes.filter((descarte) => descarte.motivo === 'huerfano')).toHaveLength(1)
  })

  it('un ASR sin tramo ni audio se retiene, no inventa fila', async () => {
    const { api } = crearEscenario()
    await api.start()
    await api.ingestAsr(asr(UUID_A, { texto: 'sin tramo', final: true }))
    expect(api.snapshot().filas).toEqual([])
    expect(api.snapshot().descartes).toEqual([])
  })
})

describe('control de escucha — solo el comando exacto sale de conversación', () => {
  it('"hago un silencio" es un turno normal: se escribe su fila', async () => {
    // El puerto REAL del producto: el detector de `audioMath` sobre la config viva.
    const config: ConfigPort = {
      ...configDePrueba(),
      esComandoDeControl: (texto) =>
        Boolean(detectListeningControl(texto, FLU_CONFIG.voiceCommands)),
    }
    const { api } = crearEscenario({ config })
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr(asr(tramoId, { texto: 'hago un silencio', final: true }))
    const cerrado = await cerrarPorSilencio(api, SAMPLE_RATE)
    // No se descarta como control: la frase pasa a conversación con su fila.
    expect(cerrado.descartes.filter((descarte) => descarte.motivo === 'control')).toEqual([])
    expect(cerrado.filas.map((fila) => fila.texto)).toEqual(['hago un silencio'])
  })

  it('el parcial del comando no se publica: el final lo cierra como control', async () => {
    // MEDIDO 2026-11-12 18:25:32: la línea abierta tenía el parcial «cer»; el
    // final «cerrando escucha» llegó 409 ms después del stop. Antes, el final
    // se descartaba sin tocar la línea y el stop publicaba «cer» como fila.
    const config: ConfigPort = {
      ...configDePrueba(),
      esComandoDeControl: (texto) =>
        Boolean(detectListeningControl(texto, FLU_CONFIG.voiceCommands)),
    }
    const { api } = crearEscenario({ config })
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr(asr(tramoId, { texto: 'cer' }))
    expect(api.snapshot().locucionAbierta?.texto).toBe('cer')
    const cerrado = await api.ingestAsr(
      asr(tramoId, { texto: 'cerrando escucha', final: true }),
    )
    // La locución del comando se cierra descartada como control: ni fila ni
    // línea abierta que el stop pueda publicar.
    expect(cerrado.locucionAbierta).toBe(null)
    expect(cerrado.filas.map((fila) => fila.texto)).toEqual([])
    expect(cerrado.descartes.filter((descarte) => descarte.motivo === 'control')).toHaveLength(1)
    const detenida = await api.stop('user')
    expect(detenida.filas.map((fila) => fila.texto)).toEqual([])
  })
})

describe('eventos — los 6 del plan se emiten desde el flujo real', () => {
  it('box, cierre, fila, hablante y estado del ASR salen en una sesión', async () => {
    const { api, eventos } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr(asr(tramoId, { texto: 'hola', voz: { hablante: 'Hablante 1' } }))
    await api.ingestAsr(asr(tramoId, { texto: 'hola', final: true }))
    await api.stop('system')
    const tipos = new Set(eventos.map((evento) => evento.tipo))
    expect(tipos).toEqual(
      new Set([
        'box.updated',
        'locution.closed',
        'row.committed',
        'speaker.labeled',
        'asr.status',
      ]),
    )
  })
})

describe('cola — un texto de tramo nuevo abre su locución al cerrar la anterior', () => {
  it('la caja pinta la frase nueva sin esperar al stop', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoA = await abrirConVoz(api, 0)
    await api.ingestAsr(asr(tramoA, { texto: 'uno' }))

    // B es un tramo REAL: A cierra por silencio y B abre con su propio audio.
    await cerrarPorSilencio(api, SAMPLE_RATE)
    const inicioB = SAMPLE_RATE * 6
    const estadoB = await api.ingestAudio(
      bloque(inicioB, inicioB + SAMPLE_RATE, VOZ()),
    )
    const tramoB = estadoB.tramoAudio?.tramoId
    if (!tramoB) throw new Error('sin tramo B')
    const estado = await api.ingestAsr(asr(tramoB, { texto: 'dos', final: true }))
    expect(
      estado.box.texto,
      JSON.stringify({
        abierta: estado.locucionAbierta,
        tramo: estado.tramoAudio,
        descartes: estado.descartes,
        filas: estado.filas.map((fila) => fila.texto),
      }),
    ).toBe('dos')

    const detenida = await api.stop('system')
    expect(detenida.filas.map((fila) => fila.texto)).toEqual(['uno', 'dos'])
  })
})

describe('stop — un pendiente con texto y sin tramo no inventa fila', () => {
  it('cuenta el huérfano y deja solo la locución con audio', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoA = await abrirConVoz(api, 0)
    await api.ingestAsr(asr(tramoA, { texto: 'uno' }))
    await cerrarPorSilencio(api, SAMPLE_RATE)

    // Llega texto de un tramo que el registro ya no resuelve, sin locución
    // abierta: no hay audio que lo sostenga y el stop lo cuenta como huérfano.
    await api.ingestAsr(asr(UUID_B, { texto: 'dos', final: true }))

    const detenida = await api.stop('system')
    expect(detenida.filas.map((fila) => fila.texto)).toEqual(['uno'])
    expect(detenida.descartes.filter((descarte) => descarte.motivo === 'huerfano')).toHaveLength(1)
  })
})

describe('stop — un pendiente con texto distinto no se pierde', () => {
  it('commitea el pendiente anterior a la última fila', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoA = await abrirConVoz(api, 0)
    await api.ingestAsr(asr(tramoA, { texto: 'uno' }))
    await api.ingestAsr(
      asr(UUID_C, {
        texto: 'viejo',
        tramo: { inicio: 0, fin: 8000, sampleRate: SAMPLE_RATE },
      }),
    )

    const detenida = await api.stop('system')
    expect(detenida.filas.map((fila) => fila.texto)).toEqual(['uno', 'viejo'])
    expect(detenida.descartes.filter((descarte) => descarte.locutionId === UUID_C)).toEqual([])
  })

  it('commitea el pendiente cuyo fin es IGUAL al de la última fila', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoA = await abrirConVoz(api, 0)
    await api.ingestAsr(asr(tramoA, { texto: 'uno' }))
    await api.ingestAsr(
      asr(UUID_D, {
        texto: 'igual',
        tramo: { inicio: 0, fin: SAMPLE_RATE, sampleRate: SAMPLE_RATE },
      }),
    )

    const detenida = await api.stop('system')
    expect(detenida.filas.map((fila) => fila.texto)).toEqual(['uno', 'igual'])
    expect(detenida.descartes.filter((descarte) => descarte.locutionId === UUID_D)).toEqual([])
  })

  it('conserva el pendiente cuyo fin es POSTERIOR al de la última fila', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoA = await abrirConVoz(api, 0)
    await api.ingestAsr(asr(tramoA, { texto: 'uno' }))
    await api.ingestAsr(
      asr(UUID_E, {
        texto: 'nuevo',
        tramo: { inicio: SAMPLE_RATE, fin: SAMPLE_RATE * 2, sampleRate: SAMPLE_RATE },
      }),
    )

    const detenida = await api.stop('system')
    expect(detenida.filas.map((fila) => fila.texto)).toEqual(['uno', 'nuevo'])
  })
})

describe('stop — las parciales de la MISMA frase se funden en UNA fila', () => {
  it('las hipótesis crecientes no crean una fila por parcial', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api, 0)
    const parciales = [
      'dice este cambio a la modalidad 40',
      'dice este cambio a la modalidad 40 del IMSS',
      'dice este cambio a la modalidad 40 del IMSS pensionados',
      'dice este cambio a la modalidad 40 del IMSS pensionados salió en el diario oficial El día 22',
      'dice este cambio a la modalidad 40 del IMSS pensionados salió en el diario oficial El día 22 a partir del día 22',
      'dice este cambio a la modalidad 40 del IMSS pensionados salió en el diario oficial El día 22 a partir del día 22 es el jueves',
      'dice este cambio a la modalidad 40 del IMSS pensionados salió en el diario oficial El día 22 a partir del día 22 es el jueves no este',
      'dice este cambio a la modalidad 40 del IMSS pensionados salió en el diario oficial El día 22 a partir del día 22 es el jueves no este ya no se van a poder',
    ]
    for (const texto of parciales) {
      await api.ingestAsr(asr(tramoId, { texto, final: true }))
    }
    // La caja sigue la hipótesis completa, no el primer trozo.
    expect(api.snapshot().box.texto).toBe(parciales[parciales.length - 1])

    await cerrarPorSilencio(api, SAMPLE_RATE)
    await api.ingestAsr(asr(UUID_B, { texto: 'Sí pero te van a poner ese pero', final: true }))

    const detenida = await api.stop('system')
    // La frase parcial con audio real es UNA fila. El texto sin tramo no crea
    // una segunda fila después del stop: se cuenta huérfano.
    expect(detenida.filas.map((fila) => fila.texto)).toEqual([parciales[parciales.length - 1]])
    expect(detenida.descartes.filter((descarte) => descarte.motivo === 'huerfano')).toHaveLength(1)
  })
})

describe('frontera — una frase continua no se cierra por el hueco de índices', () => {
  it('cruza tramos con abierta.fin viejo y queda en UNA fila sin causa frontera', async () => {
    const { api, eventos } = crearEscenario()
    await api.start()
    const tramoA = await abrirConVoz(api, 0)
    await api.ingestAsr(asr(tramoA, { texto: 'esto es' }))

    // Pausa CORTA (900 ms): el VAD corta el tramo A pero NO hay silencio de
    // cierre. El tramo B arranca muy lejos en índices: el hueco de índices
    // contra `abierta.fin` (viejo) supera 5 s sin que exista pausa real.
    await api.ingestAudio(bloque(SAMPLE_RATE, SAMPLE_RATE + 14_400, SILENCIO(900)))
    const inicioB = SAMPLE_RATE * 12.5
    const estadoB = await api.ingestAudio(
      bloque(inicioB, inicioB + SAMPLE_RATE, VOZ()),
    )
    const tramoB = estadoB.tramoAudio?.tramoId
    if (!tramoB) throw new Error('sin tramo B')

    const estado = await api.ingestAsr(
      asr(tramoB, { texto: 'esto es una prueba', final: true }),
    )
    // La frase sigue: NO se cerró A a mitad de frase.
    expect(estado.filas).toEqual([])
    expect(estado.locucionAbierta?.locutionId).toBe(tramoA)
    expect(
      eventos.filter(
        (evento) => evento.tipo === 'locution.closed' && evento.causa === 'frontera',
      ),
    ).toEqual([])

    const cerrada = await cerrarPorSilencio(api, inicioB + SAMPLE_RATE)
    expect(cerrada.filas.map((fila) => fila.texto)).toEqual(['esto es una prueba'])
  })
})

describe('cola - pendientes con su tramo real y locución vacía', () => {
  it('el pendiente conserva su ventana de audio aunque el registro expire', async () => {
    const { api, reloj } = crearEscenario()
    await api.start()
    const tramoA = await abrirConVoz(api, 0)
    await api.ingestAsr(asr(tramoA, { texto: 'uno' }))
    // Pausa corta: corta A y abre B, sin cerrar la locución de A.
    await api.ingestAudio(bloque(SAMPLE_RATE, SAMPLE_RATE + 14_400, SILENCIO(900)))
    const inicioB = SAMPLE_RATE * 2
    const estadoB = await api.ingestAudio(
      bloque(inicioB, inicioB + SAMPLE_RATE, VOZ()),
    )
    const tramoB = estadoB.tramoAudio?.tramoId
    if (!tramoB) throw new Error('sin tramo B')
    await api.ingestAsr(asr(tramoB, { texto: 'dos', final: true }))

    // El registro de tramos expira a los 8 s: el pendiente NO debe perder su
    // ventana real ni convertirse en una fila {inicio:0,fin:1} al stop.
    reloj.avanzar(10_000)
    const detenida = await api.stop('system')
    const filaDos = detenida.filas.find((fila) => fila.texto === 'dos')
    expect(filaDos?.tramo).toEqual({
      inicio: inicioB,
      fin: inicioB + SAMPLE_RATE,
      sampleRate: SAMPLE_RATE,
    })
  })

  it('el primer texto llena el caparazón vacío y no se descarta', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoA = await abrirConVoz(api, 0)
    // El VAD corta el caparazón vacío y el tramo B abre con su audio.
    await api.ingestAudio(bloque(SAMPLE_RATE, SAMPLE_RATE + 14_400, SILENCIO(900)))
    const inicioB = SAMPLE_RATE * 2
    const estadoB = await api.ingestAudio(
      bloque(inicioB, inicioB + SAMPLE_RATE, VOZ()),
    )
    const tramoB = estadoB.tramoAudio?.tramoId
    if (!tramoB) throw new Error('sin tramo B')

    const estado = await api.ingestAsr(asr(tramoB, { texto: 'dos', final: true }))
    expect(estado.locucionAbierta?.locutionId).toBe(tramoA)
    expect(estado.locucionAbierta?.texto).toBe('dos')
    expect(estado.descartes.some((descarte) => descarte.motivo === 'sinTexto')).toBe(false)
  })
})

describe('fila nueva — no pierde palabras de una frase nueva', () => {
  it('una frase nueva que empieza como la anterior conserva TODAS sus palabras', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoA = await abrirConVoz(api, 0)
    await api.ingestAsr(asr(tramoA, { texto: 'uno', final: true }))
    await cerrarPorSilencio(api, SAMPLE_RATE)
    const inicioB = SAMPLE_RATE * 6
    const estadoB = await api.ingestAudio(
      bloque(inicioB, inicioB + SAMPLE_RATE, VOZ()),
    )
    const tramoB = estadoB.tramoAudio?.tramoId
    if (!tramoB) throw new Error('sin tramo B')
    const estado = await api.ingestAsr(
      asr(tramoB, { texto: 'uno dos', final: true }),
    )
    // Es otra locución y otro audio: «uno dos» es una frase NUEVA, no un
    // duplicado de «uno». Recortarla perdería una palabra (regla 12).
    expect(estado.filas.map((fila) => fila.texto)).toEqual(['uno'])
    expect(estado.locucionAbierta?.texto).toBe('uno dos')
  })
})

describe('el final NO es puerta de cierre', () => {
  it('un final de otra frase queda pendiente: la anterior sigue abierta hasta la frontera', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoA = await abrirConVoz(api, 0)
    await api.ingestAsr(asr(tramoA, { texto: 'uno', final: true }))
    // Pausa corta: el VAD corta A y B abre en OTRO tramo.
    await api.ingestAudio(bloque(SAMPLE_RATE, SAMPLE_RATE + 14_400, SILENCIO(900)))
    const inicioB = SAMPLE_RATE * 2
    const estadoB = await api.ingestAudio(
      bloque(inicioB, inicioB + SAMPLE_RATE, VOZ()),
    )
    const tramoB = estadoB.tramoAudio?.tramoId
    if (!tramoB) throw new Error('sin tramo B')

    // El final de B NO cierra: su texto es ajeno y queda pendiente; A sigue
    // abierta con su frase (la única puerta de cierre es la frontera medida).
    const estado = await api.ingestAsr(
      asr(tramoB, { texto: 'dos', final: true }),
    )
    expect(estado.filas.map((fila) => fila.texto)).toEqual([])
    expect(estado.locucionAbierta?.texto).toBe('uno')

    // El silencio medido (puerta de abajo) cierra A y SU fila sale UNA vez. La
    // frase de B llegó ANTES del silencio: es del MISMO bloque y se funde en la
    // fila que cierra (regla 3: la caja solo se parte por tiempo o cambio de
    // hablante; defecto fd148fe7 — el texto se partía sin frontera real).
    const cerrado = await cerrarPorSilencio(api, inicioB + SAMPLE_RATE)
    expect(cerrado.filas.map((fila) => fila.texto)).toEqual(['uno dos'])
    expect(cerrado.locucionAbierta).toBeNull()
  })
})

describe('identidad - duración de la VOZ medida', () => {
  it('la duración de identidad cuenta VOZ real, no la longitud de la captura', () => {
    const unSegundoDeVoz = new Float32Array(SAMPLE_RATE)
    for (let i = 0; i < unSegundoDeVoz.length; i += 1) {
      unSegundoDeVoz[i] = Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) * 0.5
    }
    expect(vozMsDeMuestras(unSegundoDeVoz, SAMPLE_RATE)).toBe(1000)
    // 1 s de captura SIN voz no son 1 s de evidencia de identidad.
    expect(vozMsDeMuestras(new Float32Array(SAMPLE_RATE), SAMPLE_RATE)).toBe(0)
    expect(vozMsDeMuestras(new Float32Array(0), SAMPLE_RATE)).toBe(0)
  })
})

// ============================================================
// RESPALDO LOCAL POR TRAMO (docs/CONTRATO-ASR-LOCAL.md)
// ------------------------------------------------------------
// Chrome sigue siendo el transcriptor primario; Whisper local es un respaldo
// POR TRAMO que se espera ANTES del commit. La fila se construye UNA vez con
// el texto aceptado y `origen: 'local'`; si la puerta no entrega, Chrome (o
// `sinTexto`). El transcriptor es un doble: la puerta real se mide en
// `voiceGateRealAudio.test.ts`.
// ============================================================

/** PCM con VOZ real (seno sobre el piso del VAD) para que `vozMs` no sea 0. */
function muestrasHabladas(muestras: number): Float32Array {
  const out = new Float32Array(muestras)
  for (let i = 0; i < muestras; i += 1) {
    out[i] = Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) * 0.5
  }
  return out
}

/** Bloque con voz REAL: PCM senoidal + la medida VAD que lo declara voz. */
function bloqueHablado(inicio: number, fin: number): BloqueAudio {
  return {
    muestras: muestrasHabladas(fin - inicio),
    sampleRate: SAMPLE_RATE,
    inicio,
    fin,
    medida: VOZ(),
  }
}

/** Config con el respaldo local habilitado (mismos valores que el dueño). */
function configConRespaldo(): ConfigPort {
  return {
    ...configDePrueba(),
    localFinal: () => ({
      enabled: true,
      minPalabras: 4,
      minPalabrasPorSegundo: 1,
      minVozMs: 350,
      minAudioSegundos: 3,
    }),
  }
}

/** Transcriptor doble que registra lo recibido y devuelve lo declarado. */
function crearTranscriptorFalso(
  responder: (entrada: EntradaRespaldoLocal) => Promise<ResultadoRespaldoLocal>,
) {
  const llamadas: EntradaRespaldoLocal[] = []
  const transcriptor: TranscriptorTramoPort = {
    preload: () => undefined,
    transcribir: async (entrada) => {
      llamadas.push(entrada)
      return responder(entrada)
    },
  }
  return { transcriptor, llamadas }
}

describe('respaldo local por tramo — se espera ANTES del commit y no abre otra fila', () => {
  it('Chrome sin final + local aceptado: UNA fila con el texto local, marcada `local`', async () => {
    const { transcriptor, llamadas } = crearTranscriptorFalso(async () => {
      // Local TARDA: el cierre debe esperarlo antes de construir la fila.
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { texto: 'la mujer habla del jardín', descarte: null }
    })
    const { api, eventos } = crearEscenario({ config: configConRespaldo(), transcriptor })
    await api.start()
    // 3 s EXACTOS: el borde del mínimo del disparador SÍ invoca el local.
    await api.ingestAudio(bloqueHablado(0, 3 * SAMPLE_RATE))
    const cerrado = await cerrarPorSilencio(api, 3 * SAMPLE_RATE)

    expect(cerrado.filas).toHaveLength(1)
    expect(cerrado.filas[0]).toMatchObject({
      texto: 'la mujer habla del jardín',
      origen: 'local',
    })
    // La fila se commitea UNA vez, con el texto definitivo (sin segunda escritura).
    expect(eventos.filter((evento) => evento.tipo === 'row.committed')).toHaveLength(1)
    // El transcriptor recibió el tramo CERRADO con su evidencia medida.
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].audioSegundos).toBeCloseTo(3, 1)
    expect(llamadas[0].vozMs).toBeGreaterThan(0)
    expect(typeof llamadas[0].speechLikeMs).toBe('number')
    expect(llamadas[0].muestras.length).toBeGreaterThan(0)
  })

  it('Chrome con rendimiento implausible (0,625 palabras/s) dispara local aunque haya texto', async () => {
    // Espejo del caso medido b6d82bca c7013264: 12 palabras en 35,6 s (0,34
    // palabras/s). Aquí 5 palabras en 8 s: supera `minPalabras` y cae por el
    // ratio (0,625 < 1,0), así el caso mide SOLO el disparador de rendimiento.
    const { transcriptor, llamadas } = crearTranscriptorFalso(async () => ({
      texto: 'la mujer cuenta lo que pasó ayer',
      descarte: null,
    }))
    const { api } = crearEscenario({ config: configConRespaldo(), transcriptor })
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAudio(bloqueHablado(SAMPLE_RATE, 9 * SAMPLE_RATE))
    await api.ingestAsr(asr(tramoId, { texto: 'esto es lo que pasó', final: true }))
    const cerrado = await cerrarPorSilencio(api, 9 * SAMPLE_RATE)

    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].audioSegundos).toBeCloseTo(9, 1)
    expect(cerrado.filas).toHaveLength(1)
    expect(cerrado.filas[0]).toMatchObject({
      texto: 'la mujer cuenta lo que pasó ayer',
      origen: 'local',
    })
  })

  it('sin VOZ medida el disparador NO invoca Whisper (el hueco no paga el modelo)', async () => {
    // Espejo del hueco 67–95 s de b6d82bca: tramo con "voz" VAD pero PCM sin
    // voz real (vozMs=0 < minVozMs). La puerta lo rechazaría DESPUÉS de
    // transcribir; el disparador debe cortarlo ANTES: el modelo no se paga.
    const { transcriptor, llamadas } = crearTranscriptorFalso(async () => ({
      texto: 'texto que nunca debe pedirse',
      descarte: null,
    }))
    const { api } = crearEscenario({ config: configConRespaldo(), transcriptor })
    await api.start()
    // 4 s con "voz" VAD pero PCM mudo: por encima del mínimo de AUDIO, así el
    // caso mide SOLO la regla de voz (con 1 s cortaría por 'audio-corto').
    await api.ingestAudio(bloque(0, 4 * SAMPLE_RATE, VOZ()))
    const cerrado = await cerrarPorSilencio(api, 4 * SAMPLE_RATE)

    expect(llamadas).toHaveLength(0)
    expect(cerrado.filas).toEqual([])
    expect(cerrado.descartes.filter((descarte) => descarte.motivo === 'sinTexto')).toHaveLength(1)
  })

  it('un tramo de 1,09 s NO invoca el local: paga el encoder fijo sin ser ventana', async () => {
    // MEDIDO (§5-quinquies): una ventana de 1,09 s del audio real b6d82bca
    // tardó 9,3–21,7 s (secuencial): paga el encoder de 30 s + prompt. El
    // disparador exige `minAudioSegundos` ADEMÁS de `minVozMs`; con voz REAL
    // en el PCM el caso mide SOLO el mínimo de audio.
    const { transcriptor, llamadas } = crearTranscriptorFalso(async () => ({
      texto: 'texto que nunca debe pedirse',
      descarte: null,
    }))
    const { api } = crearEscenario({ config: configConRespaldo(), transcriptor })
    await api.start()
    const fin = Math.round(1.09 * SAMPLE_RATE)
    await api.ingestAudio(bloqueHablado(0, fin))
    const cerrado = await cerrarPorSilencio(api, fin)

    expect(llamadas).toHaveLength(0)
    expect(cerrado.filas).toEqual([])
    expect(cerrado.descartes.filter((descarte) => descarte.motivo === 'sinTexto')).toHaveLength(1)
  })

  it('un comando de control de Chrome NO se sustituye: el disparador no invoca local', async () => {
    // Dueño de la compuerta de comandos: `ConfigPort.esComandoDeControl`. Un
    // comando de Chrome se queda como comando; el respaldo no lo pisa.
    const { transcriptor, llamadas } = crearTranscriptorFalso(async () => ({
      texto: 'texto local que no debe usarse',
      descarte: null,
    }))
    const config: ConfigPort = {
      ...configConRespaldo(),
      esComandoDeControl: (texto) => /sube el volumen/i.test(texto),
    }
    const { api } = crearEscenario({ config, transcriptor })
    await api.start()
    // Voz REAL y ≥ mínimo de audio: sin ellos el disparador cortaría por
    // 'sin-voz'/'audio-corto' y el caso no mediría la compuerta de comandos.
    const estado = await api.ingestAudio(bloqueHablado(0, 4 * SAMPLE_RATE))
    const tramoId = estado.locucionAbierta?.locutionId
    if (!tramoId) throw new Error('el audio con voz no abrio locucion')
    await api.ingestAsr(asr(tramoId, { texto: 'sube el volumen', final: true }))
    const cerrado = await cerrarPorSilencio(api, 4 * SAMPLE_RATE)

    expect(llamadas).toHaveLength(0)
    // Un comando de control no es conversación: cierra como descarte 'control',
    // sin fila (mismo dueño que la compuerta de comandos del cierre).
    expect(cerrado.filas).toEqual([])
    expect(cerrado.descartes.filter((descarte) => descarte.motivo === 'control')).toHaveLength(1)
  })

  it('local MÁS CORTO que Chrome: se conserva Chrome (el parcial no se come)', async () => {
    // El disparador corre (5 palabras en 9 s = 0,55 palabras/s < 1,0), pero el
    // respaldo trae menos contenido que el final de Chrome: sustituir acortaría
    // la fila. Regla: local solo reemplaza si no pierde palabras.
    const { transcriptor, llamadas } = crearTranscriptorFalso(async () => ({
      texto: 'la mujer',
      descarte: null,
    }))
    const { api } = crearEscenario({ config: configConRespaldo(), transcriptor })
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAudio(bloqueHablado(SAMPLE_RATE, 9 * SAMPLE_RATE))
    await api.ingestAsr(asr(tramoId, { texto: 'esto es lo que pasó', final: true }))
    const cerrado = await cerrarPorSilencio(api, 9 * SAMPLE_RATE)

    expect(llamadas).toHaveLength(1)
    expect(cerrado.filas).toHaveLength(1)
    expect(cerrado.filas[0]?.texto).toBe('esto es lo que pasó')
    expect(cerrado.filas[0] && 'origen' in cerrado.filas[0]).toBe(false)
  })

  it('Chrome con texto plausible: local NO corre (sin coste extra)', async () => {
    const { transcriptor, llamadas } = crearTranscriptorFalso(async () => ({
      texto: 'texto local que no debe usarse',
      descarte: null,
    }))
    const { api } = crearEscenario({ config: configConRespaldo(), transcriptor })
    await api.start()
    const tramoId = await abrirConVoz(api)
    // Voz REAL hasta 4 s: el caso mide 'no-hace-falta', no el mínimo de audio.
    await api.ingestAudio(bloqueHablado(SAMPLE_RATE, 4 * SAMPLE_RATE))
    await api.ingestAsr(asr(tramoId, { texto: 'hola mundo entero amigo', final: true }))
    const cerrado = await cerrarPorSilencio(api, 4 * SAMPLE_RATE)

    expect(llamadas).toHaveLength(0)
    expect(cerrado.filas).toHaveLength(1)
    expect(cerrado.filas[0]?.texto).toBe('hola mundo entero amigo')
    // Una fila de Chrome conserva la forma de siempre: sin marca de origen.
    expect(cerrado.filas[0] && 'origen' in cerrado.filas[0]).toBe(false)
  })

  it('Chrome sin texto y local rechazado por la puerta: no se escribe fila', async () => {
    const { transcriptor, llamadas } = crearTranscriptorFalso(async () => ({
      texto: '',
      descarte: 'sin-voz',
    }))
    const { api, eventos } = crearEscenario({ config: configConRespaldo(), transcriptor })
    await api.start()
    // 4 s de voz REAL: el disparador SÍ pide el local (y la puerta lo rechaza).
    await api.ingestAudio(bloqueHablado(0, 4 * SAMPLE_RATE))
    const cerrado = await cerrarPorSilencio(api, 4 * SAMPLE_RATE)

    expect(llamadas).toHaveLength(1)
    expect(cerrado.filas).toEqual([])
    expect(cerrado.descartes.filter((descarte) => descarte.motivo === 'sinTexto')).toHaveLength(1)
    expect(eventos.filter((evento) => evento.tipo === 'row.committed')).toHaveLength(0)
  })

  it('un fallo del transcriptor no rompe el cierre: queda el texto de Chrome', async () => {
    const { transcriptor, llamadas } = crearTranscriptorFalso(async () => {
      throw new Error('modelo no disponible')
    })
    const { api } = crearEscenario({ config: configConRespaldo(), transcriptor })
    await api.start()
    // Voz REAL y ≥ mínimo de audio: el disparador pasa ANTES de transcribir;
    // con PCM mudo o 1 s no llegaría al transcriptor y no mediría el fallo.
    const estado = await api.ingestAudio(bloqueHablado(0, 4 * SAMPLE_RATE))
    const tramoId = estado.locucionAbierta?.locutionId
    if (!tramoId) throw new Error('el audio con voz no abrio locucion')
    await api.ingestAsr(asr(tramoId, { texto: 'hola', final: true }))
    const cerrado = await cerrarPorSilencio(api, 4 * SAMPLE_RATE)

    expect(llamadas).toHaveLength(1)
    expect(cerrado.filas).toHaveLength(1)
    expect(cerrado.filas[0]?.texto).toBe('hola')
    expect(cerrado.filas[0] && 'origen' in cerrado.filas[0]).toBe(false)
  })

  it('sin transcriptor inyectado el modulo cierra solo con Chrome (compatibilidad)', async () => {
    const { api } = crearEscenario({ config: configConRespaldo() })
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr(asr(tramoId, { texto: 'hola', final: true }))
    const cerrado = await cerrarPorSilencio(api, SAMPLE_RATE)
    expect(cerrado.filas).toHaveLength(1)
    expect(cerrado.filas[0]?.texto).toBe('hola')
  })
})

// ============================================================
// TOPE DE LOCUCIÓN (`maxLocutionMs`)
// ------------------------------------------------------------
// La frase que sigue ganando voz se PARTE a los 12 s: el respaldo local
// transcribe VENTANAS (contrato ASR local, §5-quinquies) y una locución de
// 35 s no es una ventana medible. La partición no puede perder ni duplicar
// texto: el tope se evalúa DESPUÉS del drenaje (el primer resultado posterior
// entra en la fila que cierra) y la ventana nueva nace con `partidaDeVoz` para
// recortar la línea acumulada de Chrome que re-incluye lo ya commiteado.
// ============================================================
describe('tope de locución — la fila se parte a maxLocutionMs sin perder texto', () => {
  /** Ingiere VOZ en bloques de 1 s, de `desdeSegundos` a `hastaSegundos`. */
  async function hablar(
    api: ConversacionApi,
    desdeSegundos: number,
    hastaSegundos: number,
  ): Promise<void> {
    for (let s = desdeSegundos; s < hastaSegundos; s += 1) {
      await api.ingestAudio(bloque(s * SAMPLE_RATE, (s + 1) * SAMPLE_RATE, VOZ()))
    }
  }

  it('12 s de voz continua: dos filas CONTIGUAS con todo el texto, sin duplicar', async () => {
    const asrFalso = crearAsrFalso()
    const { api, eventos } = crearEscenario({
      asr: asrFalso.asrPort,
      configuracion: { ...CONVERSACION_CONFIG, asr: { engine: 'local', lang: 'es' } },
    })
    await api.start()

    await hablar(api, 0, 1)
    asrFalso.resultado({ texto: 'uno dos tres', final: false, idioma: 'es' })
    await hablar(api, 1, 6)
    asrFalso.resultado({ texto: 'uno dos tres cuatro cinco', final: false, idioma: 'es' })
    await hablar(api, 6, 12)
    // El resultado del BORDE se empuja ANTES del bloque que dispara el tope: al
    // entrar ese bloque se drena (la locución aún vive) y gana su fila. Cerrar
    // al FINAL del bloque lo perdía como huérfano (sin tramo ni locución vivos).
    asrFalso.resultado({
      texto: 'uno dos tres cuatro cinco seis siete',
      final: false,
      idioma: 'es',
    })
    // Bloque 12→13 s: drena el borde y, con 12 s medidos, parte la locución.
    await hablar(api, 12, 13)
    asrFalso.resultado({
      texto: 'uno dos tres cuatro cinco seis siete ocho nueve',
      final: false,
      idioma: 'es',
    })
    await hablar(api, 13, 23)
    // El cierre de la sesión no es el tope: la ventana B mide 11 s y cierra por
    // la puerta de abajo (silencio), no por duración.
    const cerrado = await cerrarPorSilencio(api, 23 * SAMPLE_RATE)

    expect(cerrado.filas.map((fila) => fila.texto)).toEqual([
      'uno dos tres cuatro cinco seis siete',
      'ocho nueve',
    ])
    // Ventanas CONTIGUAS: A termina exactamente en el tope y B arranca ahí. La
    // unión de textos es la frase completa: ni una palabra perdida ni repetida.
    expect(cerrado.filas[0]?.tramo.fin).toBe(12 * SAMPLE_RATE)
    expect(cerrado.filas[1]?.tramo.inicio).toBe(12 * SAMPLE_RATE)
    expect(cerrado.filas[0]?.tramo.fin).toBe(cerrado.filas[1]?.tramo.inicio)
    expect(`${cerrado.filas[0]?.texto} ${cerrado.filas[1]?.texto}`).toBe(
      'uno dos tres cuatro cinco seis siete ocho nueve',
    )
    // La causa la declara la frontera: el corte por duración y el silencio real.
    expect(
      eventos
        .filter((evento) => evento.tipo === 'locution.closed')
        .map((evento) => evento.causa),
    ).toEqual(['maximo', 'silencio'])
    // Nada de lo dicho cayó en un descarte de texto.
    expect(
      cerrado.descartes.filter((descarte) =>
        ['huerfano', 'turnoYaEscrito', 'sinTexto'].includes(descarte.motivo),
      ),
    ).toEqual([])
  })

  it('el tope sale de la configuracion inyectada, no de un literal', async () => {
    const { api } = crearEscenario({
      configuracion: { ...CONVERSACION_CONFIG, maxLocutionMs: 3000 },
    })
    await api.start()
    await hablar(api, 0, 1)
    await api.ingestAsr(asr(await abrirConVoz(api, SAMPLE_RATE), { texto: 'uno dos' }))
    await hablar(api, 2, 4)
    const cerrado = await api.stop('user')
    expect(cerrado.filas).toHaveLength(1)
    expect(cerrado.filas[0]?.texto).toBe('uno dos')
    expect(cerrado.filas[0]?.tramo.fin).toBe(3 * SAMPLE_RATE)
  })
})
