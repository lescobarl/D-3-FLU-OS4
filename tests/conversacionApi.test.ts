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
import type {
  AsrPort,
  ConfigPort,
  EstadoAsr,
  MedidaVad,
  MotivoCierre,
  OpcionesAsr,
  ResultadoAsr,
} from '../src/voice/conversation/ports'

const SAMPLE_RATE = 16000
const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'

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
  semillaEtiqueta: () => 'Hablante 1',
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
    expect(estado.box).toEqual({ texto: '', abierta: false })
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

  it('el final del mismo tramo cierra UNA fila con el texto CONFIRMADO', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr(asr(tramoId, { texto: 'hola mundo entero' }))
    await api.ingestAsr(asr(tramoId, { texto: 'hola mundo', final: true }))
    // Regla E: el final es la HIPÓTESIS CONFIRMADA y sustituye la línea
    // acumulada (no se conserva una versión más larga con ruido). El silencio
    // (puerta de abajo) cierra UNA fila.
    const estado = await cerrarPorSilencio(api, SAMPLE_RATE)
    expect(estado.filas).toHaveLength(1)
    expect(estado.filas[0]).toMatchObject({
      locutionId: tramoId,
      texto: 'hola mundo',
      provisional: false,
    })
    expect(estado.box).toEqual({ texto: '', abierta: false })
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
    const nombrada = api.registerName({ nombre: 'Ana' })
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
    expect(otra.filas[1].etiqueta).toBe('Hablante 1')
    expect(otra.filas[1].etiqueta).not.toBe('Ana')
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
    const pendiente = api.registerName({ nombre: 'Ana' })
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

  it('el nombre ? se rechaza y nunca llega a una fila', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoId = await abrirConVoz(api)
    await api.ingestAsr(asr(tramoId, { texto: 'hola', voz: { vozId: 'A' } }))
    expect(() => api.registerName({ nombre: '?' })).toThrow(/nombre \?/)
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
    expect(trasFinal.box).toEqual({ texto: 'hola', abierta: true })
    const cerrada = await cerrarPorSilencio(api, SAMPLE_RATE)
    expect(cerrada.box).toEqual({ texto: '', abierta: false })
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
  it('un ASR sin tramo con TEXTO no se pierde al expirar', async () => {
    const { api, reloj } = crearEscenario()
    await api.start()
    const antes = await api.ingestAsr(asr(UUID_A, { texto: 'viejo', final: true }))
    expect(antes.filas).toEqual([])
    expect(antes.box.abierta).toBe(false)

    reloj.avanzar(CONVERSACION_CONFIG.orphanBufferMs + 1)
    const despues = await api.ingestAsr(
      asr(UUID_B, {
        texto: 'nuevo',
        final: true,
        tramo: { inicio: 0, fin: SAMPLE_RATE, sampleRate: SAMPLE_RATE },
      }),
    )
    // El pendiente con texto NO se tira. Sin tramo no se inventa durante la
    // sesión: "nuevo" (con tramo) abre primero; "viejo" espera y sale al stop.
    const cerrada = await cerrarPorSilencio(api, SAMPLE_RATE)
    expect(cerrada.filas.map((fila) => fila.texto)).toEqual(['nuevo'])
    expect(despues.descartes.filter((descarte) => descarte.motivo === 'huerfano')).toEqual([])

    const detenida = await api.stop('system')
    expect(detenida.filas.map((fila) => fila.texto)).toEqual(['nuevo', 'viejo'])
    expect(detenida.descartes.filter((descarte) => descarte.motivo === 'huerfano')).toEqual([])
  })

  it('un ASR sin tramo ni audio se retiene, no inventa fila', async () => {
    const { api } = crearEscenario()
    await api.start()
    await api.ingestAsr(asr(UUID_A, { texto: 'sin tramo', final: true }))
    expect(api.snapshot().filas).toEqual([])
    expect(api.snapshot().descartes).toEqual([])
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

describe('stop — un pendiente con texto y sin tramo no se pierde', () => {
  it('commitea el texto pendiente al parar', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoA = await abrirConVoz(api, 0)
    await api.ingestAsr(asr(tramoA, { texto: 'uno' }))
    await cerrarPorSilencio(api, SAMPLE_RATE)

    // Llega texto de un tramo que el registro ya no resuelve, sin locución
    // abierta: hoy queda pendiente y el stop lo descarta como huérfano.
    await api.ingestAsr(asr(UUID_B, { texto: 'dos', final: true }))

    const detenida = await api.stop('system')
    expect(detenida.filas.map((fila) => fila.texto)).toEqual(['uno', 'dos'])
    expect(detenida.descartes.filter((descarte) => descarte.motivo === 'huerfano')).toEqual([])
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
    expect(detenida.filas.map((fila) => fila.texto)).toEqual([
      parciales[parciales.length - 1],
      'Sí pero te van a poner ese pero',
    ])
    expect(detenida.descartes.filter((descarte) => descarte.motivo === 'huerfano')).toEqual([])
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
