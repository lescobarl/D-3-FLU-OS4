// @vitest-environment node
/**
 * CASO 8 (turnId ÚNICO) — un turnId => un final CONSOLIDADO y UNA fila.
 *
 * Criterio del encargo: reemitir el mismo turnId NO crea fila; la fila del
 * turno se consolida (reemisión => revisión sin pérdida; continuación => la
 * fila crece) y el final completa la provisional. Un turno DISTINTO sí abre su
 * fila (dos turnos con la misma frase son DOS filas legítimas).
 *
 * Se mide con el MÓDULO REAL y almacén en memoria: la regla pura vive en
 * `consolidarFilaDelTurno` (fila.ts) y el gate único en `cerrarLocucion`
 * (cierre.ts), la única puerta que escribe filas. Sin proveedor de turno, cada
 * locución acuña el suyo: el gate nunca fusiona locuciones ajenas.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { crearConversacion } from '../src/voice/conversation/index'
import { consolidarFilaDelTurno } from '../src/voice/conversation/fila'
import type { CierreLocucion } from '../src/voice/conversation/fila'
import type {
  ConversacionApi,
  DependenciasConversacion,
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

const SAMPLE_RATE = 16000

const fuenteDe = (ruta: string): string =>
  readFileSync(join(process.cwd(), ruta), 'utf8')

/** Gate del Caso 8 en la puerta única de cierre (cierre.ts). */
export function gateConsolidacionEnCierre(src: string): boolean {
  return /consolidarEnLaFilaDelTurno\(/.test(src) && /filaDelTurno\(/.test(src)
}

/** Regla pura de consolidación declarada en fila.ts. */
export function reglaConsolidacionEnFila(src: string): boolean {
  return /export function consolidarFilaDelTurno/.test(src)
}

/** Los almacenes aplican `tramo` en `actualizar` (la ventana se consolida). */
export function actualizarTramoEnAlmacen(src: string): boolean {
  return /tramo:\s*cambios\.tramo/.test(src)
}

const VOZ = (): MedidaVad => ({ hayVoz: true, silencioMs: 0 })
const SILENCIO = (silencioMs: number): MedidaVad => ({ hayVoz: false, silencioMs })

/** Cursor de muestras de la sesión sintética (una línea de audio continua). */
let cursor = 0

type Escenario = Readonly<{
  api: ConversacionApi
}>

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

type OpcionesLocucion = Readonly<{
  turnId: string
  /** Inicio explícito del tramo de voz (por defecto, el cursor). */
  inicio?: number
  /** Sin final: la locución se cierra por SILENCIO (fila provisional). */
  final?: boolean
  /** Turno que declara el AUDIO (cambia el turno actual de la sesión). */
  turnoAudio?: string
}>

/**
 * Locución completa: pausa de 900 ms (corta el tramo anterior), 1 s de voz que
 * abre el tramo, texto del ASR y cierre del tramo con un bloque de silencio que
 * arranca EXACTAMENTE en el fin del tramo (candidato = fin: no lo extiende).
 * Con final, el corte de 900 ms cierra POR CONTENIDO (Caso 7+6); sin final, el
 * silencio de 5000 ms cierra la fila provisional. Devuelve la instantánea del
 * bloque de voz (con el `tramoId` de la locución abierta).
 */
async function locucion(
  escenario: Escenario,
  texto: string,
  opciones: OpcionesLocucion,
): Promise<InstantaneaConversacion> {
  const { api } = escenario
  await entregarAudio(api, SILENCIO(900), cursor, opciones.turnoAudio)
  const conVoz = await entregarAudio(
    api,
    VOZ(),
    opciones.inicio ?? cursor,
    opciones.turnoAudio,
  )
  const abierta = conVoz.locucionAbierta
  if (!abierta) throw new Error('el audio con voz no abrio locucion')
  const tramoId = abierta.locutionId
  const finTramo = abierta.tramo.fin
  await api.ingestAsr({
    tramoId,
    texto,
    final: Boolean(opciones.final),
    turnId: opciones.turnId,
  })
  const cierreMs = opciones.final ? 900 : 5000
  const muestrasCierre = Math.round((SAMPLE_RATE * cierreMs) / 1000)
  await api.ingestAudio({
    muestras: new Float32Array(muestrasCierre),
    sampleRate: SAMPLE_RATE,
    inicio: finTramo,
    fin: finTramo + muestrasCierre,
    medida: SILENCIO(cierreMs),
  })
  cursor = Math.max(cursor, finTramo + muestrasCierre)
  return conVoz
}

describe('Caso 8 — un turnId => una fila (módulo real)', () => {
  it('reemisión del MISMO turno con OTRO tramo solapado: una fila consolidada', async () => {
    const escenario = crearEscenario()
    await escenario.api.start({ turnId: 'T5' })
    await locucion(escenario, 'ok flu crea una cita', { turnId: 'T5', final: true })
    const previa = filasDe(escenario.api)[0]
    if (!previa) throw new Error('sin fila')

    // El MISMO turno re-emite con tramo nuevo cuya ventana SOLAPA la anterior.
    await locucion(escenario, 'ok flu crea una cita manana', {
      turnId: 'T5',
      inicio: previa.tramo.fin - 8000,
      final: true,
    })

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(1)
    expect(filas[0]!.turnId).toBe('T5')
    expect(filas[0]!.texto).toBe('ok flu crea una cita manana')
    expect(filas[0]!.provisional).toBe(false)
    expect(filas[0]!.tramo.fin).toBe(previa.tramo.fin + 8000)
  })

  it('re-delivery idéntico con ventana disjunta NO duplica ni cambia la fila', async () => {
    const escenario = crearEscenario()
    await escenario.api.start({ turnId: 'T5' })
    await locucion(escenario, 'ok flu crea una cita', { turnId: 'T5', final: true })
    const previa = filasDe(escenario.api)[0]
    if (!previa) throw new Error('sin fila')

    await locucion(escenario, 'ok flu crea una cita', { turnId: 'T5', final: true })

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(1)
    expect(filas[0]!.texto).toBe('ok flu crea una cita')
    expect(filas[0]!.locutionId).toBe(previa.locutionId)
    expect(filas[0]!.tramo.fin).toBe(previa.tramo.fin)
  })

  it('continuación del MISMO turno tras pausa: una fila que crece y se completa', async () => {
    const escenario = crearEscenario()
    await escenario.api.start({ turnId: 'T5' })
    await locucion(escenario, 'ok flu crea una cita', { turnId: 'T5', final: false })
    const previa = filasDe(escenario.api)[0]
    if (!previa) throw new Error('sin fila')
    expect(previa.provisional).toBe(true)

    await locucion(escenario, 'con el doctor', { turnId: 'T5', final: true })

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(1)
    expect(filas[0]!.turnId).toBe('T5')
    expect(filas[0]!.texto).toBe('ok flu crea una cita con el doctor')
    expect(filas[0]!.provisional).toBe(false)
    expect(filas[0]!.tramo.fin).toBeGreaterThan(previa.tramo.fin)
  })

  it('reemisión del MISMO tramo (misma locución): la fila se promueve, no duplica', async () => {
    const escenario = crearEscenario()
    await escenario.api.start({ turnId: 'T5' })
    const abierta = await locucion(escenario, 'ok flu crea una cita', { turnId: 'T5', final: false })
    const tramoId = abierta.locucionAbierta?.locutionId
    if (!tramoId) throw new Error('sin tramo')

    await escenario.api.ingestAsr({ tramoId, texto: 'ok flu crea una cita manana', final: true, turnId: 'T5' })

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(1)
    expect(filas[0]!.texto).toBe('ok flu crea una cita manana')
    expect(filas[0]!.provisional).toBe(false)
  })

  it('un turno DISTINTO sí abre su fila: dos turnos, dos filas', async () => {
    const escenario = crearEscenario()
    await escenario.api.start({ turnId: 'T5' })
    await locucion(escenario, 'ok flu pon una alarma', { turnId: 'T5', final: true })
    await locucion(escenario, 'ok flu pon una alarma', {
      turnId: 'T6',
      turnoAudio: 'T6',
      final: true,
    })

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(2)
    expect(filas[0]!.turnId).toBe('T5')
    expect(filas[1]!.turnId).toBe('T6')
  })

  it('sin proveedor de turno, cada locución ES su turno: nunca se fusionan', async () => {
    const escenario = crearEscenario()
    await escenario.api.start()
    await locucion(escenario, 'primera', { turnId: '', final: true })
    await locucion(escenario, 'segunda', { turnId: '', final: true })

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(2)
    expect(filas[0]!.turnId).not.toBe('')
    expect(new Set(filas.map((fila) => fila.turnId)).size).toBe(2)
  })
})

describe('Caso 8 — la regla pura consolidarFilaDelTurno', () => {
  const filaPrevia = (
    texto: string,
    fin: number,
    provisional = false,
  ): Fila => ({
    locutionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sessionId: 's-1',
    turnId: 'T5',
    texto,
    tramo: { inicio: 0, fin, sampleRate: SAMPLE_RATE },
    etiqueta: 'Hablante 1',
    evidencia: 'medida',
    idioma: 'es',
    overlap: false,
    provisional,
    reason: 'system',
    revision: 1,
    updated_at: 1_700_000_000_000,
    deleted: false,
  })

  const cierreNuevo = (
    texto: string,
    inicio: number,
    fin: number,
    final: boolean,
  ): CierreLocucion => ({
    locutionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    sessionId: 's-1',
    turnId: 'T5',
    inicio,
    fin,
    sampleRate: SAMPLE_RATE,
    texto,
    idioma: 'es',
    overlap: false,
    final,
    reason: 'system',
    voz: { nombre: '', nombreConfirmado: false, hablante: 'Hablante 1', continuidad: true },
    etiquetaAnterior: null,
    semillaEtiqueta: 'Hablante 1',
    esEtiquetaAnonima: (etiqueta: string) => etiqueta.startsWith('Hablante'),
  })

  it('ventana solapada y texto que crece => la fila se revisa sin duplicar', () => {
    const cambios = consolidarFilaDelTurno(
      filaPrevia('ok flu crea una cita', 16000),
      cierreNuevo('ok flu crea una cita manana', 8000, 24000, true),
    )
    expect(cambios).toEqual({
      texto: 'ok flu crea una cita manana',
      tramo: { inicio: 0, fin: 24000, sampleRate: SAMPLE_RATE },
    })
  })

  it('ventana solapada y MENOS palabras => la fila no pierde palabras', () => {
    const cambios = consolidarFilaDelTurno(
      filaPrevia('ok flu crea una cita manana', 16000),
      cierreNuevo('ok flu', 8000, 24000, true),
    )
    expect(cambios).toEqual({ tramo: { inicio: 0, fin: 24000, sampleRate: SAMPLE_RATE } })
  })

  it('re-delivery idéntico con ventana disjunta => sin cambios', () => {
    const cambios = consolidarFilaDelTurno(
      filaPrevia('ok flu crea una cita', 16000),
      cierreNuevo('ok flu crea una cita', 32000, 48000, true),
    )
    expect(cambios).toBeNull()
  })

  it('ventana disjunta y texto nuevo => la fila crece (continuación)', () => {
    const cambios = consolidarFilaDelTurno(
      filaPrevia('ok flu crea una cita', 16000),
      cierreNuevo('con el doctor', 32000, 48000, true),
    )
    expect(cambios).toEqual({
      texto: 'ok flu crea una cita con el doctor',
      tramo: { inicio: 0, fin: 48000, sampleRate: SAMPLE_RATE },
    })
  })

  it('el final completa la provisional; sin final se conserva provisional', () => {
    const completa = consolidarFilaDelTurno(
      filaPrevia('ok flu crea una cita', 16000, true),
      cierreNuevo('con el doctor', 32000, 48000, true),
    )
    expect(completa?.provisional).toBe(false)
    const abierta = consolidarFilaDelTurno(
      filaPrevia('ok flu crea una cita', 16000, true),
      cierreNuevo('con el doctor', 32000, 48000, false),
    )
    expect(abierta?.provisional).toBeUndefined()
  })

  it('una fila borrada lógicamente no se consolida', () => {
    const borrada = { ...filaPrevia('ok flu crea una cita', 16000), deleted: true }
    expect(consolidarFilaDelTurno(borrada, cierreNuevo('con el doctor', 32000, 48000, true))).toBeNull()
  })
})

describe('Caso 8 — los dueños viven en el archivo real', () => {
  it('el gate único está en la puerta de cierre (cierre.ts)', () => {
    expect(gateConsolidacionEnCierre(fuenteDe('src/voice/conversation/cierre.ts'))).toBe(true)
  })

  it('la regla pura está declarada en fila.ts', () => {
    expect(reglaConsolidacionEnFila(fuenteDe('src/voice/conversation/fila.ts'))).toBe(true)
  })

  it('los almacenes (Dexie y memoria) aplican tramo en actualizar', () => {
    expect(actualizarTramoEnAlmacen(fuenteDe('src/voice/conversation/adaptersAlmacen.ts'))).toBe(true)
    expect(actualizarTramoEnAlmacen(fuenteDe('src/voice/conversation/adapters.ts'))).toBe(true)
  })
})

describe('Caso 8 — PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('un cierre sin el gate => rojo; con el gate => verde', () => {
    const sinGate = 'const fila = await almacen.guardar(resultado.fila)\n  estado.filas.set(fila.locutionId, fila)'
    expect(gateConsolidacionEnCierre(sinGate)).toBe(false)
    const conGate =
      'const previaDelTurno = filaDelTurno(cierre.turnId)\nif (previaDelTurno) await consolidarEnLaFilaDelTurno(previaDelTurno, cierre)'
    expect(gateConsolidacionEnCierre(conGate)).toBe(true)
  })

  it('una consolidación sin exportar => rojo; exportada => verde', () => {
    expect(reglaConsolidacionEnFila('function consolidarFilaDelTurno() {}')).toBe(false)
    expect(reglaConsolidacionEnFila('export function consolidarFilaDelTurno() {}')).toBe(true)
  })

  it('un almacén que ignora tramo en actualizar => rojo', () => {
    expect(actualizarTramoEnAlmacen('texto: cambios.texto ?? anterior.texto')).toBe(false)
    expect(actualizarTramoEnAlmacen('tramo: cambios.tramo ?? anterior.tramo')).toBe(true)
  })
})
