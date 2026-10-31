// @vitest-environment node
/**
 * CASO 1+3 (ETIQUETAS Y MEZCLA) — guard de comportamiento.
 *
 * Criterio del encargo: misma voz => misma etiqueta; voz distinta medida =>
 * etiqueta nueva; el high-water no sube por reemisión/revisión/duplicado
 * (Caso 10); dentro de un tramo continuo no se cambia de etiqueta; DOS voces
 * sin pausa => DOS filas, nunca una mezclada. Se parte por cambio de voz
 * detectado con los vectores de la locución; sin identidad persistente
 * (DECISIÓN B: la comparación usa el último vector de la SESIÓN).
 *
 * Qué mide este guard (lo que NO miden los otros casos):
 *  - la PARTICIÓN por cambio de voz dentro del tramo abierto: mide la ventana
 *    de cola del PCM retenido, la compara contra el último vector de la sesión
 *    y, sin casar, cierra la locución anterior (causa 'voz') y abre la nueva
 *    con SU etiqueta — el texto del evento se atribuye a la voz nueva;
 *  - dos voces sin pausa => DOS filas contiguas y etiquetadas, nunca una fila
 *    mezclada;
 *  - misma voz en tramo continuo => UNA fila, UNA etiqueta (no cambia dentro
 *    del tramo) y texto que crece;
 *  - mandato insert-only (2026-10-30): la fila commiteada es INMUTABLE — la
 *    continuación de la voz B NO reescribe la fila DE B: se cuenta como
 *    reentrega del turno (descarte 'turnoYaEscrito'), nunca un UPDATE.
 *
 * Se mide con el MÓDULO REAL y un embebedor falso de vectores; los detectores
 * viven en el código real.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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
import type {
  ConfigPort,
  EmbebedorPort,
  Fila,
  MedidaVad,
} from '../src/voice/conversation/ports'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'

const SAMPLE_RATE = 16000
/** Vectores unitarios distintos: coseno 0 entre sí (por debajo del umbral 0,8). */
const VECTOR_A = [1, 0] as const
const VECTOR_B = [0, 1] as const

const fuenteDe = (ruta: string): string =>
  readFileSync(join(process.cwd(), ruta), 'utf8')

/** ¿La partición por cambio de voz vive en la ingesta (dueño único)? */
export function particionPorCambioDeVoz(src: string): boolean {
  return /function partirLocucionPorVoz/.test(src) && /function verificarCambioVoz/.test(src)
}

/**
 * ¿El resultado ASR pasa por la atribución y por la verificación de cambio ANTES
 * del flujo de texto? La atribución va PRIMERA: un texto de la frase abierta no
 * puede verificar el cambio de voz de un tramo ajeno.
 */
export function verificacionAntesDelFlujoDeTexto(src: string): boolean {
  return (
    /const tramoAtribuido = tramoDestinoDeTexto\(tramoId, entrada\.texto\)/.test(src) &&
    /verificarCambioVoz\(tramoAtribuido\)/.test(src) &&
    /procesarResultadoAsr\(\{ \.\.\.entrada, tramoId: tramoDestino \}\)/.test(src)
  )
}

/** ¿La puerta insert-only exige una voz DISTINTA medida para escribir una fila? */
export function insertOnlyExigeVozDistinta(src: string): boolean {
  return /const vozDistintaMedida =/.test(src) && /previaDelTurno && !vozDistintaMedida/.test(src)
}

/** ¿La voz que cierra consolida SU fila: casa por etiqueta y cae a la más reciente? */
export function filaDelTurnoCasaEtiqueta(src: string): boolean {
  return /fila\.etiqueta === etiqueta/.test(src) && /reciente = fila/.test(src)
}

/** ¿La causa 'voz' existe en la unión de causas de cierre? */
export function causaVozEnLaUnion(src: string): boolean {
  return /CausaCierre = [^\n]*'voz'/.test(src)
}

const VOZ = (): MedidaVad => ({ hayVoz: true, silencioMs: 0 })
const SILENCIO = (silencioMs: number): MedidaVad => ({ hayVoz: false, silencioMs })

/** Embebedor falso: la llamada i devuelve `vectores[i]` (la última se repite). */
function crearEmbebedorFalso(
  ...vectores: readonly (readonly number[])[]
): EmbebedorPort {
  let llamadas = 0
  return {
    medir: async () => {
      const indice = Math.min(llamadas, vectores.length - 1)
      llamadas += 1
      return vectores[indice] ?? null
    },
    comparar: (a, b) =>
      a.length === b.length ? a.reduce((suma, valor, i) => suma + valor * (b[i] ?? 0), 0) : 0,
  }
}

