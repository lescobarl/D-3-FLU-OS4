// @vitest-environment node
/**
 * CASO 2 (UNA LOCUCIÓN = UNA FILA) — guard de comportamiento.
 *
 * Criterio del encargo (insert-only, mandato del dueño 2026-10-30): la fila se
 * identifica por el LOCUTION; el almacén (memoria y Dexie) hace UPSERT por
 * `locutionId` — repetir la misma locución incrementa `revision`, nunca crea
 * una segunda fila. La fila commiteada es INMUTABLE (sin consolidación ni
 * promoción): dos turnos distintos con la misma frase son DOS filas.
 * `transcriptionDedupLoss` (invariante 14) sigue siendo el muro de la no-pérdida.
 *
 * Qué mide este guard (lo que NO miden los otros casos):
 *  - identidad por locución: el almacén (memoria y Dexie) hace UPSERT por
 *    `locutionId` — repetir la misma locución incrementa `revision`, nunca
 *    crea una segunda fila (la dedupe `turnId+locutionId`);
 *  - el borde SOLO: un turno DISTINTO con la misma frase y ventana solapada
 *    abre su fila — cada locución es su fila (insert-only);
 *  - la identidad de la fila es la LOCUCIÓN (clave UUID), sin criterio de texto.
 *
 * Se mide con el MÓDULO REAL y los almacenes REALES (memoria y Dexie sobre un
 * `DbLike` falso en memoria). Los detectores viven en el código real.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { crearConversacion } from '../src/voice/conversation/index'
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
import { crearAlmacenDexie } from '../src/voice/conversation/adaptersAlmacen.ts'
import type { DbLike, RegistroFila } from '../src/voice/conversation/adaptersAlmacen.ts'
import type { ConfigPort, Fila, FilaNueva, MedidaVad } from '../src/voice/conversation/ports'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'

const SAMPLE_RATE = 16000
const UUID_A = '11111111-1111-4111-8111-111111111111'

const fuenteDe = (ruta: string): string =>
  readFileSync(join(process.cwd(), ruta), 'utf8')

/** ¿El almacén en memoria hace upsert por `locutionId` (lee la previa y pisa)? */
export function upsertMemoriaPorLocucion(src: string): boolean {
  return /filas\.get\(fila\.locutionId\)/.test(src) && /filas\.set\(guardada\.locutionId, guardada\)/.test(src)
}

/** ¿El almacén Dexie relee la fila por `locutionId` y reemplaza (upsert)? */
export function upsertDexiePorLocucion(src: string): boolean {
  return /db\.leer\(fila\.locutionId\)/.test(src) && /db\.escribir\(registro\)/.test(src)
}

/** ¿La fila persistida usa el locutionId como CLAVE y escribe con `put` (nunca add)? */
export function claveFilaEsLocucion(src: string): boolean {
  return /id: registro\.locutionId/.test(src) && /fluDb\.conversations\.put\(fila\)/.test(src)
}

/** ¿La identidad de la fila es la LOCUCIÓN (clave UUID), sin criterio de texto? */
export function identidadDeFilaEsLocucion(src: string): boolean {
  return /UUID_V4/.test(src) && !/\.texto\s*===/.test(src)
}

const VOZ = (): MedidaVad => ({ hayVoz: true, silencioMs: 0 })
const SILENCIO = (silencioMs: number): MedidaVad => ({ hayVoz: false, silencioMs })

/** Fila nueva de prueba (datos del test; los dueños son los reales). */
const filaNueva = (locutionId: string, texto: string): FilaNueva => ({
  locutionId,
  sessionId: 'sesion-guard',
  turnId: 'turno-guard',
  texto,
  tramo: { inicio: 0, fin: SAMPLE_RATE, sampleRate: SAMPLE_RATE },
  etiqueta: 'Hablante 1',
  evidencia: 'semilla',
  firma: null,
  idioma: 'es',
  overlap: false,
  provisional: false,
  reason: 'system',
})

