// @vitest-environment node
/**
 * CASO 12 (TRAZA DE FILA) — guard de comportamiento.
 *
 * Criterio del encargo: cada commit deja una línea con turnId, speaker y
 * longitud del texto (AGENTS §2.5) por el sink existente `recordSessionEvent`
 * (`src/voice/api/sessionLog.ts:7`); nunca `logCaughtError` ni `console.*`; si
 * falta el sink, PARAR (el sink existe: facade → sessionRecorder.js, no-op sin
 * grabación activa).
 *
 * Qué mide este guard:
 *  - el commit de fila tiene DUEÑO ÚNICO (`commitar` en cierre.ts): emite
 *    `row.committed` Y deja la traza en el MISMO acto — ningún `row.committed`
 *    fuera de ahí, así un commit sin traza es imposible por construcción;
 *  - la traza lleva turnId, hablante y longitud del texto y sale por el sink
 *    único `recordSessionEvent`, sin consola;
 *  - COMPORTAMIENTO con el módulo real: cada fila commiteada deja SU traza
 *    emparejada — mismas turnId, hablante y longitud — y un descarte no deja
 *    traza (no es commit). La fila commiteada es INMUTABLE (mandato 2026-10-30):
 *    cada locución es su fila y cada una deja su traza.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/voice/api/sessionLog.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/voice/api/sessionLog.ts')>()
  return {
    ...real,
    recordSessionEvent: vi.fn(
      (category: string, event: string, data?: unknown) =>
        real.recordSessionEvent(category, event, data),
    ),
  }
})

import { crearConversacion } from '../src/voice/conversation/index'
import type {
  ConversacionApi,
  DependenciasConversacion,
  EventoConversacion,
  InstantaneaConversacion,
} from '../src/voice/conversation/index'
import {
  crearAlmacenMemoria,
  crearIdUuid,
  crearMedidorTramo,
  crearPartidorWake,
} from '../src/voice/conversation/adapters'
import type { ConfigPort, MedidaVad } from '../src/voice/conversation/ports'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'
import { recordSessionEvent } from '../src/voice/api/sessionLog.ts'

const SAMPLE_RATE = 16000
const fuenteDe = (ruta: string): string =>
  readFileSync(join(process.cwd(), ruta), 'utf8')

/** Cuerpo de la función `commitar` de cierre.ts, o null si no existe. */
function cuerpoDeCommitar(src: string): string | null {
  const cuerpo = /function commitar\(fila[^]*?\n  \}/.exec(src)
  return cuerpo ? cuerpo[0] : null
}

/** ¿El commit tiene dueño único: `row.committed` SOLO dentro de `commitar`, con traza? */
export function commitUnicoDueno(src: string): boolean {
  const cuerpo = cuerpoDeCommitar(src)
  if (!cuerpo) return false
  if (!cuerpo.includes("'row.committed'") || !cuerpo.includes('recordSessionEvent(')) {
    return false
  }
  // Sin `row.committed` fuera del dueño no existe commit sin traza.
  return !src.replace(cuerpo, '').includes("'row.committed'")
}

/** ¿La traza lleva turnId, hablante y longitud del texto? */
export function trazaLlevaTurnoHablanteYLongitud(src: string): boolean {
  const cuerpo = cuerpoDeCommitar(src)
  if (!cuerpo) return false
  return (
    cuerpo.includes('turnId: fila.turnId') &&
    cuerpo.includes('hablante: fila.etiqueta') &&
    cuerpo.includes("longitud: String(fila.texto || '').length")
  )
}

/** ¿La traza sale por el sink único (facade sessionLog.ts)? */
export function trazaPorElSinkUnico(src: string): boolean {
  return src.includes("import { recordSessionEvent } from '../api/sessionLog.ts'")
}

/** ¿La traza jamás usa consola ni logCaughtError? */
export function trazaSinConsola(src: string): boolean {
  const cuerpo = cuerpoDeCommitar(src)
  if (!cuerpo) return false
  return !cuerpo.includes('console.') && !cuerpo.includes('logCaughtError')
}

const VOZ = (): MedidaVad => ({ hayVoz: true, silencioMs: 0 })
const SILENCIO = (silencioMs: number): MedidaVad => ({ hayVoz: false, silencioMs })

/** Cursor de muestras de la sesión sintética (una línea de audio continua). */
let cursor = 0

