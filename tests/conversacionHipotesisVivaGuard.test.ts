// @vitest-environment node
// BARRERA: hipotesis-viva
/**
 * HIPÓTESIS VIVA DEL RECONOCEDOR — el interino se REEMPLAZA, no se pega.
 *
 * DEFECTO MEDIDO EN VIVO (2026-11-12): «en el 3.er y 4.º bloque está batiendo
 * la conversación; hay palabras que se dijeron al principio y las pone después
 * de los números». Chrome manda en cada evento su HIPÓTESIS COMPLETA (revisa
 * resultados ANTERIORES, no solo la cola desde `resultIndex`). El límite del
 * producto componía los interinos SOLO desde `resultIndex` y los pegaba a la
 * línea abierta con el libro del hueco: una revisión de lo ya dicho no podía
 * pintarse, y lo que se pegaba quedaba fuera de orden.
 *
 * DÓNDE VIVE LA BARRERA. En el LÍMITE DEL PRODUCTO, en dos piezas con un solo
 * dueño cada una: `composicion.ts` compone TODO evento (final o interino) desde
 * la frontera commiteada — la hipótesis completa del tramo — y `producto.ts`
 * REEMPLAZA el texto del tramo con ella; `fusionarEnLineaAbierta` queda SOLO
 * para una sesión NUEVA del reconocedor — la declara `abrir()`, el hecho de
 * `Recognition.onstart` —, cuya hipótesis es parcial sobre el tramo. El commit
 * cierra la ventana: lo que sigue ya es otra locución y se reemplaza.
 * `revision.ts` sigue siendo el dueño de la regla 3 (nunca pierde palabras ya
 * oídas).
 *
 * Se mide con el PRODUCTO REAL (Dexie + VAD real sobre tonos) y eventos con la
 * forma de Chrome (resultados que SOLO crecen, `resultIndex` en la cola).
 *
 * FALSIFICACIÓN: componer el interino desde `resultIndex` (la regla anterior)
 * deja fuera lo revisado; la caja se queda con la versión vieja y la fila pierde
 * la corrección.
 */
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { fluDb } from '../src/core/db/fluDatabase'
import { crearMotorConversacionProducto } from '../src/voice/conversation/index'
import type { EventoConversacion, EventoProducto } from '../src/voice/conversation/index'
import { FRONTERA_INICIAL, componerEvento } from '../src/voice/conversation/composicion'
import { fraseDelEventoAsr } from '../src/voice/lib/speechMerge.js'
import { getVadEnergyThreshold } from '../src/voice/lib/asr/asrConfig.js'

const SAMPLE_RATE = 16000
const BLOQUE = 1600 // 100 ms

/** Primera hipótesis del tramo (lo que la caja ya mostraba). */
const X1 = 'nos vemos el jueves'
/** Revisión de la MISMA frase: Chrome la alarga en el resultado 0. */
const X2 = 'nos vemos el jueves por la tarde'
/** Resultado NUEVO que llega detrás en el mismo evento. */
const Y = 'y llevamos los numeros'

type Motor = ReturnType<typeof crearMotorConversacionProducto>

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

/**
 * Evento ACUMULADO, la forma real de Chrome: la instancia conserva TODOS los
 * resultados y `resultIndex` marca el primero que cambió.
 */
function eventoAcumulado(
  resultados: ReadonlyArray<{ texto: string; final: boolean }>,
  resultIndex: number,
): EventoProducto {
  return {
    resultIndex,
    results: resultados.map((resultado) => ({
      0: { transcript: resultado.texto },
      isFinal: resultado.final,
      length: 1,
    })),
  }
}

/** 1 s de silencio + 1 s de voz: abre el tramo de una locución nueva. */
function abrirLocucion(motor: Motor, base: number): void {
  for (let i = 0; i < 10; i += 1) motor.audio(silencio(100), SAMPLE_RATE, base + i * BLOQUE)
  for (let i = 0; i < 10; i += 1) {
    motor.audio(tono(100), SAMPLE_RATE, base + 16000 + i * BLOQUE)
  }
}

beforeEach(async () => {
  await fluDb.conversations.clear()
})

describe('hipótesis viva — el interino reemplaza, no se pega', () => {
  it('sin el límite, componer desde resultIndex deja fuera lo revisado', () => {
    // Falsificación de la regla anterior: la revisión de X1 vive en el
    // resultado 0 y una cola compuesta desde `resultIndex` la ignora.
    const evento = eventoAcumulado(
      [
        { texto: X2, final: false },
        { texto: Y, final: false },
      ],
      1,
    )
    const comoAntes = fraseDelEventoAsr(evento.results, 1)
    expect(comoAntes).toBe(Y)
    expect(comoAntes).not.toContain('jueves')
    // El dueño actual compone la hipótesis completa desde la frontera.
    const compuesta = componerEvento(evento, FRONTERA_INICIAL)
    expect(compuesta.trozo).toContain('jueves')
    expect(compuesta.trozo).toContain('numeros')
    expect(compuesta.nuevaInstancia).toBe(false)
  })

  it('la caja y la fila llevan la revisión completa, en orden', async () => {
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
    })
    const filas: string[] = []
    motor.suscribir((evento: EventoConversacion) => {
      if (evento.tipo === 'row.committed') filas.push(evento.fila.texto)
    })
    motor.abrir()
    abrirLocucion(motor, 0)
    // Evento 1: la hipótesis inicial.
    await motor.evento(eventoAcumulado([{ texto: X1, final: false }], 0))
    expect(motor.instantanea().box.texto).toBe(X1)
    // Evento 2: Chrome REVISA el resultado 0 y añade una cola nueva; su
    // `resultIndex` (1) no puede ocultar la revisión.
    await motor.evento(
      eventoAcumulado(
        [
          { texto: X2, final: false },
          { texto: Y, final: false },
        ],
        1,
      ),
    )
    const caja = motor.instantanea().box.texto
    expect(caja).toContain('tarde')
    expect(caja).toContain('numeros')
    expect(caja.indexOf('jueves')).toBeLessThan(caja.indexOf('numeros'))
    // El silencio cierra la locución: la fila es la MISMA hipótesis, sin eco
    // de la versión vieja («batiendo»).
    motor.audio(silencio(5000), SAMPLE_RATE, 32000)
    // El cierre por silencio corre en la cadena serializada del producto: la
    // espera es de CONDICIÓN (el commit), no de reloj. El margen amplio cubre la
    // saturación de la corrida paralela; si el commit no llega, la prueba falla.
    await expect
      .poll(() => filas.length, { timeout: 20_000 })
      .toBeGreaterThan(0)
    expect(filas.at(-1)).toContain('tarde')
    expect(filas.at(-1)).toContain('numeros')
    expect(filas.at(-1)!.match(/jueves/g) ?? []).toHaveLength(1)
  }, 60_000)

  it('el límite cablea la regla: reemplaza y solo pega una instancia nueva', () => {
    const producto = readFileSync(
      join(process.cwd(), 'src/voice/conversation/producto.ts'),
      'utf8',
    )
    expect(producto).toContain(
      'const reemplaza = !sesionNueva && (hayFinal || !compuesta.nuevaInstancia)',
    )
    expect(producto).toContain(
      '              sesionNueva ? null : libroDeLinea,',
    )
    const composicion = readFileSync(
      join(process.cwd(), 'src/voice/conversation/composicion.ts'),
      'utf8',
    )
    expect(composicion).toContain(
      'const trozo = fraseDelEventoAsr(resultados, recorte)',
    )
    expect(composicion).toContain('nuevaInstancia = total < frontera.corte')
  })
})
