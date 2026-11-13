// @vitest-environment node
// BARRERA: pendiente-fusion
/**
 * BARRERA: pendiente-fusion
 *
 * EL BLOQUE NO SE PARTE SIN FRONTERA — el texto retenido ANTES de una frontera
 * de TIEMPO se funde en la locución que cierra: UNA fila, UN insert.
 *
 * DEFECTO MEDIDO EN VIVO (2026-11-12, sesión fd148fe7): el mismo hablante dictó
 * dos frases seguidas (un semi-alto de ~1 s entre ellas). El VAD cortó el tramo
 * y la segunda frase llegó con un tramo diminuto (ráfaga de 0,27 s); como no
 * continuaba la línea abierta, se retuvo como pendiente. La frontera de silencio
 * (5 s) cerró la locución y el flush abrió la retenida como fila propia:
 * «Hablante XX» con texto del «Hablante 1» — un partido SIN frontera real.
 *
 * Regla 3: la caja solo se parte por tiempo o cambio de hablante. La retenida
 * llegó ANTES del tiempo: pertenece al bloque que cierra. El texto que llega
 * DESPUÉS del silencio de cierre sigue abriendo su propia fila (26208442).
 *
 * FALSIFICACIÓN: sin `fundirPendientesPrevios` el primer caso commitea DOS
 * filas (la retenida abre su propia locución al flush).
 */
import { describe, expect, it } from 'vitest'
import { crearConversacion } from '../src/voice/conversation/index'
import type {
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
// Textos REALES de la sesión 2026-11-12 19:05 (01:05:21–01:05:26).
const TEXTO_1905_A =
  'voy a empezar otra vez vamos a trabajar con la transcripción la de avisación etcétera voy a contar 1 2 3 4 5 6 7 8 9 10 hago un semi silencio'
const TEXTO_1905_PENDIENTE = ' continúo Okay vamos a ver qué tal'
const TEXTO_1905_FINAL = 'continuo Okay vamos a ver qué tal lo hace va bien'
// Toda locución necesita UUIDv4 para poder escribir su fila.
const TRAMO_1905 = '8f14e45f-ceea-467a-9a3e-2f7b9c3d1a55'

const VOZ = (silencioMs = 0): MedidaVad => ({ hayVoz: true, silencioMs })
const SILENCIO = (silencioMs: number): MedidaVad => ({ hayVoz: false, silencioMs })

/** Cursor de muestras de la sesión sintética (una línea de audio continua). */
let cursor = 0

/** Embebedor falso: la voz actual la decide el test; coseno = producto punto. */
function crearEmbebedor(): EmbebedorPort {
  let vozActual: readonly number[] = VOZ_A
  return {
    medir: async (): Promise<readonly number[] | null> => vozActual,
    comparar: (a: readonly number[], b: readonly number[]): number =>
      a.reduce((suma, valor, i) => suma + valor * (b[i] ?? 0), 0),
  }
}

type Escenario = Readonly<{
  api: ConversacionApi
  eventos: EventoConversacion[]
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
    embebedor: crearEmbebedor(),
  }
  const api = crearConversacion(dependencias)
  const eventos: EventoConversacion[] = []
  api.subscribe((evento) => eventos.push(evento))
  return { api, eventos }
}

/** Un bloque de audio sintético sobre la línea de muestras continua. */
function bloque(muestras: number, medida: MedidaVad) {
  const inicio = cursor
  cursor += muestras
  return {
    muestras: new Float32Array(muestras),
    sampleRate: SAMPLE_RATE,
    inicio,
    fin: inicio + muestras,
    medida,
  }
}

/** Locución A: 1 s de silencio + 2 s de voz con su final (queda ABIERTA). */
async function abrirLocucion(api: ConversacionApi, texto: string): Promise<string> {
  await api.ingestAudio(bloque(SAMPLE_RATE, SILENCIO(1000)))
  const abierta = await api.ingestAudio(bloque(2 * SAMPLE_RATE, VOZ()))
  const tramoId = abierta.locucionAbierta?.locutionId
  if (!tramoId) throw new Error('el audio con voz no abrio locucion')
  await api.ingestAsr({ tramoId, texto, final: true })
  return tramoId
}