type Escenario = Readonly<{ api: ConversacionApi; eventos: EventoConversacion[] }>

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
  const api = crearConversacion(dependencias)
  const eventos: EventoConversacion[] = []
  api.subscribe((evento) => eventos.push(evento))
  return { api, eventos }
}

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
 * Locución completa: pausa de 900 ms (separa de la locución anterior), 1 s de voz
 * que abre el tramo, texto del ASR con final y corte de `silenceCloseMs` (5000 ms)
 * que cierra por silencio (la puerta de abajo, C1).
 */
async function locucion(
  escenario: Escenario,
  texto: string,
  turnId: string,
  turnoAudio: string | undefined,
): Promise<void> {
  const { api } = escenario
  await entregarAudio(api, SILENCIO(900), cursor, turnoAudio)
  const conVoz = await entregarAudio(api, VOZ(), cursor, turnoAudio)
  const abierta = conVoz.locucionAbierta
  if (!abierta) throw new Error('el audio con voz no abrio locucion')
  const finTramo = abierta.tramo.fin
  await api.ingestAsr({ tramoId: abierta.locutionId, texto, final: true, turnId })
  const muestrasCierre = Math.round((SAMPLE_RATE * 5000) / 1000)
  await api.ingestAudio({
    muestras: new Float32Array(muestrasCierre),
    sampleRate: SAMPLE_RATE,
    inicio: finTramo,
    fin: finTramo + muestrasCierre,
    medida: SILENCIO(5000),
  })
  cursor = Math.max(cursor, finTramo + muestrasCierre)
}

/** Trazas de fila registradas por el sink (solo las del commit). */
function trazasDeCommit() {
  const traza = vi.mocked(recordSessionEvent)
  return traza.mock.calls.filter(
    (llamada) => llamada[0] === 'conversacion' && llamada[1] === 'fila.commiteada',
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Caso 12 — cada commit deja su traza (módulo real, sink espiado)', () => {
  it('una fila nueva commiteada deja UNA traza con turnId, hablante y longitud', async () => {
    const escenario = crearEscenario()
    await escenario.api.start({ turnId: 'T5' })
    const texto = 'ok flu pon una alarma'
    await locucion(escenario, texto, 'T5', undefined)

    const filas = escenario.eventos
      .filter((evento) => evento.tipo === 'row.committed')
      .map((evento) => (evento.tipo === 'row.committed' ? evento.fila : null))
      .filter((fila) => fila !== null)
    expect(filas).toHaveLength(1)
    const trazas = trazasDeCommit()
    expect(trazas).toHaveLength(1)
    const datos = trazas[0]![2] as Record<string, unknown>
    expect(datos.turnId).toBe('T5')
    expect(datos.hablante).toBe('Hablante 1')
    expect(datos.longitud).toBe(texto.length)
  })

  it('cada commit deja SU traza emparejada (dos turnos, dos filas)', async () => {
    const escenario = crearEscenario()
    await escenario.api.start({ turnId: 'T5' })
    await locucion(escenario, 'ok flu pon una alarma', 'T5', undefined)
    // Turno DISTINTO: la segunda locución es OTRA fila (insert-only por turno;
    // la reemisión del MISMO turno se descarta como `turnoYaEscrito`, Caso 8).
    await locucion(escenario, 'con el doctor', 'T6', 'T6')

    const commits = escenario.eventos
      .filter((evento) => evento.tipo === 'row.committed')
      .map((evento) => (evento.tipo === 'row.committed' ? evento.fila : null))
      .filter((fila) => fila !== null)
    const trazas = trazasDeCommit()
    expect(commits, 'una fila por turno').toHaveLength(2)
    // Un commit sin traza es ROJO: mismo número de trazas que de commits, y cada
    // traza empareja turnId, hablante y longitud con SU fila commiteada.
    expect(trazas).toHaveLength(commits.length)
    for (let i = 0; i < commits.length; i += 1) {
      const fila = commits[i]!
      const datos = trazas[i]![2] as Record<string, unknown>
      expect(datos.turnId).toBe(fila.turnId)
      expect(datos.hablante).toBe(fila.etiqueta)
      expect(datos.longitud).toBe(String(fila.texto || '').length)
    }
  })

  it('un descarte NO es un commit: no deja traza de fila', async () => {
    const escenario = crearEscenario()
    await escenario.api.start({ turnId: 'T5' })
    // Voz SIN texto (el ASR nunca llegó): el stop cierra en descarte (Caso 9).
    await entregarAudio(escenario.api, SILENCIO(900), cursor, undefined)
    await entregarAudio(escenario.api, VOZ(), cursor, undefined)
    await escenario.api.stop('system')

    expect(trazasDeCommit()).toHaveLength(0)
    const commits = escenario.eventos.filter((evento) => evento.tipo === 'row.committed')
    expect(commits).toHaveLength(0)
    expect(escenario.api.snapshot().descartes).toEqual([
      expect.objectContaining({ motivo: 'sinTexto' }),
    ])
  })
})

