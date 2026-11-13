// @vitest-environment node
// BARRERA: pendientes-vivo
/**
 * LA FRASE RETENIDA VIVE EN SU FRONTERA — y se fecha con la hora de VOZ.
 *
 * DEFECTO MEDIDO EN VIVO (2026-11-12): «hay bloques de conversación que se
 * escriben después de cerrar la escucha, y que se hablaron al inicio». La frase
 * retenida (texto que no pertenece a la locución abierta) esperaba al STOP para
 * abrir su locución: su fila nacía minutos después y el almacén la fechaba con
 * el reloj de ESCRITURA, no con la hora en que se habló.
 *
 * DÓNDE VIVE LA BARRERA. La ingesta abre el pendiente EN EL ACTO cuando una
 * frontera cierra la locución anterior (`flushPendientes` tras el cierre por
 * silencio medido y en el estado terminal del ASR), y la hora de la fila sale
 * del ANCLA muestra↔reloj de la sesión (`horaDelFinDelTramo`): el fin del tramo
 * en tiempo de VOZ viaja como `marcaFinMs` y el almacén lo usa como `updated_at`
 * en vez de su reloj. El retén expira lo que ya no es frase (`expurgar`) y la
 * reentrega tiene UNA sola puerta (`esReentrega`, inyectada por la ingesta) para
 * el volcado del stop y para la ingesta.
 *
 * Se mide con el PRODUCTO REAL (Dexie + VAD real sobre tonos).
 *
 * FALSIFICACIÓN: sin `marcaFinMs`, la fila escrita en el stop lleva el reloj de
 * escritura (≈ T0) y no la hora del audio (≈ T0 + fin/tasa); sin el flush en la
 * frontera, la frase retenida no está abierta hasta el stop.
 */
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { fluDb } from '../src/core/db/fluDatabase'
import { crearMotorConversacionProducto } from '../src/voice/conversation/index'
import type { EventoConversacion, EventoProducto } from '../src/voice/conversation/index'
import { construirFila, horaDelFinDelTramo } from '../src/voice/conversation/fila'
import { getVadEnergyThreshold } from '../src/voice/lib/asr/asrConfig.js'

const SAMPLE_RATE = 16000
const BLOQUE = 1600 // 100 ms

type Motor = ReturnType<typeof crearMotorConversacionProducto>
type Fila = Extract<EventoConversacion, { tipo: 'row.committed' }>['fila']

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

/** Evento del motor local: cada segmento sustituye el array (longitud 1). */
function eventoReemplazado(texto: string, final = false): EventoProducto {
  return {
    resultIndex: 0,
    results: [{ 0: { transcript: texto }, isFinal: final, length: 1 }],
  }
}

/** Fila commiteada con su marca de escritura (updated_at = hora de VOZ). */
const filasDe = (motor: Motor): Fila[] => {
  const filas: Fila[] = []
  motor.suscribir((evento) => {
    if (evento.tipo === 'row.committed') filas.push(evento.fila)
  })
  return filas
}

const fuente = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

beforeEach(async () => {
  await fluDb.conversations.clear()
})

describe('horaDelFinDelTramo — la fila se fecha con la hora en que se habló', () => {
  const ancla = { muestra: 0, ms: 1_700_000_000_000, sampleRate: 16000 }

  it('deriva la hora del ancla de la sesión y del fin del tramo', () => {
    expect(horaDelFinDelTramo(ancla, { inicio: 0, fin: 32000, sampleRate: 16000 })).toBe(
      ancla.ms + 2000,
    )
  })

  it('sin ancla o con otra tasa NO inventa una hora', () => {
    expect(horaDelFinDelTramo(null, { inicio: 0, fin: 32000, sampleRate: 16000 })).toBeNull()
    expect(
      horaDelFinDelTramo(ancla, { inicio: 0, fin: 32000, sampleRate: 48000 }),
    ).toBeNull()
  })

  it('la fila arrastra la marca hasta el almacén; sin marca no se declara', () => {
    const base = {
      locutionId: '123e4567-e89b-42d3-a456-426614174000',
      sessionId: 'sesion',
      turnId: 'turno',
      inicio: 0,
      fin: 32000,
      sampleRate: 16000,
      texto: 'hola',
      idioma: 'es' as const,
      overlap: false,
      final: true,
      reason: 'user' as const,
      voz: { nombre: '', nombreConfirmado: false, hablante: '', continuidad: false },
      etiquetaAnterior: null,
      semillaEtiqueta: 'Hablante XX',
      esEtiquetaAnonima: () => false,
      firma: null,
    }
    const conMarca = construirFila({ ...base, marcaFinMs: 1_700_000_002_000 })
    const sinMarca = construirFila(base)
    expect(conMarca.fila?.marcaFinMs).toBe(1_700_000_002_000)
    expect(sinMarca.fila && 'marcaFinMs' in sinMarca.fila).toBe(false)
  })
})

