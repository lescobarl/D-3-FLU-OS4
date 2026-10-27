// @vitest-environment node
/**
 * CASO 11 (UN ID POR GRABACIÓN) — guard de comportamiento.
 *
 * Criterio del encargo: recordingId = sessionId del recorder; el recorder se
 * enciende antes de la escucha y la conversación adopta ese id al abrir la
 * sesión; N/A si el recorder no está activo al iniciar. Guard: todos los
 * commits/eventos de una grabación llevan el MISMO recordingId; nunca dos.
 *
 * Qué mide este guard:
 *  - el módulo ADOPTA el id de la grabación en `start` y solo acuña el propio
 *    cuando viene vacío (N/A sin recorder al iniciar);
 *  - todos los commits y eventos de la sesión llevan ESE único id (nunca dos);
 *  - el producto lee el id de la grabación al ABRIR y lo pasa al módulo, y la
 *    fila persistida en Dexie lo conserva;
 *  - la composición del hook cablea el sessionId del recorder (dueño único de
 *    la grabación, encendido antes de la escucha).
 *
 * Se mide con el MÓDULO REAL y con el motor REAL del producto (Dexie sobre
 * fake-indexeddb); los detectores viven en el código real.
 */
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { fluDb } from '../src/core/db/fluDatabase'
import { crearConversacion, crearMotorConversacionProducto } from '../src/voice/conversation/index'
import type {
  ConversacionApi,
  DependenciasConversacion,
  EventoConversacion,
  EventoProducto,
  InstantaneaConversacion,
} from '../src/voice/conversation/index'
import {
  crearAlmacenMemoria,
  crearIdUuid,
  crearMedidorTramo,
  crearPartidorWake,
} from '../src/voice/conversation/adapters'
import type { ConfigPort, Fila, MedidaVad } from '../src/voice/conversation/ports'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'
import { getVadEnergyThreshold } from '../src/voice/lib/asr/asrConfig.js'

const SAMPLE_RATE = 16000
const BLOQUE = 1600 // 100 ms
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const fuenteDe = (ruta: string): string =>
  readFileSync(join(process.cwd(), ruta), 'utf8')

/** ¿`start` ADOPTA el id de la grabación y solo acuña cuando viene vacío? */
export function startAdoptaElIdDeGrabacion(src: string): boolean {
  return /String\(opciones\?\.sessionId \?\? ''\)\.trim\(\) \|\| id\.uuid\(\)/.test(src)
}

/** ¿El producto lee el id de la grabación al ABRIR y lo pasa al módulo? */
export function productoAdoptaAlAbrir(src: string): boolean {
  return (
    /String\(recordingId\?\.\(\) \?\? ''\)\.trim\(\)/.test(src) &&
    /sessionId: grabacion/.test(src)
  )
}

/** ¿La composición cablea el sessionId del recorder como id de grabación? */
export function composicionLeeElRecorder(src: string): boolean {
  return /getSessionRecordingStatus\(\)\.sessionId/.test(src)
}

const VOZ = (): MedidaVad => ({ hayVoz: true, silencioMs: 0 })
const SILENCIO = (silencioMs: number): MedidaVad => ({ hayVoz: false, silencioMs })

/** Cursor de muestras de la sesión sintética (una línea de audio continua). */
let cursor = 0

type Escenario = Readonly<{ api: ConversacionApi }>

function crearEscenario(): Escenario {
  cursor = 0
  const reloj = { ahora: () => 1_700_000_000_000 }
  const config: ConfigPort = {
    wakeWords: () => ['ok flu'],
    semillaEtiqueta: () => 'Hablante 1',
    esEtiquetaAnonima: isAutoSpeakerLabel,
    umbralContinuidadVoz: () => 0.8,
    etiquetaAnonima: (indice) => `Hablante ${indice}`,
    echoMinPalabrasCola: () => 4,
  }
  const dependencias: DependenciasConversacion = {
    reloj,
    id: crearIdUuid(),
    registro: { registrar: () => undefined },
    almacen: crearAlmacenMemoria({ reloj }),
    config,
    partidor: crearPartidorWake(config),
    medidor: crearMedidorTramo(),
    ultimoTextoDicho: () => '',
  }
  return { api: crearConversacion(dependencias) }
}

/** Filas de la instantánea (la retención no borra, solo oculta). */
const filasDe = (api: ConversacionApi): readonly Fila[] => api.snapshot().filas

