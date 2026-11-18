// @vitest-environment node
// BARRERA: prefijo-fila-partida
/**
 * PREFIJO DE FILA EN LOCUCIÓN PARTIDA — la fila nueva NUNCA re-incluye la anterior.
 *
 * La línea ACUMULADA del producto re-incluye el texto de la última fila ya
 * commiteada. Al abrir la locución de una voz nueva (partición por cambio de
 * voz), esa línea repetía la fila anterior y creaba un duplicado con otro
 * hablante. El recorte del prefijo tiene UN dueño (`sinPrefijoDeLaFilaAnterior`)
 * y con `partidaDeVoz` el prefijo pertenece al audio ya commiteado, sea de la
 * voz que sea: la fila de la voz nueva lleva SOLO su cola.
 *
 * Se mide con el MÓDULO REAL (mismo turno de dos voces del guard de
 * confirmación): tras la partición en la muestra 115200, la reemisión de la
 * línea acumulada NO pega el texto de A a la fila de B, y la fila de B
 * commitea al cerrar la sesión SOLO con la cola nueva.
 *
 * FALSIFICACIÓN: quitar `abierta.partidaDeVoz` de los recortes vuelve a dejar
 * pasar la línea acumulada entera (el detector del recorte lo marca).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

/**
 * Corre el turno de dos voces hasta la partición (muestra 115200) y cierra la
 * sesión: la fila de B debe commitear SOLO la cola nueva.
 */
async function correrHastaElCierre(): Promise<{
  filaA: Extract<EventoConversacion, { tipo: 'row.committed' }>
  filaB: Extract<EventoConversacion, { tipo: 'row.committed' }>
}> {
  const reloj = { ahora: () => 1_700_000_000_000 }
  const configuracion: ConfiguracionConversacion = {
    ...CONVERSACION_CONFIG,
    minSegundosVozMedida: 1.0,
    silenceCloseMs: 5000,
  }
  const api: ConversacionApi = crearConversacion({
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
  await api.start({ idioma: 'es' })
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
  const emitir = async (
    frecuencia: number,
    bloques: number,
    desdeMuestras: number,
  ): Promise<void> => {
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
  const evento = (texto: string): { tramoId: string; texto: string; final: boolean } => ({
    tramoId: '',
    texto,
    final: false,
  })
  await emitir(220, 30, 16000)
  await api.ingestAsr(evento(TEXTO_A))
  await emitir(220, 10, 64000)
  await emitir(440, 16, 80000)
  // PRIMERA ventana distinta (línea acumulada): confirma el cambio, NO parte.
  await api.ingestAsr(evento(`${TEXTO_A} ${COLA_B1}`))
  await emitir(440, 16, 105600)
  // Partición (voz B): la línea acumulada llega con el prefijo de A incluido.
  await api.ingestAsr(evento(ACUMULADO))
  // Reemisión de la MISMA línea acumulada: no puede re-abrir ni re-pegar nada.
  await api.ingestAsr(evento(ACUMULADO))
  await api.stop('user')
  const filas = eventos.filter(
    (e): e is Extract<EventoConversacion, { tipo: 'row.committed' }> =>
      e.tipo === 'row.committed',
  )
  if (filas.length !== 2) {
    throw new Error(`se esperaban 2 filas, llegaron ${filas.length}`)
  }
  const [filaA, filaB] = filas
  return { filaA: filaA!, filaB: filaB! }
}

// ============================================================
// El recorte del prefijo: dueño único y con el hecho de la partición.
// ------------------------------------------------------------
const TEXTO_TS = readFileSync(
  join(process.cwd(), 'src/voice/conversation/texto.ts'),
  'utf8',
)

/** Recortes del prefijo que declaran el hecho de la partición (dos puertas). */
function recortesConPartidaDeVoz(src: string): number {
  // El recorte puede llevar la ventana del tramo como 4.º argumento (mismo
  // audio); lo que la guarda exige es que AMBAS puertas declaren la partición.
  return (
    src.match(
      /sinPrefijoDeLaFilaAnterior\(texto,\s*voz,\s*abierta\.partidaDeVoz(?:,\s*[^)]+)?\)/g,
    ) ?? []
  ).length
}

describe('prefijo de fila — la locución partida no re-incluye la fila anterior', () => {
  it('la fila de la voz nueva commitea SOLO la cola, sin el texto de A', async () => {
    const { filaA, filaB } = await correrHastaElCierre()
    expect(filaA.fila.texto).toBe(TEXTO_A)
    expect(filaA.fila.tramo.fin).toBe(89600)
    expect(filaB.fila.texto).toBe(`${COLA_B1} la frase de la voz nueva`)
    expect(filaB.fila.texto).not.toContain('uno dos')
    expect(filaB.fila.texto).toContain(COLA_B1)
  })

  it('el recorte del prefijo pasa por el dueño único y NO aplica el texto crudo', () => {
    expect(TEXTO_TS).toContain('function sinPrefijoDeLaFilaAnterior')
    // La revisión de la abierta NUNCA aplica el texto crudo: pasa por el recorte.
    expect(TEXTO_TS).not.toMatch(/aplicarRevision\(\s*abierta,\s*texto,/)
  })

  it('el recorte declara el hecho de la partición en AMBAS puertas', () => {
    expect(recortesConPartidaDeVoz(TEXTO_TS)).toBe(2)
  })

  it('FALSIFICACIÓN: quitar el hecho de la partición deja el recorte mudo', () => {
    const sinPartidaDeVoz = TEXTO_TS.replaceAll('abierta.partidaDeVoz', 'false')
    expect(recortesConPartidaDeVoz(sinPartidaDeVoz)).toBe(0)
    expect(recortesConPartidaDeVoz(TEXTO_TS)).toBe(2)
  })
})