/** `DbLike` falso en memoria: un Mapa por `locutionId`, como la tabla Dexie. */
function crearDbFalso() {
  const filas = new Map<string, RegistroFila>()
  const db: DbLike = {
    leer: async (locutionId) => filas.get(locutionId),
    escribir: async (registro) => {
      filas.set(registro.locutionId, registro)
    },
    transaccion: async (operacion) => operacion(),
  }
  return { db, tamano: () => filas.size, leer: (id: string) => filas.get(id) }
}

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
 * Locución completa: pausa de 900 ms (separa de la locución anterior), 1 s de voz
 * que abre el tramo, texto del ASR con final y corte de `silenceCloseMs` (5000 ms)
 * que cierra por silencio (la puerta de abajo, C1). Devuelve la instantánea del
 * bloque de voz.
 */
async function locucion(
  escenario: Escenario,
  texto: string,
  turnId: string,
  turnoAudio: string | undefined,
  inicio?: number,
): Promise<InstantaneaConversacion> {
  const { api } = escenario
  await entregarAudio(api, SILENCIO(900), cursor, turnoAudio)
  const conVoz = await entregarAudio(api, VOZ(), inicio ?? cursor, turnoAudio)
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
  return conVoz
}

describe('Caso 2 — identidad por locución: el almacén hace upsert, nunca inserta doble', () => {
  it('memoria: guardar la MISMA locución dos veces => una fila con revision 2', async () => {
    const reloj = { ahora: () => 1_700_000_000_000 }
    const almacen = crearAlmacenMemoria({ reloj })
    const primera = await almacen.guardar(filaNueva(UUID_A, 'ok flu crea una cita'))
    const segunda = await almacen.guardar(filaNueva(UUID_A, 'ok flu crea una cita manana'))

    expect(primera.revision).toBe(1)
    expect(segunda.locutionId).toBe(primera.locutionId)
    expect(segunda.revision).toBe(2)
    expect(segunda.texto).toBe('ok flu crea una cita manana')
  })

  it('Dexie: repetir la misma locución deja UNA sola fila y la revisión crece', async () => {
    const reloj = { ahora: () => 1_700_000_000_000 }
    const { db, tamano, leer } = crearDbFalso()
    const almacen = crearAlmacenDexie({
      db,
      reloj,
      sincronizar: (previo, ahora) => ({
        revision: (previo?.revision ?? 0) + 1,
        updated_at: new Date(ahora).toISOString(),
        deleted: previo?.deleted ?? false,
      }),
    })

    const primera = await almacen.guardar(filaNueva(UUID_A, 'ok flu crea una cita'))
    const segunda = await almacen.guardar(filaNueva(UUID_A, 'ok flu crea una cita manana'))

    expect(tamano()).toBe(1)
    expect(segunda.locutionId).toBe(UUID_A)
    expect(segunda.revision).toBe(2)
    expect(segunda.texto).toBe('ok flu crea una cita manana')
    expect(primera.revision).toBe(1)
    expect(leer(UUID_A)?.sync.revision).toBe(2)
  })

  it('Dexie: actualizar una locución inexistente devuelve null (sin fila fantasma)', async () => {
    const reloj = { ahora: () => 1_700_000_000_000 }
    const { db, tamano } = crearDbFalso()
    const almacen = crearAlmacenDexie({
      db,
      reloj,
      sincronizar: (previo, ahora) => ({
        revision: (previo?.revision ?? 0) + 1,
        updated_at: new Date(ahora).toISOString(),
        deleted: previo?.deleted ?? false,
      }),
    })

    const resultado = await almacen.actualizar(UUID_A, { etiqueta: 'Luis' })
    expect(resultado).toBeNull()
    expect(tamano()).toBe(0)
  })
})

