// @vitest-environment node
/**
 * CASO 10 (ETIQUETAS) — regla de continuidad y high-water de voces.
 *
 * Criterio del encargo: 1 ancla + 2 voces => exactamente 2 etiquetas; el
 * high-water (`Hablante N`) NO sube por reemisión, revisión ni duplicado; sin
 * medida positiva NO hay continuidad (mandato 2026-10-30: cae a la semilla,
 * nunca se acuña por turno). Decisión B: la fila NO lleva identidad persistente
 * (ni vozId ni vector ni ancla); SÍ lleva su FIRMA — el timbre medido del turno —
 * porque el vínculo fila↔voz es POR TIMBRE (mandato 2026-10-11/13): la firma es
 * evidencia de la fila, no la identidad de la voz (que vive solo en la sesión).
 *
 * Se mide con el MÓDULO REAL y un embebedor falso de vectores deterministas:
 * la medida ocurre al cerrar (locución corta, sin medida temprana) y la
 * identidad la decide `decidirIdentidad` contra el umbral 0,8.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { crearConversacion } from '../src/voice/conversation/index'
import { decidirIdentidad } from '../src/voice/conversation/identidad'
import type {
  AsrIngestado,
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
import type { ConfigPort, EmbebedorPort, MedidaVad } from '../src/voice/conversation/ports'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'

const SAMPLE_RATE = 16000
const VOZ_A: readonly number[] = [1, 0, 0]
const VOZ_B: readonly number[] = [0, 1, 0]

const fuenteFila = (): string =>
  readFileSync(join(process.cwd(), 'src/voice/conversation/ports.ts'), 'utf8')

/** Región del tipo `Fila` (contrato de la fila canónica). */
export function regionDelTipoFila(src: string): string {
  const ini = src.indexOf('export type Fila = Readonly<{')
  if (ini < 0) return ''
  const lineas = src.slice(ini).split('\n')
  for (let i = 1; i < lineas.length; i += 1) {
    if (/^\}>$/.test(lineas[i])) return lineas.slice(0, i + 1).join('\n')
  }
  return ''
}

/** ¿La fila declara identidad persistente de voz? Prohibido (Decisión B). */
export function filaConIdentidadPersistente(src: string): boolean {
  const region = regionDelTipoFila(src)
  return /\b(?:vozId|vector|ancla|embedding)\b/i.test(region)
}

/**
 * ¿La fila declara su FIRMA? Obligatorio (mandato 2026-10-11/13): la firma es el
 * timbre medido del turno — evidencia del vínculo fila↔voz por timbre —, NO la
 * identidad persistente de la voz (Decisión B sigue intacta).
 */
export function filaLlevaFirma(src: string): boolean {
  const region = regionDelTipoFila(src)
  return /\bfirma\b/.test(region)
}

/** ¿El punto de llamada resuelve la plantilla de etiqueta de forma PEREZOSA? */
export function etiquetaNuevaPerezosa(src: string): boolean {
  return /etiquetaNueva:\s*\(\)\s*=>/.test(src)
}

const fuenteDe = (ruta: string): string =>
  readFileSync(join(process.cwd(), ruta), 'utf8')

const VOZ = (silencioMs = 0): MedidaVad => ({ hayVoz: true, silencioMs })
const SILENCIO = (silencioMs: number): MedidaVad => ({ hayVoz: false, silencioMs })

/** Cursor de muestras de la sesión sintética (una línea de audio continua). */
let cursor = 0

/** Embebedor falso: la voz actual la decide el test; coseno = producto punto. */
function crearEmbebedor(): EmbebedorPort & { ponerVoz(vector: readonly number[]): void } {
  let vozActual: readonly number[] = VOZ_A
  return {
    ponerVoz: (vector: readonly number[]) => {
      vozActual = vector
    },
    medir: async (): Promise<readonly number[] | null> => vozActual,
    comparar: (a: readonly number[], b: readonly number[]): number =>
      a.reduce((suma, valor, i) => suma + valor * (b[i] ?? 0), 0),
  }
}