/** Cursor de muestras de la sesión sintética (una línea de audio continua). */
let cursor = 0

type Escenario = Readonly<{ api: ConversacionApi }>

/** Monta el módulo REAL sobre el embebedor inyectado (la medida es del puerto). */
function crearEscenarioConEmbebedor(embebedor: EmbebedorPort): Escenario {
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
    embebedor,
  }
  return { api: crearConversacion(dependencias) }
}

function crearEscenario(
  ...vectores: readonly (readonly number[])[]
): Escenario {
  return crearEscenarioConEmbebedor(crearEmbebedorFalso(...vectores))
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

/** Silencio de 5 s (puerta de abajo): cierra la locución abierta (mandato 2026-10-30). */
async function cerrarPorSilencio(api: ConversacionApi): Promise<void> {
  const abierta = api.snapshot().locucionAbierta
  if (!abierta) throw new Error('sin locucion abierta para cerrar')
  const fin = abierta.tramo.fin
  await api.ingestAudio({
    muestras: new Float32Array(5 * SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
    inicio: fin,
    fin: fin + 5 * SAMPLE_RATE,
    medida: SILENCIO(5000),
  })
  cursor = Math.max(cursor, fin + 5 * SAMPLE_RATE)
}

/** Silencio de `ms` entregado en `inicio`: corta el tramo, no cierra salvo 5 s. */
async function entregarSilencio(
  api: ConversacionApi,
  inicio: number,
  ms: number,
): Promise<void> {
  const muestras = Math.round((SAMPLE_RATE * ms) / 1000)
  await api.ingestAudio({
    muestras: new Float32Array(muestras),
    sampleRate: SAMPLE_RATE,
    inicio,
    fin: inicio + muestras,
    medida: SILENCIO(ms),
  })
  cursor = Math.max(cursor, inicio + muestras)
}

/**
 * Audio con VOZ en bloques CORTOS: el AudioWorklet entrega 128 muestras por
 * bloque (medido en 89a0d948), así que la ingesta recibe cientos de bloques por
 * segundo de habla.
 */
async function entregarBloques(
  api: ConversacionApi,
  inicio: number,
  total: number,
  bloque: number,
): Promise<void> {
  for (let offset = 0; offset < total; offset += bloque) {
    const fin = Math.min(offset + bloque, total)
    await api.ingestAudio({
      muestras: new Float32Array(fin - offset),
      sampleRate: SAMPLE_RATE,
      inicio: inicio + offset,
      fin: inicio + fin,
      medida: VOZ(),
    })
  }
  cursor = Math.max(cursor, inicio + total)
}

/** Evento ASR final del turno (el módulo resuelve el tramo vigente). */
async function frase(
  api: ConversacionApi,
  texto: string,
  turnId: string,
): Promise<void> {
  await api.ingestAsr({ tramoId: '', texto, final: true, turnId })
}

describe('Caso 1+3 — dos voces SIN pausa (módulo real, embebedor falso)', () => {
  it('dos voces sin pausa => DOS filas contiguas con SU etiqueta (causa voz)', async () => {
    const escenario = crearEscenario(VECTOR_A, VECTOR_B)
    const eventos: EventoConversacion[] = []
    escenario.api.subscribe((evento) => eventos.push(evento))
    await escenario.api.start({ turnId: 'T5' })

    // Voz A: 2 s seguidos; la medida temprana se lanza al alcanzar 1,5 s.
    await entregarAudio(escenario.api, VOZ(), cursor)
    await entregarAudio(escenario.api, VOZ(), cursor)
    await frase(escenario.api, 'ok flu crea una cita', 'T5')
    // Voz B SIN pausa: 2 s más; el evento siguiente dispara la verificación.
    await entregarAudio(escenario.api, VOZ(), cursor)
    await entregarAudio(escenario.api, VOZ(), cursor)
    await frase(escenario.api, 'con el doctor', 'T5')
    await cerrarPorSilencio(escenario.api)

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(2)
    expect(filas[0]).toMatchObject({
      turnId: 'T5',
      texto: 'ok flu crea una cita',
      etiqueta: 'Hablante 1',
      tramo: { inicio: 0, fin: 40000, sampleRate: SAMPLE_RATE },
    })
    expect(filas[1]).toMatchObject({
      turnId: 'T5',
      texto: 'con el doctor',
      etiqueta: 'Hablante 2',
      tramo: { inicio: 40000, fin: 64000, sampleRate: SAMPLE_RATE },
    })

    // El cierre de la voz anterior declara la causa de la partición.
    const causas = eventos
      .filter(
        (evento): evento is Extract<EventoConversacion, { tipo: 'locution.closed' }> =>
          evento.tipo === 'locution.closed',
      )
      .map((evento) => evento.causa)
    expect(causas).toContain('voz')
  })

  it('misma voz en tramo continuo => UNA fila, UNA etiqueta y texto que crece', async () => {
    const escenario = crearEscenario(VECTOR_A, VECTOR_A)
    await escenario.api.start({ turnId: 'T5' })

    await entregarAudio(escenario.api, VOZ(), cursor)
    await entregarAudio(escenario.api, VOZ(), cursor)
    await frase(escenario.api, 'ok flu crea una cita', 'T5')
    await entregarAudio(escenario.api, VOZ(), cursor)
    await entregarAudio(escenario.api, VOZ(), cursor)
    // La verificación mide la cola: misma voz => NO parte ni cambia etiqueta.
    await frase(escenario.api, 'ok flu crea una cita con el doctor', 'T5')
    await cerrarPorSilencio(escenario.api)

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({
      turnId: 'T5',
      texto: 'ok flu crea una cita con el doctor',
      etiqueta: 'Hablante 1',
      tramo: { inicio: 0, fin: 64000, sampleRate: SAMPLE_RATE },
    })
  })

  it('la reentrega del ASR que CONTINÚA la frase tras una pausa interna => UNA fila', async () => {
    // Medido en la sesión 263adae9: dos finales del MISMO enunciado (300 y 330
    // caracteres) separados por una pausa del VAD de ~1,5 s. La pausa NO es la
    // puerta de cierre (5 s): el texto que contiene la frase abierta la continúa
    // y la fila sale UNA vez con la frase completa, nunca duplicada.
    const escenario = crearEscenario()
    await escenario.api.start({ turnId: 'T5' })
    await entregarAudio(escenario.api, VOZ(), cursor)
    await entregarAudio(escenario.api, VOZ(), cursor)
    await frase(escenario.api, 'ok flu crea una cita', 'T5')
    // Pausa interna: corta el tramo (VAD 900 ms) pero la locución sigue abierta.
    await entregarSilencio(escenario.api, cursor, 1500)
    // La voz vuelve: tramo NUEVO; el ASR reemite la frase completa.
    await entregarAudio(escenario.api, VOZ(), cursor)
    await frase(escenario.api, 'ok flu crea una cita con el doctor', 'T5')
    await entregarSilencio(escenario.api, cursor, 5000)

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(1)
    expect(filas[0]!.texto).toBe('ok flu crea una cita con el doctor')
    expect(filas[0]!.etiqueta).toBe('Hablante 1')
  })

  it('la reentrega que CONTINÚA la frase durante el silencio (sin tramo vigente) => UNA fila', async () => {
    const escenario = crearEscenario()
    await escenario.api.start({ turnId: 'T5' })
    await entregarAudio(escenario.api, VOZ(), cursor)
    await entregarAudio(escenario.api, VOZ(), cursor)
    await frase(escenario.api, 'ok flu crea una cita', 'T5')
    await entregarSilencio(escenario.api, cursor, 1500)
    // El final completo llega con el silencio en curso (el producto pasa
    // tramoId vacío y ya lo trata como continuación de la línea abierta).
    await frase(escenario.api, 'ok flu crea una cita con el doctor', 'T5')
    await entregarSilencio(escenario.api, cursor, 5000)

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(1)
    expect(filas[0]!.texto).toBe('ok flu crea una cita con el doctor')
  })

  it('la medida temprana se lanza con audio NUEVO, no en cada bloque (freno)', async () => {
    // Medido en 89a0d948 (2026-10-31): sin freno la medida se relanzaba en CADA
    // bloque tras alcanzar 1,5 s (19.886 intentos y ~31.000 trazas en 182 s de
    // audio); cada intento copiaba todo el PCM retenido y la UI se congelaba.
    let medidas = 0
    const embebedor: EmbebedorPort = {
      medir: async () => {
        medidas += 1
        return null
      },
      comparar: () => 0,
    }
    const escenario = crearEscenarioConEmbebedor(embebedor)
    await escenario.api.start({ turnId: 'T5' })
    // 4 s de voz en bloques de 64 ms: un intento por bloque serían ~39.
    await entregarBloques(escenario.api, cursor, 4 * SAMPLE_RATE, 1024)

    // Un intento al llegar al mínimo (1,5 s) y otro por cada tramo NUEVO de
    // 1,5 s de audio: el fallo no se reintenta bloque a bloque.
    expect(medidas).toBeGreaterThanOrEqual(1)
    expect(medidas).toBeLessThanOrEqual(4)
  })

  it('el audio del tramo que CONTINÚA la frase entra en la medida (la fila se mide)', async () => {
    // El tramo de la continuación NO entra en vivo (solo el de la locución): su
    // audio se suma cuando el TEXTO se atribuye a la frase abierta. Sin eso la
    // medida se quedaba con el primer tramo (240 ms de voz medidos en
    // 89a0d948) y la fila nacía 'Hablante ?' para siempre.
    // El embebedor solo mide si el búfer trae la MARCA de la continuación (0,5).
    const embebedor: EmbebedorPort = {
      medir: async (muestras) => {
        let marca = 0
        for (const valor of muestras) if (valor === 0.5) marca += 1
        return marca >= 800 ? [1, 0] : null
      },
      comparar: (a, b) =>
        a.length === b.length ? a.reduce((suma, valor, i) => suma + valor * (b[i] ?? 0), 0) : 0,
    }
    const escenario = crearEscenarioConEmbebedor(embebedor)
    await escenario.api.start({ turnId: 'T5' })
    await entregarAudio(escenario.api, VOZ(), cursor)
    await entregarAudio(escenario.api, VOZ(), cursor)
    await frase(escenario.api, 'ok flu crea una cita', 'T5')
    // Pausa interna: corta el tramo pero la locución sigue abierta.
    await entregarSilencio(escenario.api, cursor, 1500)
    // La voz vuelve con SU audio (marcado): tramo NUEVO de la misma frase.
    await escenario.api.ingestAudio({
      muestras: new Float32Array(SAMPLE_RATE).fill(0.5),
      sampleRate: SAMPLE_RATE,
      inicio: cursor,
      fin: cursor + SAMPLE_RATE,
      medida: VOZ(),
    })
    cursor += SAMPLE_RATE
    await frase(escenario.api, 'ok flu crea una cita con el doctor', 'T5')
    await entregarSilencio(escenario.api, cursor, 5000)

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(1)
    expect(filas[0]!.texto).toBe('ok flu crea una cita con el doctor')
    // Medida POSITIVA (no la semilla): el búfer de la fila incluyó la
    // continuación, así que la voz se pudo medir y etiquetar.
    expect(filas[0]!.evidencia).toBe('medida')
    expect(filas[0]!.etiqueta).toBe('Hablante 1')
  })

  it('la continuación de la voz B NO reescribe la fila DE B (insert-only); la de A no se toca', async () => {
    const escenario = crearEscenario(VECTOR_A, VECTOR_B, VECTOR_B, VECTOR_B)
    await escenario.api.start({ turnId: 'T5' })

    // Voces A y B sin pausa: la partición deja dos filas.
    await entregarAudio(escenario.api, VOZ(), cursor)
    await entregarAudio(escenario.api, VOZ(), cursor)
    await frase(escenario.api, 'ok flu crea una cita', 'T5')
    await entregarAudio(escenario.api, VOZ(), cursor)
    await entregarAudio(escenario.api, VOZ(), cursor)
    await frase(escenario.api, 'con el doctor', 'T5')
    // La voz B sigue hablando sin pausa: su texto crece en SU locución.
    await entregarAudio(escenario.api, VOZ(), cursor)
    await entregarAudio(escenario.api, VOZ(), cursor)
    await frase(escenario.api, 'con el doctor a las tres', 'T5')
    await cerrarPorSilencio(escenario.api)

    // La voz B vuelve tras la pausa: misma voz => misma etiqueta, pero su fila
    // es INMUTABLE (mandato insert-only): la continuación es reentrega del turno
    // y se cuenta, nunca un UPDATE ni una tercera fila.
    await entregarAudio(escenario.api, VOZ(), cursor)
    await entregarAudio(escenario.api, VOZ(), cursor)
    await frase(escenario.api, 'con el doctor a las tres de la tarde', 'T5')
    await cerrarPorSilencio(escenario.api)

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(2)
    expect(filas[0]!.texto).toBe('ok flu crea una cita')
    expect(filas[0]!.etiqueta).toBe('Hablante 1')
    expect(filas[1]!.etiqueta).toBe('Hablante 2')
    expect(filas[1]!.texto).toBe('con el doctor a las tres')
    expect(escenario.api.snapshot().descartes).toContainEqual(
      expect.objectContaining({ motivo: 'turnoYaEscrito' }),
    )
  })
})

describe('Caso 1+3 — los dueños viven en el archivo real', () => {
  it('la partición y su verificación viven en la ingesta (ingesta.ts)', () => {
    expect(particionPorCambioDeVoz(fuenteDe('src/voice/conversation/ingesta.ts'))).toBe(true)
  })

  it('el resultado ASR pasa por la verificación ANTES del flujo de texto (ingesta.ts)', () => {
    expect(verificacionAntesDelFlujoDeTexto(fuenteDe('src/voice/conversation/ingesta.ts'))).toBe(
      true,
    )
  })

  it('la puerta insert-only exige una voz DISTINTA medida para escribir (cierre.ts)', () => {
    expect(insertOnlyExigeVozDistinta(fuenteDe('src/voice/conversation/cierre.ts'))).toBe(true)
  })

  it('la voz que cierra consolida SU fila por etiqueta (cierre.ts)', () => {
    expect(filaDelTurnoCasaEtiqueta(fuenteDe('src/voice/conversation/cierre.ts'))).toBe(true)
  })

  it("la causa 'voz' existe en la unión de causas (tipos.ts)", () => {
    expect(causaVozEnLaUnion(fuenteDe('src/voice/conversation/tipos.ts'))).toBe(true)
  })
})

describe('Caso 1+3 — PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('una ingesta sin partición ni verificación => rojo; con ambas => verde', () => {
    const sinParticion = 'async function ingestaAsr(entrada) {\n  await flujo.procesarResultadoAsr(entrada)\n}'
    expect(particionPorCambioDeVoz(sinParticion)).toBe(false)
    const conParticion =
      'async function verificarCambioVoz(tramoId) {\n  return partirLocucionPorVoz(cola, vector, fin)\n}\n' +
      'async function partirLocucionPorVoz(ventana, vector, finAlMedir) {}\n'
    expect(particionPorCambioDeVoz(conParticion)).toBe(true)
  })

  it('un resultado que salta la verificación => rojo; con el paso previo => verde', () => {
    const sinVerificacion = 'await flujo.procesarResultadoAsr({ ...entrada, tramoId })'
    expect(verificacionAntesDelFlujoDeTexto(sinVerificacion)).toBe(false)
    const conVerificacion =
      'const tramoAtribuido = tramoDestinoDeTexto(tramoId, entrada.texto)\n' +
      'const tramoDestino = (await verificarCambioVoz(tramoAtribuido)) ?? tramoAtribuido\n' +
      'await flujo.procesarResultadoAsr({ ...entrada, tramoId: tramoDestino })'
    expect(verificacionAntesDelFlujoDeTexto(conVerificacion)).toBe(true)
  })

  it('un gate que reescribe sin voz distinta medida => rojo; exigida => verde', () => {
    const sinExigencia =
      'const previaDelTurno = filaDelTurno(cierre.turnId)\n' +
      'if (previaDelTurno) await actualizarFila(previaDelTurno, cierre)'
    expect(insertOnlyExigeVozDistinta(sinExigencia)).toBe(false)
    const conExigencia =
      "const vozDistintaMedida = String(vozCerrada.vozId || '').trim() !== '' && !continuidadVoz\n" +
      'if (previaDelTurno && !vozDistintaMedida) {\n' +
      "  contarDescarte('turnoYaEscrito', locucion.locutionId, tramo)\n" +
      '}'
    expect(insertOnlyExigeVozDistinta(conExigencia)).toBe(true)
  })

  it('una búsqueda que devuelve la primera fila del turno => rojo; por etiqueta => verde', () => {
    const primera =
      'for (const fila of estado.filas.values()) {\n' +
      '  if (fila.turnId === id) return fila\n' +
      '}'
    expect(filaDelTurnoCasaEtiqueta(primera)).toBe(false)
    const porEtiqueta =
      'let reciente = null\nfor (const fila of estado.filas.values()) {\n' +
      '  reciente = fila\n  if (etiqueta && fila.etiqueta === etiqueta) return fila\n}'
    expect(filaDelTurnoCasaEtiqueta(porEtiqueta)).toBe(true)
  })

  it("una unión sin 'voz' => rojo; con la causa => verde", () => {
    const sinVoz = "export type CausaCierre = 'final' | 'frontera' | 'silencio' | 'stop' | 'asr'"
    expect(causaVozEnLaUnion(sinVoz)).toBe(false)
    const conVoz = "export type CausaCierre = 'final' | 'frontera' | 'silencio' | 'stop' | 'asr' | 'voz'"
    expect(causaVozEnLaUnion(conVoz)).toBe(true)
  })
})