/** Bloque de audio de 1 s entregado al módulo. */
async function entregarAudio(
  api: ConversacionApi,
  medida: MedidaVad,
  inicio: number,
  turnId?: string,
): Promise<InstantaneaConversacion> {
  const estado = await api.ingestAudio({
    muestras: new Float32Array(SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
    inicio,
    fin: inicio + SAMPLE_RATE,
    medida,
    ...(turnId ? { turnId } : {}),
  })
  cursor = Math.max(cursor, inicio + SAMPLE_RATE)
  return estado
}

/**
 * Locución completa: pausa de 900 ms (corta el tramo anterior), 1 s de voz que
 * abre el tramo, texto del ASR con final y corte de 900 ms que cierra por
 * contenido (Caso 7+6). Devuelve la instantánea del bloque de voz.
 */
async function locucion(
  escenario: Escenario,
  texto: string,
  turnId: string,
  turnoAudio: string | undefined,
): Promise<InstantaneaConversacion> {
  const { api } = escenario
  await entregarAudio(api, SILENCIO(900), cursor, turnoAudio)
  const conVoz = await entregarAudio(api, VOZ(), cursor, turnoAudio)
  const abierta = conVoz.locucionAbierta
  if (!abierta) throw new Error('el audio con voz no abrio locucion')
  const finTramo = abierta.tramo.fin
  await api.ingestAsr({ tramoId: abierta.locutionId, texto, final: true, turnId })
  const muestrasCorte = Math.round((SAMPLE_RATE * 900) / 1000)
  await api.ingestAudio({
    muestras: new Float32Array(muestrasCorte),
    sampleRate: SAMPLE_RATE,
    inicio: finTramo,
    fin: finTramo + muestrasCorte,
    medida: SILENCIO(900),
  })
  cursor = Math.max(cursor, finTramo + muestrasCorte)
  return conVoz
}

/** Tono con RMS cuatro veces por encima del piso REAL del VAD. */
function tono(ms: number): Float32Array {
  const n = Math.round((SAMPLE_RATE * ms) / 1000)
  const muestras = new Float32Array(n)
  const amplitud = Math.sqrt(2) * getVadEnergyThreshold() * 4
  for (let i = 0; i < n; i += 1) {
    muestras[i] = Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) * amplitud
  }
  return muestras
}

/** Silencio digital del mismo tamaño. */
function silencio(ms: number): Float32Array {
  return new Float32Array(Math.round((SAMPLE_RATE * ms) / 1000))
}

/** Evento del reconocedor con la forma que entrega Chrome. */
function eventoAsr(texto: string, final = false): EventoProducto {
  return {
    resultIndex: 0,
    results: [{ 0: { transcript: texto }, isFinal: final, length: 1 }],
  }
}

/** Ciclo mínimo del producto: 1 s de silencio + 1 s de voz + frase + cierre. */
async function locucionProducto(
  motor: ReturnType<typeof crearMotorConversacionProducto>,
  texto: string,
): Promise<EventoConversacion> {
  for (let i = 0; i < 10; i += 1) motor.audio(silencio(100), SAMPLE_RATE, i * BLOQUE)
  for (let i = 0; i < 10; i += 1) motor.audio(tono(100), SAMPLE_RATE, 16000 + i * BLOQUE)
  await motor.evento(eventoAsr(texto, true))
  const commit = new Promise<EventoConversacion>((resolver) => {
    motor.suscribir((evento) => {
      if (evento.tipo === 'row.committed') resolver(evento)
    })
  })
  motor.cerrar('user')
  return commit
}

beforeEach(async () => {
  await fluDb.conversations.clear()
})