type Escenario = Readonly<{
  api: ConversacionApi
  eventos: EventoConversacion[]
  embebedor: ReturnType<typeof crearEmbebedor>
  /** Índices con los que se pidió etiqueta anónima (`Hablante N`). */
  peticionesEtiqueta: number[]
}>

function crearEscenario(conEmbebedor: boolean): Escenario {
  cursor = 0
  const reloj = { ahora: () => 1_700_000_000_000 }
  const peticionesEtiqueta: number[] = []
  const config: ConfigPort = {
    wakeWords: () => ['ok flu'],
    semillaEtiqueta: () => 'Hablante 1',
    esEtiquetaAnonima: isAutoSpeakerLabel,
    umbralContinuidadVoz: () => 0.8,
    etiquetaAnonima: (indice) => {
      peticionesEtiqueta.push(indice)
      return `Hablante ${indice}`
    },
    echoMinPalabrasCola: () => 4,
  }
  const embebedor = crearEmbebedor()
  const dependencias: DependenciasConversacion = {
    reloj,
    id: crearIdUuid(),
    registro: { registrar: () => undefined },
    almacen: crearAlmacenMemoria({ reloj }),
    config,
    partidor: crearPartidorWake(config),
    medidor: crearMedidorTramo(),
    ultimoTextoDicho: () => '',
    embebedor: conEmbebedor ? embebedor : undefined,
  }
  const api = crearConversacion(dependencias)
  const eventos: EventoConversacion[] = []
  api.subscribe((evento) => eventos.push(evento))
  return { api, eventos, embebedor, peticionesEtiqueta }
}

/** Locución completa: pausa de 900 ms (corta el tramo anterior), 1 s de voz,
 * revisiones del texto y final que marca; cierra SOLO por la puerta de abajo
 * (5 s de silencio, mandato 2026-10-30: el final no cierra por contenido).
 * Devuelve el `tramoId` de la locución. */