describe('BARRERA pendiente-fusion — la retenida antes de la frontera de tiempo se funde', () => {
  it('sesión fd148fe7: frases del MISMO hablante con corte de VAD salen en UNA fila', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoA = await abrirLocucion(api, 'vamos a revisar otra vez la transcripcion')

    // El VAD corta el tramo (900 ms de silencio) y una ráfaga de voz abre el
    // tramo de la frase siguiente (silencioPrevioMs 900). Su texto NO continúa
    // la línea abierta y no hay frontera: se retiene como pendiente.
    await api.ingestAudio(bloque(SAMPLE_RATE, SILENCIO(900)))
    const rafaga = await api.ingestAudio(bloque(SAMPLE_RATE / 2, VOZ()))
    const tramoB = rafaga.tramoAudio?.tramoId
    if (!tramoB) throw new Error('la rafaga no abrio tramo')
    await api.ingestAsr({ tramoId: tramoB, texto: 'continuo no no hice el alto completo', final: true })

    // Frontera de TIEMPO (5 s de silencio): la locución cierra y la retenida se
    // funde en SU fila. Una fila, un insert — el texto no se parte en dos.
    await api.ingestAudio(bloque(5 * SAMPLE_RATE, SILENCIO(5000)))

    const instantanea = api.snapshot()
    expect(instantanea.filas).toHaveLength(1)
    expect(instantanea.filas[0]?.locutionId).toBe(tramoA)
    expect(instantanea.filas[0]?.texto).toBe(
      'vamos a revisar otra vez la transcripcion continuo no no hice el alto completo',
    )
    // La etiqueta es la MEDIDA del hablante: no hay segunda fila «XX».
    expect(instantanea.filas[0]?.etiqueta).toBe('Hablante 1')
    expect(instantanea.locucionAbierta).toBeNull()
  }, 60_000)

  it('sesión 19:05: la habla A CABALLO del cierre no se pega a la fila que cierra', async () => {
    const { api } = crearEscenario()
    await api.start()
    // A: 1 s de silencio + 4 s de voz con su final (la frase queda abierta).
    await api.ingestAudio(bloque(SAMPLE_RATE, SILENCIO(1000)))
    const abierta = await api.ingestAudio(bloque(4 * SAMPLE_RATE, VOZ()))
    const tramoA = abierta.locucionAbierta?.locutionId
    if (!tramoA) throw new Error('el audio con voz no abrio locucion')
    const finA = Number(abierta.locucionAbierta?.tramo?.fin)
    await api.ingestAsr({ tramoId: tramoA, texto: TEXTO_1905_A, final: true })

    // Interino de la habla EN CURSO: su tramo empieza DENTRO de A (2,13 s
    // antes de su fin) y sigue DESPUÉS (1,07 s) — el tramo medido en el log
    // [2632832,2786560] con fin 2735232 de A. No continúa la frase de A.
    await api.ingestAsr({
      tramoId: TRAMO_1905,
      texto: TEXTO_1905_PENDIENTE,
      final: false,
      tramo: {
        inicio: finA - Math.round(SAMPLE_RATE * 2.13),
        fin: finA + Math.round(SAMPLE_RATE * 1.07),
        sampleRate: SAMPLE_RATE,
      },
    })

    // Silencio: el VAD corta el tramo de A y su frontera lo cierra. La habla a
    // caballo NO se funde: estaba en curso cuando A cerró y vuelve entera en SU
    // fila (el mismo texto en dos filas era la duplicación medida).
    await api.ingestAudio(bloque(5 * SAMPLE_RATE, SILENCIO(5000)))
    let instantanea = api.snapshot()
    expect(instantanea.filas.map((fila) => fila.texto)).toEqual([TEXTO_1905_A])
    expect(instantanea.locucionAbierta?.locutionId).toBe(TRAMO_1905)

    // Su final llega completo y su propio silencio commitea la segunda fila.
    await api.ingestAsr({ tramoId: TRAMO_1905, texto: TEXTO_1905_FINAL, final: true })
    await api.ingestAudio(bloque(5 * SAMPLE_RATE, SILENCIO(5000)))
    instantanea = api.snapshot()
    expect(instantanea.filas.map((fila) => fila.texto)).toEqual([
      TEXTO_1905_A,
      TEXTO_1905_FINAL,
    ])
  }, 60_000)

  it('la frase que llega DESPUÉS del silencio de cierre abre su propia fila (26208442)', async () => {
    const { api } = crearEscenario()
    await api.start()
    const tramoA = await abrirLocucion(api, 'frase a')

    // Corte de VAD y frase nueva con SU tramo. Su resultado declara 5 s de
    // silencio previo: la frontera de TIEMPO cierra A por 'frontera' y la frase
    // nueva NO se funde — llegó después del silencio, abre SU fila (regla 3).
    await api.ingestAudio(bloque(SAMPLE_RATE, SILENCIO(900)))
    const nueva = await api.ingestAudio(bloque(SAMPLE_RATE, VOZ()))
    const tramoB = nueva.tramoAudio?.tramoId
    if (!tramoB) throw new Error('la voz nueva no abrio tramo')
    await api.ingestAsr({
      tramoId: tramoB,
      texto: 'frase be',
      final: true,
      silencioPrevioMs: 5000,
    })

    let instantanea = api.snapshot()
    expect(instantanea.filas.map((fila) => fila.texto)).toEqual(['frase a'])
    expect(instantanea.locucionAbierta?.locutionId).toBe(tramoB)

    // Su propio silencio de cierre commitea la segunda fila.
    await api.ingestAudio(bloque(5 * SAMPLE_RATE, SILENCIO(5000)))
    instantanea = api.snapshot()
    expect(instantanea.filas.map((fila) => fila.texto)).toEqual(['frase a', 'frase be'])
    expect(instantanea.filas[0]?.locutionId).toBe(tramoA)
    expect(instantanea.locucionAbierta).toBeNull()
  }, 60_000)
})
