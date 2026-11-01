// @vitest-environment node
/**
 * CASO 8 (turnId ÚNICO) — un turnId => UNA fila (INSERT-ONLY, mandato 2026-10-30).
 *
 * La fila commiteada es INMUTABLE: no hay consolidación ni promoción. Una
 * locución que reemite o continúa un turno ya commiteado con la MISMA voz se
 * ignora sin tocar la fila (descarte contado `turnoYaEscrito`); una voz DISTINTA
 * medida inserta SU fila (dos voces sin pausa son DOS filas del mismo turno).
 * Un turno DISTINTO siempre abre su fila.
 *
 * Se mide con el MÓDULO REAL y almacén en memoria: el gate único vive en
 * `cerrarLocucion` (cierre.ts), la única puerta que escribe filas; `construirFila`
 * (fila.ts) es la regla pura y ya no declara promotores ni consolidadores.
 * Sin proveedor de turno, cada locución acuña el suyo: el gate nunca fusiona
 * locuciones ajenas.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { crearConversacion } from '../src/voice/conversation/index'
import { construirFila } from '../src/voice/conversation/fila'
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
import type {
  ConfigPort,
  EmbebedorPort,
  Fila,
  MedidaVad,
} from '../src/voice/conversation/ports'
import { CONVERSACION_CONFIG } from '../src/voice/conversation/ports'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'

const SAMPLE_RATE = 16000

const fuenteDe = (ruta: string): string =>
  readFileSync(join(process.cwd(), ruta), 'utf8')

/** Gate INSERT-ONLY del Caso 8 en la puerta única de cierre (cierre.ts). */
export function gateInsertoUnicoEnCierre(src: string): boolean {
  return /filaDelTurno\(/.test(src) && /turnoYaEscrito/.test(src)
}

/** Inmutabilidad de la fila en fila.ts: sin promotores ni consolidadores vivos. */
export function filaInmutableEnFila(src: string): boolean {
  return /export function construirFila/.test(src) && !/promoverFila|consolidarFilaDelTurno/.test(src)
}

/**
 * ¿Los almacenes aplican SOLO la etiqueta y su evidencia en `actualizar`?
 * Mandato del dueño 2026-10-30: el hablante es el único campo actualizable; el
 * resto de la fila (texto, tramo, estado) es inmutable.
 */
export function actualizarSoloEtiqueta(src: string): boolean {
  return /etiqueta:\s*cambios\.etiqueta/.test(src) && /evidencia:\s*cambios\.evidencia/.test(src)
}

const VOZ = (): MedidaVad => ({ hayVoz: true, silencioMs: 0 })
const SILENCIO = (silencioMs: number): MedidaVad => ({ hayVoz: false, silencioMs })

/** Cursor de muestras de la sesión sintética (una línea de audio continua). */
let cursor = 0

type Escenario = Readonly<{
  api: ConversacionApi
}>

function crearEscenario(opciones?: {
  embebedor?: EmbebedorPort
  configuracion?: DependenciasConversacion['configuracion']
}): Escenario {
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
    ...(opciones?.embebedor ? { embebedor: opciones.embebedor } : {}),
    ...(opciones?.configuracion ? { configuracion: opciones.configuracion } : {}),
  }
  return { api: crearConversacion(dependencias) }
}

/** Filas de la instantánea (la retención no borra, solo oculta). */
const filasDe = (api: ConversacionApi): readonly Fila[] => api.snapshot().filas

/** Descartes contados de la instantánea (nunca se pierden en silencio). */
const descartesDe = (api: ConversacionApi) => api.snapshot().descartes

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
 * abre el tramo, texto del ASR y un bloque de silencio de 5000 ms que arranca
 * EXACTAMENTE en el fin del tramo: el corte de 900 ms deja el tramo cerrado y
 * el silencio de 5000 ms CIERRA la locución (MANDATO 2026-10-30: el final NO
 * cierra, la puerta de abajo es el silencio). La fila queda commiteada al
 * volver. Devuelve la instantánea del bloque de voz (con el `tramoId`).
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
  const muestrasCierre = Math.round((SAMPLE_RATE * 5000) / 1000)
  await api.ingestAudio({
    muestras: new Float32Array(muestrasCierre),
    sampleRate: SAMPLE_RATE,
    inicio: finTramo,
    fin: finTramo + muestrasCierre,
    medida: SILENCIO(5000),
  })
  cursor = Math.max(cursor, finTramo + muestrasCierre)
  return conVoz
}