describe('Caso 2 — el borde SOLO: el solape no cruza turnos (módulo real)', () => {
  it('dos turnos DISTINTOS con la misma frase y ventana SOLAPADA => DOS filas', async () => {
    const escenario = crearEscenario()
    await escenario.api.start({ turnId: 'T5' })
    await locucion(escenario, 'ok flu pon una alarma', 'T5', undefined)
    const previa = filasDe(escenario.api)[0]
    if (!previa) throw new Error('sin fila')

    // El turno T6 re-escucha el MISMO audio (ventana solapada) con la MISMA
    // frase: es OTRO turno, no una reemisión del T5 — fila nueva.
    await locucion(
      escenario,
      'ok flu pon una alarma',
      'T6',
      'T6',
      previa.tramo.fin - 8000,
    )

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(2)
    expect(filas[0]!.turnId).toBe('T5')
    expect(filas[1]!.turnId).toBe('T6')
    expect(filas[1]!.texto).toBe('ok flu pon una alarma')
  })

  // El lado positivo del solape (mismo turno, ventana solapada, texto que crece
  // => UNA fila) lo mide el guard del Caso 8; no se duplica aquí.
})

describe('Caso 2 — los dueños viven en el archivo real', () => {
  it('el almacén en memoria relee y pisa por locutionId (adapters.ts)', () => {
    expect(upsertMemoriaPorLocucion(fuenteDe('src/voice/conversation/adapters.ts'))).toBe(true)
  })

  it('el almacén Dexie relee por locutionId y reemplaza (adaptersAlmacen.ts)', () => {
    expect(upsertDexiePorLocucion(fuenteDe('src/voice/conversation/adaptersAlmacen.ts'))).toBe(true)
  })

  it('la fila persistida usa el locutionId como clave y escribe con put (conversationRowWriter.ts)', () => {
    expect(claveFilaEsLocucion(fuenteDe('src/core/db/conversationRowWriter.ts'))).toBe(true)
  })

  it('la identidad de la fila es la LOCUCIÓN (UUID), no el texto (fila.ts)', () => {
    expect(identidadDeFilaEsLocucion(fuenteDe('src/voice/conversation/fila.ts'))).toBe(true)
  })
})

describe('Caso 2 — PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('un guardar sin leer la previa ni pisar => rojo; con ambos => verde', () => {
    const sinUpsert = 'guardar: async (fila) => {\n  filas.set(fila.locutionId, fila)\n  return fila\n}'
    expect(upsertMemoriaPorLocucion(sinUpsert)).toBe(false)
    const conUpsert =
      'const previa = filas.get(fila.locutionId)\n  filas.set(guardada.locutionId, guardada)'
    expect(upsertMemoriaPorLocucion(conUpsert)).toBe(true)
  })

  it('un Dexie que inserta sin releer => rojo; con leer+escribir => verde', () => {
    const sinLeer = 'db.escribir(registro)\nreturn aFila(registro)'
    expect(upsertDexiePorLocucion(sinLeer)).toBe(false)
    const conUpsert = 'const previo = await db.leer(fila.locutionId)\n  await db.escribir(registro)'
    expect(upsertDexiePorLocucion(conUpsert)).toBe(true)
  })

  it('una fila con id ajeno o escrita con add => rojo; con la clave y put => verde', () => {
    const idAjeno = 'id: uuidv4(),\nrole: \'user\'\n...\nawait fluDb.conversations.put(fila)'
    expect(claveFilaEsLocucion(idAjeno)).toBe(false)
    const conAdd = 'id: registro.locutionId,\nawait fluDb.conversations.add(fila)'
    expect(claveFilaEsLocucion(conAdd)).toBe(false)
    const sano = 'id: registro.locutionId,\nawait fluDb.conversations.put(fila)'
    expect(claveFilaEsLocucion(sano)).toBe(true)
  })

  it('un criterio de reemisión por texto => rojo; por locución => verde', () => {
    const porTexto = 'const misma = nueva.texto === previa.texto'
    expect(identidadDeFilaEsLocucion(porTexto)).toBe(false)
    const porLocucion = 'const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}/'
    expect(identidadDeFilaEsLocucion(porLocucion)).toBe(true)
  })
})