describe('Caso 11 — el módulo adopta el id de la grabación (módulo real)', () => {
  it('con recorder activo: filas y eventos llevan EL id del recorder (nunca dos)', async () => {
    const escenario = crearEscenario()
    const eventos: EventoConversacion[] = []
    escenario.api.subscribe((evento) => eventos.push(evento))
    await escenario.api.start({ sessionId: 'grab-1', turnId: 'T5' })
    await locucion(escenario, 'ok flu pon una alarma', 'T5', undefined)
    await locucion(escenario, 'adios', 'T6', 'T6')

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(2)
    for (const fila of filas) expect(fila.sessionId).toBe('grab-1')
    const idsDeFilas = new Set(filas.map((fila) => fila.sessionId))
    expect(idsDeFilas.size).toBe(1)

    const idsDeEventos = new Set(eventos.map((evento) => evento.sessionId))
    expect(idsDeEventos).toEqual(new Set(['grab-1']))
  })

  it('sin recorder (N/A): el módulo acuña UN id y todos los commits lo llevan', async () => {
    const escenario = crearEscenario()
    await escenario.api.start({ turnId: 'T5' })
    await locucion(escenario, 'ok flu pon una alarma', 'T5', undefined)
    await locucion(escenario, 'adios', 'T6', 'T6')

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(2)
    const ids = new Set(filas.map((fila) => fila.sessionId))
    expect(ids.size).toBe(1)
    const acunado = [...ids][0]!
    expect(acunado).not.toBe('')
    expect(UUID_RE.test(acunado)).toBe(true)
  })
})

describe('Caso 11 — el producto adopta el id al abrir (motor real + Dexie)', () => {
  it('con proveedor del recorder: la fila persistida lleva el id de la grabación', async () => {
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
      recordingId: () => 'grab-9',
    })
    motor.abrir()
    const commit = await locucionProducto(motor, 'hola')

    expect(commit.sessionId).toBe('grab-9')
    expect(motor.instantanea().filas.map((fila) => fila.sessionId)).toEqual(['grab-9'])
    const persistidas = await fluDb.conversations.toArray()
    expect(persistidas).toHaveLength(1)
    expect(persistidas[0]!.sessionId).toBe('grab-9')
  })

  it('sin recorder (N/A): el módulo acuña y la fila persistida lleva ESE único id', async () => {
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
      recordingId: () => '',
    })
    motor.abrir()
    await locucionProducto(motor, 'hola')

    const ids = new Set(motor.instantanea().filas.map((fila) => fila.sessionId))
    expect(ids.size).toBe(1)
    const acunado = [...ids][0]!
    expect(UUID_RE.test(acunado)).toBe(true)
    const persistidas = await fluDb.conversations.toArray()
    expect(persistidas).toHaveLength(1)
    expect(persistidas[0]!.sessionId).toBe(acunado)
  })
})

describe('Caso 11 — los dueños viven en el archivo real', () => {
  it('start adopta el id de la grabación o acuña (motor.ts)', () => {
    expect(startAdoptaElIdDeGrabacion(fuenteDe('src/voice/conversation/motor.ts'))).toBe(true)
  })

  it('el producto lee el id de la grabación al abrir (producto.ts)', () => {
    expect(productoAdoptaAlAbrir(fuenteDe('src/voice/conversation/producto.ts'))).toBe(true)
  })

  it('la composición cablea el sessionId del recorder (conversationMotorProducto.js)', () => {
    expect(
      composicionLeeElRecorder(fuenteDe('src/voice/compose/conversationMotorProducto.js')),
    ).toBe(true)
  })
})

describe('Caso 11 — PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('un start que acuña siempre => rojo; con adopción condicional => verde', () => {
    const acunaSiempre = 'const sessionId = id.uuid()'
    expect(startAdoptaElIdDeGrabacion(acunaSiempre)).toBe(false)
    const adopta =
      "const sessionId = String(opciones?.sessionId ?? '').trim() || id.uuid()"
    expect(startAdoptaElIdDeGrabacion(adopta)).toBe(true)
  })

  it('un producto que abre sin el id de la grabación => rojo; con el paso => verde', () => {
    const sinGrabacion = "api.start({ turnId: turno, idioma })"
    expect(productoAdoptaAlAbrir(sinGrabacion)).toBe(false)
    const conGrabacion =
      "const grabacion = String(recordingId?.() ?? '').trim()\n" +
      'api.start({ turnId: turno, idioma, ...(grabacion ? { sessionId: grabacion } : {}) })'
    expect(productoAdoptaAlAbrir(conGrabacion)).toBe(true)
  })

  it('una composición sin el recorder => rojo; con el sessionId del recorder => verde', () => {
    const sinRecorder = "ultimoTextoDicho: () => ''"
    expect(composicionLeeElRecorder(sinRecorder)).toBe(false)
    const conRecorder = "recordingId: () => getSessionRecordingStatus().sessionId || ''"
    expect(composicionLeeElRecorder(conRecorder)).toBe(true)
  })
})
