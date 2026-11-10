// @vitest-environment node
// BARRERA: cambio-voz-confirmado
/**
 * CAMBIO DE VOZ CONFIRMADO (Caso 1+3) — UNA ventana de voz distinta NO parte la fila.
 *
 * El embebedor tartamudea en la frontera de un tramo: una sola ventana medida
 * como «voz distinta» no basta para partir la locución. Se exigen
 * `confirmacionesCambioVoz` (2) ventanas SEGUIDAS de voz distinta. La PRIMERA
 * se RETIENE (no parte ni se queda en la fila anterior) y solo la segunda
 * confirma: A cierra en el INICIO de la primera ventana con su texto previo y
 * la voz nueva recibe las DOS ventanas.
 *
 * Se mide con el MÓDULO REAL (cola, ingesta, frontera, identidad) y un
 * embebedor falso que distingue la voz por la FRECUENCIA del tono (220 Hz →
 * [1,0]; 440 Hz → [0,1]; comparar = producto punto). El VAD real se sustituye
 * por una medida declarada por bloque (el VAD solo mide; la frontera decide).
 *
 * FALSIFICACIÓN: con `confirmacionesCambioVoz: 1` la primera ventana distinta
 * ya parte la fila y el guard falla.
 */
import { describe, expect, it } from 'vitest'
import { crearConversacion } from '../src/voice/conversation/index'
import type { ConversacionApi, EventoConversacion } from '../src/voice/conversation/index'
import {
  crearAlmacenMemoria,
  crearIdUuid,
  crearMedidorTramo,
  crearPartidorWake,
} from '../src/voice/conversation/adapters'
import { CONVERSACION_CONFIG } from '../src/voice/conversation/ports'
import type {
  ConfigPort,
  ConfiguracionConversacion,
  EmbebedorPort,
  MedidaVad,
} from '../src/voice/conversation/ports'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'

const SR = 16000
const BLOQUE = 1600 // 100 ms

/** Medida declarada de VOZ por bloque (el VAD real no decide nada aquí). */
const VOZ = (): MedidaVad => ({ hayVoz: true, silencioMs: 0 })
/** Medida declarada de SILENCIO por bloque (solo abre el turno). */
const SILENCIO = (ms: number): MedidaVad => ({ hayVoz: false, silencioMs: ms })

/** Tono puro de `frecuencia` Hz durante `ms` milisegundos. */
function tono(frecuencia: number, ms: number): Float32Array {
  const n = Math.round((SR * ms) / 1000)
  const muestras = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    muestras[i] = Math.sin((2 * Math.PI * frecuencia * i) / SR)
  }
  return muestras
}

/**
 * Embebedor falso: la voz se distingue por la frecuencia del tono.
 * 220 Hz → [1,0] (voz A); 440 Hz → [0,1] (voz B); comparar = producto punto.
 */
const embebedorFalso: EmbebedorPort = {
  medir: async (muestras) => {
    let cruces = 0
    for (let i = 1; i < muestras.length; i += 1) {
      if ((muestras[i - 1]! < 0) !== (muestras[i]! < 0)) cruces += 1
    }
    const frecuencia = cruces / 2 / (muestras.length / SR)
    return frecuencia > 300 ? [0, 1] : [1, 0]
  },
  comparar: (a, b) => a.reduce((suma, valor, i) => suma + valor * (b[i] ?? 0), 0),
}

/** Configuración del turno de prueba: pisos BAJOS para acuñar voces de 1 s. */
const CONFIG_PRUEBA: ConfigPort = {
  wakeWords: () => ['ok flu'],
  semillaEtiqueta: () => 'Hablante ?',
  esEtiquetaAnonima: isAutoSpeakerLabel,
  umbralContinuidadVoz: () => 0.8,
  minNuevaVozMs: () => 1000,
  minNuevaVozPalabras: () => 2,
  umbralExistenteVoz: () => 0.64,
  esComandoDeControl: () => false,
  etiquetaAnonima: (indice) => `Hablante ${indice}`,
  echoMinPalabrasCola: () => 4,
}

/** Texto de la voz A (8 palabras: acuña la voz con la medida temprana). */
const TEXTO_A = 'uno dos tres cuatro cinco seis siete ocho'
/** Palabras de B que el ASR pega a la línea acumulada ANTES de la partición. */
const COLA_B1 = 'y sigo y ahora hablo yo'
/** Línea ACUMULADA que reemite el ASR tras la partición (prefijo + cola nueva). */
const ACUMULADO = `${TEXTO_A} ${COLA_B1} la frase de la voz nueva`

type Escenario = Readonly<{
  api: ConversacionApi
  eventos: EventoConversacion[]
}>