async function locucion(
  escenario: Escenario,
  texto: string,
  revisiones: string[] = [],
): Promise<string> {
  const { api } = escenario
  // Pausa real entre locuciones: el corte de silencio libera el tramo anterior
  // (el cierre por final lo conserva a propósito para atribuir finales tardíos).
  await api.ingestAudio({
    muestras: new Float32Array(SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
    inicio: cursor,
    fin: cursor + SAMPLE_RATE,
    medida: SILENCIO(900),
  })
  cursor += SAMPLE_RATE
  const estado = await api.ingestAudio({
    muestras: new Float32Array(SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
    inicio: cursor,
    fin: cursor + SAMPLE_RATE,
    medida: VOZ(),
  })
  cursor += SAMPLE_RATE
  const tramoId = estado.locucionAbierta?.locutionId
  if (!tramoId) throw new Error('el audio con voz no abrio locucion')
  for (const revision of revisiones) {
    await api.ingestAsr({ tramoId, texto: revision, final: false })
  }
  const final: AsrIngestado = { tramoId, texto, final: true }
  await api.ingestAsr(final)
  // Mandato 2026-10-30: el final marca la frase completa pero NO cierra; la
  // locución cierra SOLO por silencio (5 s sin texto ajeno) o cambio de voz.
  const muestrasCierre = Math.round((SAMPLE_RATE * 5000) / 1000)
  await api.ingestAudio({
    muestras: new Float32Array(muestrasCierre),
    sampleRate: SAMPLE_RATE,
    inicio: cursor,
    fin: cursor + muestrasCierre,
    medida: SILENCIO(5000),
  })
  cursor += muestrasCierre
  return tramoId
}

describe('Caso 10 — 1 ancla + 2 voces => exactamente 2 etiquetas (módulo real)', () => {
  it('voz A, voz A, voz B: dos etiquetas y el high-water no pasa de 2', async () => {
    const escenario = crearEscenario(true)
    await escenario.api.start()

    await locucion(escenario, 'frase de la ancla') // voz A -> Hablante 1
    await locucion(escenario, 'otra frase de la ancla') // voz A -> continuidad
    escenario.embebedor.ponerVoz(VOZ_B)
    await locucion(escenario, 'frase de la segunda voz') // voz B -> Hablante 2

    const filas = escenario.api.snapshot().filas
    expect(filas).toHaveLength(3)
    expect(new Set(filas.map((fila) => fila.etiqueta))).toEqual(
      new Set(['Hablante 1', 'Hablante 2']),
    )
    expect(filas[0]!.evidencia).toBe('medida')
    // La 2ª de A casó SU plantilla: la etiqueta sale de la plantilla (medida),
    // no de la continuidad con la fila anterior.
    expect(filas[1]!.evidencia).toBe('medida')
    expect(filas[2]!.evidencia).toBe('medida')
    expect(Math.max(...escenario.peticionesEtiqueta, 0)).toBe(2)
  })

  it('reemisión, revisión y duplicado NO suben el high-water', async () => {
    const escenario = crearEscenario(true)
    await escenario.api.start()

    await locucion(escenario, 'uno', ['u', 'un']) // voz A, con revisiones: sin acuñar
    await locucion(escenario, 'uno extendido') // duplicado consecutivo de A: continuidad
    escenario.embebedor.ponerVoz(VOZ_B)
    const tramoB = await locucion(escenario, 'dos', ['d', 'do']) // voz B -> Hablante 2
    // Reemisión del MISMO tramo tras el cierre: la reentrega se ignora
    // (insert-only 2026-10-30, `tramoYaCommiteado` en texto.ts); la fila
    // commiteada es inmutable y la reentrega NO acuña etiqueta nueva.
    await escenario.api.ingestAsr({ tramoId: tramoB, texto: 'dos mejorado', final: true })

    const filas = escenario.api.snapshot().filas
    expect(filas).toHaveLength(3)
    expect(filas[2]!.texto).toBe('dos')
    expect(new Set(filas.map((fila) => fila.etiqueta))).toEqual(
      new Set(['Hablante 1', 'Hablante 2']),
    )
    // Una acuñación por voz nueva (índices 1 y 2); nada más se acuñó.
    expect(escenario.peticionesEtiqueta).toEqual([1, 2])
  })

  it('la fila commiteada NO lleva identidad persistente (Decisión B) pero SÍ su firma', async () => {
    const escenario = crearEscenario(true)
    await escenario.api.start()
    await locucion(escenario, 'frase')
    const fila = escenario.api.snapshot().filas[0]
    if (!fila) throw new Error('sin fila')
    // Decisión B: nada de identidad acústica persistente en la fila.
    for (const clave of ['vozId', 'vector', 'ancla']) {
      expect(fila).not.toHaveProperty(clave)
    }
    // Mandato 2026-10-11/13: la fila SÍ lleva su firma (el timbre medido del
    // turno) — es la evidencia con la que la vista la liga a su voz por timbre.
    expect(fila.firma).toEqual(VOZ_A)
    expect(Object.keys(fila).sort()).toEqual([
      'deleted',
      'etiqueta',
      'evidencia',
      'firma',
      'idioma',
      'locutionId',
      'overlap',
      'provisional',
      'reason',
      'revision',
      'sessionId',
      'texto',
      'tramo',
      'turnId',
      'updated_at',
    ])
  })
})

describe('Caso 10 — sin vector NO hay continuidad (mandato 2026-10-30): cae a la semilla, sin acuñar', () => {
  it('tres locuciones sin embebedor: una sola etiqueta y cero acuñaciones', async () => {
    const escenario = crearEscenario(false)
    await escenario.api.start()
    await locucion(escenario, 'primera')
    await locucion(escenario, 'segunda')
    await locucion(escenario, 'tercera')
    const filas = escenario.api.snapshot().filas
    expect(filas).toHaveLength(3)
    expect(new Set(filas.map((fila) => fila.etiqueta))).toEqual(new Set(['Hablante 1']))
    expect(filas[0]!.evidencia).toBe('semilla')
    expect(filas[1]!.evidencia).toBe('semilla')
    expect(filas[2]!.evidencia).toBe('semilla')
    expect(escenario.peticionesEtiqueta).toEqual([])
  })
})

describe('Caso 10 — la fila sin identidad persistente vive en el archivo real', () => {
  it('el tipo Fila no declara vozId, vector ni ancla (Decisión B)', () => {
    expect(filaConIdentidadPersistente(fuenteFila())).toBe(false)
  })

  it('el tipo Fila declara la firma (vínculo por timbre, mandato 2026-10-11/13)', () => {
    expect(filaLlevaFirma(fuenteFila())).toBe(true)
  })
})

describe('Caso 10 — la etiqueta nueva se resuelve SOLO para voz nueva (proveedor perezoso)', () => {
  it('continuidad => el proveedor NO se llama; voz nueva => UNA llamada', () => {
    let llamadas = 0
    const proveedor = () => {
      llamadas += 1
      return `Hablante ${llamadas}`
    }
    const base = {
      vector: VOZ_A,
      umbral: 0.8,
      comparar: (a: readonly number[], b: readonly number[]) => a[0]! * b[0]!,
      id: () => '11111111-1111-4111-8111-111111111111',
      etiquetaNueva: proveedor,
    }
    const continua = decidirIdentidad({
      ...base,
      plantillas: [{ vozId: 'voz-a', vector: VOZ_A, etiqueta: 'Hablante 1' }],
    })
    expect(continua.continuidad).toBe(true)
    expect(continua.hablante, 'la continuidad devuelve la etiqueta de su plantilla').toBe('Hablante 1')
    expect(llamadas).toBe(0)

    const nueva = decidirIdentidad({ ...base, plantillas: [] })
    expect(nueva.continuidad).toBe(false)
    expect(nueva.hablante).toBe('Hablante 1')
    expect(llamadas).toBe(1)
  })
})

describe('Caso 10 — la plantilla perezosa vive en los puntos de llamada reales', () => {
  it('cierre, ingesta y resolucion pasiva pasan un proveedor, no la etiqueta', () => {
    expect(etiquetaNuevaPerezosa(fuenteDe('src/voice/conversation/cierre.ts'))).toBe(true)
    expect(etiquetaNuevaPerezosa(fuenteDe('src/voice/conversation/ingesta.ts'))).toBe(true)
    expect(etiquetaNuevaPerezosa(fuenteDe('src/voice/conversation/pasivo.ts'))).toBe(true)
  })
})

// Prueba de detector: infractor sintético => marca; código legítimo => no.
describe('Caso 10 — el detector no es decorativo', () => {
  const filaSana =
    'export type Fila = Readonly<{\n  locutionId: string\n  etiqueta: string\n  tramo: TramoMuestreado\n}>'
  const filaInfractora =
    'export type Fila = Readonly<{\n  locutionId: string\n  etiqueta: string\n  vozId: string\n  tramo: TramoMuestreado\n}>'

  it('fila con vozId => rojo; fila sin identidad => verde', () => {
    expect(filaConIdentidadPersistente(filaInfractora)).toBe(true)
    expect(filaConIdentidadPersistente(filaSana)).toBe(false)
  })

  it('fila sin firma => rojo en el vínculo por timbre; con firma => verde', () => {
    expect(filaLlevaFirma(filaSana)).toBe(false)
    expect(filaLlevaFirma(filaInfractora)).toBe(false)
    const filaConFirma =
      'export type Fila = Readonly<{\n  locutionId: string\n  etiqueta: string\n  firma: readonly number[] | null\n  tramo: TramoMuestreado\n}>'
    expect(filaLlevaFirma(filaConFirma)).toBe(true)
    expect(filaConIdentidadPersistente(filaConFirma), 'la firma NO es identidad persistente').toBe(false)
  })

  it('plantilla ansiosa => rojo; proveedor perezoso => verde', () => {
    const ansioso = "const identidad = decidirIdentidad({\n  etiquetaNueva: config.etiquetaAnonima(estado.contadorVoces + 1),\n})"
    const perezoso = "const identidad = decidirIdentidad({\n  etiquetaNueva: () => config.etiquetaAnonima(estado.contadorVoces + 1),\n})"
    expect(etiquetaNuevaPerezosa(ansioso)).toBe(false)
    expect(etiquetaNuevaPerezosa(perezoso)).toBe(true)
  })
})