describe('Caso 8 — un turnId => una fila inmutable (módulo real)', () => {
  it('reemisión del MISMO turno con OTRO tramo: UNA fila sin cambios + descarte contado', async () => {
    const escenario = crearEscenario()
    await escenario.api.start({ turnId: 'T5' })
    await locucion(escenario, 'ok flu crea una cita', { turnId: 'T5', final: true })
    const previa = filasDe(escenario.api)[0]
    if (!previa) throw new Error('sin fila')

    // El MISMO turno re-emite con tramo nuevo: la fila commiteada es INMUTABLE,
    // la reemisión no la actualiza (insert-only, sin consolidación).
    await locucion(escenario, 'ok flu crea una cita manana', {
      turnId: 'T5',
      inicio: previa.tramo.fin - 8000,
      final: true,
    })

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(1)
    expect(filas[0]!.turnId).toBe('T5')
    expect(filas[0]!.texto).toBe('ok flu crea una cita')
    expect(filas[0]!.provisional).toBe(false)
    expect(filas[0]!.tramo.fin).toBe(previa.tramo.fin)
    expect(descartesDe(escenario.api)).toContainEqual(
      expect.objectContaining({ motivo: 'turnoYaEscrito' }),
    )
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
    expect(descartesDe(escenario.api)).toContainEqual(
      expect.objectContaining({ motivo: 'turnoYaEscrito' }),
    )
  })

  it('frase NUEVA del MISMO turno tras pausa: escribe SU fila (no se pierde)', async () => {
    const escenario = crearEscenario()
    await escenario.api.start({ turnId: 'T5' })
    await locucion(escenario, 'ok flu crea una cita', { turnId: 'T5', final: false })
    const previa = filasDe(escenario.api)[0]
    if (!previa) throw new Error('sin fila')
    expect(previa.provisional).toBe(true)

    await locucion(escenario, 'con el doctor', { turnId: 'T5', final: true })

    const filas = filasDe(escenario.api)
    // No es reentrega: el texto es OTRA frase. La regla del producto es
    // silencio o cambio de hablante, no "un turnId => una fila"; descartarla
    // era la conversacion perdida (auditoria 2026-11-01).
    expect(filas).toHaveLength(2)
    expect(filas[0]!.turnId).toBe('T5')
    expect(filas[0]!.texto).toBe('ok flu crea una cita')
    expect(filas[0]!.provisional).toBe(true)
    expect(filas[0]!.tramo.fin).toBe(previa.tramo.fin)
    expect(filas[1]!.texto).toBe('con el doctor')
    expect(descartesDe(escenario.api)).not.toContainEqual(
      expect.objectContaining({ motivo: 'turnoYaEscrito' }),
    )
  })

  it('reemisión del MISMO tramo DESPUÉS del cierre: la reentrega se ignora (fila inmutable)', async () => {
    const escenario = crearEscenario()
    await escenario.api.start({ turnId: 'T5' })
    const abierta = await locucion(escenario, 'ok flu crea una cita', { turnId: 'T5', final: false })
    const tramoId = abierta.locucionAbierta?.locutionId
    if (!tramoId) throw new Error('sin tramo')
    const previa = filasDe(escenario.api)[0]
    if (!previa) throw new Error('sin fila')
    expect(previa.provisional).toBe(true)

    // El tramo YA commiteó: el final tardío es reentrega y no reescribe la fila.
    await escenario.api.ingestAsr({ tramoId, texto: 'ok flu crea una cita manana', final: true, turnId: 'T5' })

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(1)
    expect(filas[0]!.texto).toBe('ok flu crea una cita')
    expect(filas[0]!.provisional).toBe(true)
  })

  it('una voz DISTINTA medida inserta SU fila: dos voces del mismo turno, dos filas', async () => {
    // Embebedor determinista: la primera locución mide [1,0,0], la segunda
    // [0,1,0] (comparar=0 < umbral => voz nueva). minSegundosVozMedida alto
    // desactiva la medida temprana: la identidad solo se mide al cerrar.
    let llamadas = 0
    const embebedor: EmbebedorPort = {
      medir: async () => {
        llamadas += 1
        return llamadas === 1 ? [1, 0, 0] : [0, 1, 0]
      },
      comparar: (a, b) =>
        a.length === b.length && a.every((v, i) => v === b[i]) ? 1 : 0,
    }
    const escenario = crearEscenario({
      embebedor,
      configuracion: { ...CONVERSACION_CONFIG, minSegundosVozMedida: 100 },
    })
    await escenario.api.start({ turnId: 'T5' })
    await locucion(escenario, 'ok flu crea una cita', { turnId: 'T5', final: true })
    await locucion(escenario, 'ok flu crea una cita manana', { turnId: 'T5', final: true })

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(2)
    expect(filas[0]!.turnId).toBe('T5')
    expect(filas[1]!.turnId).toBe('T5')
    expect(filas[0]!.texto).toBe('ok flu crea una cita')
    expect(filas[1]!.texto).toBe('ok flu crea una cita manana')
    expect(descartesDe(escenario.api)).not.toContainEqual(
      expect.objectContaining({ motivo: 'turnoYaEscrito' }),
    )
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

describe('Caso 8 — la regla pura construirFila (insert-only, inmutable)', () => {
  it('la fila commiteada se construye UNA vez y no se muta al reconstruir', () => {
    const entrada = {
      locutionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sessionId: 's-1',
      turnId: 'T5',
      inicio: 0,
      fin: 16000,
      sampleRate: SAMPLE_RATE,
      texto: 'ok flu crea una cita',
      idioma: 'es' as const,
      overlap: false,
      final: true,
      reason: 'system' as const,
      voz: { nombre: '', nombreConfirmado: false, hablante: 'Hablante 1', continuidad: true },
      etiquetaAnterior: null,
      semillaEtiqueta: 'Hablante 1',
      esEtiquetaAnonima: (etiqueta: string) => etiqueta.startsWith('Hablante'),
      firma: null,
    }
    const antes = JSON.stringify(entrada)
    // construirFila es la ÚNICA regla de fila viva: no hay promover ni consolidar.
    const resultado = construirFila(entrada)
    expect(JSON.stringify(entrada)).toBe(antes)
    if (!resultado.fila) throw new Error('la locución válida no se descarta')
    expect(resultado.fila.texto).toBe('ok flu crea una cita')
    expect(resultado.fila.provisional).toBe(false)
  })
})

describe('Caso 8 — los dueños viven en el archivo real', () => {
  it('el gate INSERT-ONLY está en la puerta de cierre (cierre.ts)', () => {
    expect(gateInsertoUnicoEnCierre(fuenteDe('src/voice/conversation/cierre.ts'))).toBe(true)
  })

  it('la fila es inmutable en fila.ts: construirFila vivo, sin promotores', () => {
    expect(filaInmutableEnFila(fuenteDe('src/voice/conversation/fila.ts'))).toBe(true)
  })

  it('los almacenes (Dexie y memoria) solo actualizan la etiqueta y su evidencia', () => {
    expect(actualizarSoloEtiqueta(fuenteDe('src/voice/conversation/adaptersAlmacen.ts'))).toBe(true)
    expect(actualizarSoloEtiqueta(fuenteDe('src/voice/conversation/adapters.ts'))).toBe(true)
  })
})

describe('Caso 8 — PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('un cierre sin el gate => rojo; con el gate => verde', () => {
    const sinGate = 'const fila = await almacen.guardar(resultado.fila)\n  estado.filas.set(fila.locutionId, fila)'
    expect(gateInsertoUnicoEnCierre(sinGate)).toBe(false)
    const conGate =
      'const previaDelTurno = filaDelTurno(cierre.turnId)\nif (previaDelTurno && !vozDistintaMedida) { contarDescarte(\'turnoYaEscrito\', locucion.locutionId, tramo) }'
    expect(gateInsertoUnicoEnCierre(conGate)).toBe(true)
  })

  it('un promotor vivo en fila.ts => rojo; fila inmutable => verde', () => {
    expect(filaInmutableEnFila('export function construirFila() {}\nexport function promoverFila() {}')).toBe(false)
    expect(filaInmutableEnFila('export function construirFila() {}')).toBe(true)
  })

  it('un almacén que actualiza el texto en vez de la etiqueta => rojo', () => {
    expect(actualizarSoloEtiqueta('texto: cambios.texto ?? anterior.texto')).toBe(false)
    expect(actualizarSoloEtiqueta('etiqueta: cambios.etiqueta ?? anterior.etiqueta')).toBe(false)
    const soloEtiqueta =
      'etiqueta: cambios.etiqueta ?? previa.etiqueta, evidencia: cambios.evidencia ?? previa.evidencia'
    expect(actualizarSoloEtiqueta(soloEtiqueta)).toBe(true)
  })
})