/** Monta el motor real con la confirmación pedida y el embebedor de tonos. */
function montar(confirmaciones: number): Escenario {
  const reloj = { ahora: () => 1_700_000_000_000 }
  const configuracion: ConfiguracionConversacion = {
    ...CONVERSACION_CONFIG,
    minSegundosVozMedida: 1.0,
    silenceCloseMs: 5000,
    confirmacionesCambioVoz: confirmaciones,
  }
  const api = crearConversacion({
    reloj,
    id: crearIdUuid(),
    registro: { registrar: () => undefined },
    almacen: crearAlmacenMemoria({ reloj }),
    config: CONFIG_PRUEBA,
    partidor: crearPartidorWake(CONFIG_PRUEBA),
    medidor: crearMedidorTramo(),
    ultimoTextoDicho: () => '',
    embebedor: embebedorFalso,
    configuracion,
  })
  const eventos: EventoConversacion[] = []
  api.subscribe((evento) => eventos.push(evento))
  return { api, eventos }
}

/** Encadena bloques de 100 ms de la medida y tono dados desde `desdeMuestras`. */
async function emitir(
  api: ConversacionApi,
  frecuencia: number,
  bloques: number,
  desdeMuestras: number,
): Promise<void> {
  for (let i = 0; i < bloques; i += 1) {
    const inicio = desdeMuestras + i * BLOQUE
    await api.ingestAudio({
      muestras: tono(frecuencia, 100),
      sampleRate: SR,
      inicio,
      fin: inicio + BLOQUE,
      medida: VOZ(),
    })
  }
}

/** Evento del ASR sin tramo (lo resuelve el módulo dentro de su cola). */
function evento(texto: string): { tramoId: string; texto: string; final: boolean } {
  return { tramoId: '', texto, final: false }
}

const cerradosPorVoz = (
  eventos: EventoConversacion[],
): Extract<EventoConversacion, { tipo: 'locution.closed' }>[] =>
  eventos.filter(
    (e): e is Extract<EventoConversacion, { tipo: 'locution.closed' }> =>
      e.tipo === 'locution.closed' && e.causa === 'voz',
  )

const filaCommiteada = (eventos: EventoConversacion[]): Extract<
  EventoConversacion,
  { tipo: 'row.committed' }
> | null =>
  eventos.filter(
    (e): e is Extract<EventoConversacion, { tipo: 'row.committed' }> =>
      e.tipo === 'row.committed',
  )[0] ?? null

/**
 * Corre el turno de dos voces: 1 s de silencio (el tramo no nace en 0), A
 * habla 4 s (3 + 1 tras su texto), B habla 3,2 s (1,6 + 1,6). Los eventos del
 * ASR llegan al cierre de cada ventana: evB1 RETIENE la primera ventana (no
 * parte ni la deja en A) y evB2 confirma: A cierra en el inicio de la primera
 * ventana y B recibe las dos.
 */
async function correrTurno(
  escenario: Escenario,
): Promise<{ idA: string }> {
  const { api } = escenario
  await api.start({ idioma: 'es' })
  // 1 s de silencio: el tramo de A arranca en la muestra 16000.
  for (let i = 0; i < 10; i += 1) {
    const inicio = i * BLOQUE
    await api.ingestAudio({
      muestras: new Float32Array(BLOQUE),
      sampleRate: SR,
      inicio,
      fin: inicio + BLOQUE,
      medida: SILENCIO(100),
    })
  }
  // Voz A: 3 s de tono 220 Hz (muestras 16000..64000).
  await emitir(api, 220, 30, 16000)
  const idA = api.snapshot().locucionAbierta!.locutionId
  await api.ingestAsr(evento(TEXTO_A))
  // Voz A sigue 1 s más: la medida temprana acuña su voz (8 palabras, 4 s).
  await emitir(api, 220, 10, 64000)
  // Voz B: 1,6 s de tono 440 Hz (muestras 80000..105600).
  await emitir(api, 440, 16, 80000)
  // PRIMERA ventana distinta: sospecha retenida; NO parte ni se queda en A.
  await api.ingestAsr(evento(`${TEXTO_A} ${COLA_B1}`))
  // Voz B sigue 1,6 s más (fin 131200).
  await emitir(api, 440, 16, 105600)
  // SEGUNDA ventana distinta: confirma y corta en el INICIO de la primera.
  await api.ingestAsr(evento(ACUMULADO))
  return { idA }
}