describe('Caso 12 — los dueños viven en el archivo real', () => {
  it('el commit de fila tiene dueño único con traza (cierre.ts)', () => {
    expect(commitUnicoDueno(fuenteDe('src/voice/conversation/cierre.ts'))).toBe(true)
  })

  it('la traza lleva turnId, hablante y longitud (cierre.ts)', () => {
    expect(trazaLlevaTurnoHablanteYLongitud(fuenteDe('src/voice/conversation/cierre.ts'))).toBe(true)
  })

  it('la traza sale por el sink único sessionLog.ts (cierre.ts)', () => {
    expect(trazaPorElSinkUnico(fuenteDe('src/voice/conversation/cierre.ts'))).toBe(true)
  })

  it('la traza no usa consola ni logCaughtError (cierre.ts)', () => {
    expect(trazaSinConsola(fuenteDe('src/voice/conversation/cierre.ts'))).toBe(true)
  })
})

describe('Caso 12 — PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('un commit emitido fuera del dueño => rojo; dentro del dueño => verde', () => {
    const cuerpo =
      "function commitar(fila) {\n" +
      "  emitir({ tipo: 'row.committed', sessionId: fila.sessionId, fila })\n" +
      "  recordSessionEvent('conversacion', 'fila.commiteada', { turnId: fila.turnId })\n" +
      '  }\n'
    const fueraDelDueno =
      cuerpo + "emitir({ tipo: 'row.committed', sessionId: 'x', fila: fila2 })\n"
    expect(commitUnicoDueno(fueraDelDueno)).toBe(false)
    expect(commitUnicoDueno(cuerpo)).toBe(true)
  })

  it('una traza sin turnId o sin longitud => rojo; completa => verde', () => {
    const base =
      "function commitar(fila) {\n" +
      "  emitir({ tipo: 'row.committed', sessionId: fila.sessionId, fila })\n" +
      "  recordSessionEvent('conversacion', 'fila.commiteada', {\n" +
      '    turnId: fila.turnId,\n' +
      '    hablante: fila.etiqueta,\n' +
      "    longitud: String(fila.texto || '').length,\n" +
      '  })\n' +
      '  }\n'
    expect(trazaLlevaTurnoHablanteYLongitud(base)).toBe(true)
    const sinTurno = base.replace('    turnId: fila.turnId,\n', '')
    expect(trazaLlevaTurnoHablanteYLongitud(sinTurno)).toBe(false)
    const sinLongitud = base.replace("    longitud: String(fila.texto || '').length,\n", '')
    expect(trazaLlevaTurnoHablanteYLongitud(sinLongitud)).toBe(false)
  })

  it('un sink que no es el facade => rojo; el facade => verde', () => {
    expect(
      trazaPorElSinkUnico("import { recordSessionEvent } from '../api/sessionLog.ts'"),
    ).toBe(true)
    expect(
      trazaPorElSinkUnico("import { recordSessionEvent } from '../lib/sessionRecorder.js'"),
    ).toBe(false)
  })

  it('una traza por consola o logCaughtError => rojo; por el sink => verde', () => {
    const cuerpo =
      "function commitar(fila) {\n" +
      "  emitir({ tipo: 'row.committed', sessionId: fila.sessionId, fila })\n" +
      "  recordSessionEvent('conversacion', 'fila.commiteada', { turnId: fila.turnId })\n" +
      '  }\n'
    expect(trazaSinConsola(cuerpo)).toBe(true)
    const conConsola = cuerpo.replace(
      "recordSessionEvent('conversacion', 'fila.commiteada', { turnId: fila.turnId })",
      "console.log('fila', fila)",
    )
    expect(trazaSinConsola(conConsola)).toBe(false)
    const conCaught = cuerpo.replace(
      "recordSessionEvent('conversacion', 'fila.commiteada', { turnId: fila.turnId })",
      "logCaughtError('conversacion.fila', fila)",
    )
    expect(trazaSinConsola(conCaught)).toBe(false)
  })
})