describe('producto real — la frase retenida ANTES de la frontera de tiempo se funde en UNA fila', () => {
  it('A cierra por silencio, la retenida B se funde en SU fila y la hora es la del bloque', async () => {
    const motor = crearMotorConversacionProducto({ idioma: 'es', ultimoTextoDicho: () => '' })
    const filas = filasDe(motor)
    const T0 = Date.now()
    motor.abrir()

    // Locución A: 1 s de silencio + 1 s de voz (muestras 16000..32000).
    for (let i = 0; i < 10; i += 1) motor.audio(silencio(100), SAMPLE_RATE, i * BLOQUE)
    for (let i = 0; i < 10; i += 1) motor.audio(tono(100), SAMPLE_RATE, 16000 + i * BLOQUE)
    await motor.evento(eventoReemplazado('frase a', false))

    // El VAD corta A y la voz de B abre SU tramo (muestras 48000..64000). El
    // texto de B llega con ~1 s de silencio medido: aún no hay frontera de
    // cierre, así que se RETIENE (no se pega a A ni se tira).
    motor.audio(silencio(1000), SAMPLE_RATE, 32000)
    for (let i = 0; i < 10; i += 1) motor.audio(tono(100), SAMPLE_RATE, 48000 + i * BLOQUE)
    await motor.evento(eventoReemplazado('frase be', false))

    // Frontera de CIERRE (5 s de silencio): la retenida llegó ANTES del tiempo,
    // es del MISMO bloque y se funde en la fila que cierra (UNA fila, UN insert;
    // regla 3: la caja solo se parte por tiempo o cambio de hablante).
    motor.audio(silencio(5000), SAMPLE_RATE, 64000)
    // La espera es de CONDICIÓN, no de reloj: A commiteada con el texto fundido
    // y SIN locución abierta (la retenida ya no abre la suya). El margen amplio
    // cubre la saturación de la corrida paralela.
    await expect
      .poll(
        () => ({
          filas: filas.length,
          abierta: motor.instantanea().locucionAbierta?.texto ?? null,
        }),
        { timeout: 20_000 },
      )
      .toEqual({ filas: 1, abierta: null })
    expect(filas[0].texto).toBe('frase a frase be')
    // La caja se limpió: el texto del bloque ya pasó a la conversación.
    expect(motor.instantanea().box.texto).toBe('')

    // El stop no descubre nada: el retén ya se fundió en la fila.
    await motor.cerrar('user')
    expect(filas.map((fila) => fila.texto)).toEqual(['frase a frase be'])

    // HORA DE VOZ: la fila cubre el audio del bloque completo (A y la retenida
    // fundida): termina en la muestra 64000 → T0 + 4 s. El reloj de escritura
    // (≈ T0) queda a segundos de distancia.
    expect(Math.abs(Number(filas[0].updated_at) - (T0 + 4000))).toBeLessThan(250)
  }, 60_000)
})

describe('el límite cablea la regla: una sola puerta y el ancla en el cierre', () => {
  it('la ingesta abre el pendiente tras CADA frontera y la reentrega tiene UNA puerta', () => {
    const ingesta = fuente('src/voice/conversation/ingesta.ts')
    expect(ingesta.match(/await flujo\.flushPendientes\(\)/g) ?? []).toHaveLength(2)
    expect(ingesta).toContain('esReentrega: esReentregaDeLaFila')
    const texto = fuente('src/voice/conversation/texto.ts')
    // El retén expira lo que ya no es frase en la ÚNICA puerta que lo vuelca.
    expect(texto).toContain('pendientes.expurgar()')
    // El volcado del stop pregunta a la MISMA puerta de reentrega.
    expect(texto).toContain('if (!esReentrega(lote, lote.tramoId)) return true')
    expect(texto).not.toContain('esReentregaDeLaFila')
  })

  it('el cierre fecha con el ancla y el almacén usa la marca como updated_at', () => {
    const cierre = fuente('src/voice/conversation/cierre.ts')
    expect(cierre).toContain('const marcaFinMs = horaDelFinDelTramo(estado.anclaAudio, tramo)')
    expect(cierre).toContain('...(marcaFinMs !== null ? { marcaFinMs } : {})')
    const almacenDexie = fuente('src/voice/conversation/adaptersAlmacen.ts')
    expect(almacenDexie).toContain('const ahora = Number.isFinite(Number(fila.marcaFinMs))')
    expect(almacenDexie).toContain(': reloj.ahora()')
    const almacenMemoria = fuente('src/voice/conversation/adapters.ts')
    expect(almacenMemoria).toContain(
      'updated_at: Number.isFinite(Number(marcaFinMs)) ? Number(marcaFinMs) : reloj.ahora()',
    )
  })
})