describe('cambio de voz — una ventana distinta NO parte la fila', () => {
  it('la config del plan exige DOS ventanas seguidas', () => {
    expect(CONVERSACION_CONFIG.confirmacionesCambioVoz).toBe(2)
  })

  it('la primera ventana distinta sella el fin medido y NO cierra la locución', async () => {
    const escenario = montar(2)
    await escenario.api.start({ idioma: 'es' })
    for (let i = 0; i < 10; i += 1) {
      const inicio = i * BLOQUE
      await escenario.api.ingestAudio({
        muestras: new Float32Array(BLOQUE),
        sampleRate: SR,
        inicio,
        fin: inicio + BLOQUE,
        medida: SILENCIO(100),
      })
    }
    await emitir(escenario.api, 220, 30, 16000)
    const idA = escenario.api.snapshot().locucionAbierta!.locutionId
    await escenario.api.ingestAsr(evento(TEXTO_A))
    await emitir(escenario.api, 220, 10, 64000)
    await emitir(escenario.api, 440, 16, 80000)
    await escenario.api.ingestAsr(evento(`${TEXTO_A} ${COLA_B1}`))

    expect(cerradosPorVoz(escenario.eventos)).toHaveLength(0)
    expect(escenario.api.snapshot().locucionAbierta!.locutionId).toBe(idA)
  })

  it('la SEGUNDA ventana distinta parte: la anterior cierra recortada y la nueva abre su locución', async () => {
    const escenario = montar(2)
    const { idA } = await correrTurno(escenario)
    const cerrados = cerradosPorVoz(escenario.eventos)
    expect(cerrados).toHaveLength(1)
    expect(cerrados[0]!.locutionId).toBe(idA)
    expect(cerrados[0]!.tramo).toEqual({ inicio: 16000, fin: 89600, sampleRate: SR })
    const filaA = filaCommiteada(escenario.eventos)
    expect(filaA).not.toBeNull()
    expect(filaA!.fila.texto).toBe(TEXTO_A)
    expect(filaA!.fila.tramo.fin).toBe(89600)
    const abierta = escenario.api.snapshot().locucionAbierta
    expect(abierta!.locutionId).not.toBe(idA)
    // La primera ventana de B ya no queda en A: su tramo arranca en el corte
    // de la PRIMERA ventana (89600) y B recibe las dos.
    expect(abierta!.tramo.inicio).toBe(89600)
    // La línea acumulada NO re-incluye el texto de la fila anterior.
    expect(abierta!.texto).toBe(`${COLA_B1} la frase de la voz nueva`)
  })

  it('FALSIFICACIÓN: con UNA sola confirmación la primera ventana distinta ya parte', async () => {
    const escenario = montar(1)
    await escenario.api.start({ idioma: 'es' })
    for (let i = 0; i < 10; i += 1) {
      const inicio = i * BLOQUE
      await escenario.api.ingestAudio({
        muestras: new Float32Array(BLOQUE),
        sampleRate: SR,
        inicio,
        fin: inicio + BLOQUE,
        medida: SILENCIO(100),
      })
    }
    await emitir(escenario.api, 220, 30, 16000)
    await escenario.api.ingestAsr(evento(TEXTO_A))
    await emitir(escenario.api, 220, 10, 64000)
    await emitir(escenario.api, 440, 16, 80000)
    await escenario.api.ingestAsr(evento(`${TEXTO_A} ${COLA_B1}`))

    expect(cerradosPorVoz(escenario.eventos).length).toBeGreaterThan(0)
    // Y con la confirmación del plan (2), la misma ventana NO parte.
    const confirmado = montar(2)
    await confirmado.api.start({ idioma: 'es' })
    for (let i = 0; i < 10; i += 1) {
      const inicio = i * BLOQUE
      await confirmado.api.ingestAudio({
        muestras: new Float32Array(BLOQUE),
        sampleRate: SR,
        inicio,
        fin: inicio + BLOQUE,
        medida: SILENCIO(100),
      })
    }
    await emitir(confirmado.api, 220, 30, 16000)
    await confirmado.api.ingestAsr(evento(TEXTO_A))
    await emitir(confirmado.api, 220, 10, 64000)
    await emitir(confirmado.api, 440, 16, 80000)
    await confirmado.api.ingestAsr(evento(`${TEXTO_A} ${COLA_B1}`))
    expect(cerradosPorVoz(confirmado.eventos)).toHaveLength(0)
  })

  it('el contador no se arrastra: una sospecha sin confirmar no parte la locución siguiente', async () => {
    const escenario = montar(2)
    const { api } = escenario
    await api.start({ idioma: 'es' })
    // A + primera ventana de B: sospecha retenida, NO confirma.
    await emitir(api, 220, 30, 16000)
    await api.ingestAsr(evento(TEXTO_A))
    await emitir(api, 220, 10, 64000)
    await emitir(api, 440, 16, 80000)
    await api.ingestAsr(evento(`${TEXTO_A} ${COLA_B1}`))
    // Silencio medido: cierra A sin confirmar el cambio.
    await api.ingestAudio({
      muestras: new Float32Array(SR * 5),
      sampleRate: SR,
      inicio: 105600,
      fin: 105600 + SR * 5,
      medida: SILENCIO(5000),
    })
    // Nueva locución: A + primera ventana de B. Con el contador arrastrado,
    // esta primera ventana partiría (causa voz); con el reset, NO parte.
    const base = 105600 + SR * 5
    await emitir(api, 220, 30, base)
    await api.ingestAsr(evento(TEXTO_A))
    await emitir(api, 220, 10, base + 48000)
    await emitir(api, 440, 16, base + 64000)
    await api.ingestAsr(evento(`${TEXTO_A} ${COLA_B1}`))
    expect(cerradosPorVoz(escenario.eventos)).toHaveLength(0)
  })
})
