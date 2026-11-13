// @vitest-environment node
// BARRERA: frontera-sesion
/**
 * FRONTERA DE TRANSPORTE POR SESIÓN DEL RECONOCEDOR.
 *
 * DEFECTO MEDIDO EN VIVO (sesión 753c2361, 2026-11-12):
 *   - Cada fila commiteada reiniciaba el reconocedor («frontera-turno»). Chrome
 *     arranca una sesión NUEVA en cada `start()`: su array de resultados empieza
 *     en 0.
 *   - La frontera de índice (`corte`) sobrevivía al reinicio. Cuando el primer
 *     evento de la sesión nueva ya traía más resultados que el `corte` heredado,
 *     `componerEvento` recortaba sus PRIMEROS resultados: el final de 732
 *     caracteres de las 19:04:07 empezó a mitad de frase (« a detalle tres
 *     veces…») y la caja quedó congelada de 19:03:07 a 19:04:07.
 *   - En un reinicio a MITAD de frase (onend sin commit), la hipótesis parcial de
 *     la sesión nueva REEMPLAZABA el texto del tramo y borraba de la caja lo ya
 *     dicho antes del corte (P2 del dueño: «no está transcribiendo todo»).
 *
 * DÓNDE VIVE LA BARRERA. El hecho «empezó una sesión del reconocedor» ya tiene
 * dueño: `Recognition.onstart` → `abrirMotorConversacion()` (su ÚNICO llamador)
 * → `producto.abrir()`. Ahí la frontera vuelve a `FRONTERA_INICIAL` y se abre la
 * ventana de sesión: la hipótesis de la sesión es PARCIAL y se compone sobre la
 * base que la línea tenía al arrancar; el commit cierra la ventana y vuelve el
 * reemplazo. `composicion.ts` sigue siendo el dueño del índice; no hay dedupe
 * por texto (D11).
 *
 * FALSIFICACIÓN: conservar el `corte` viejo sobre el mismo evento del 19:04:07
 * muerde su primer resultado (primer caso, sin motor).
 */
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { fluDb } from '../src/core/db/fluDatabase'
import { crearMotorConversacionProducto } from '../src/voice/conversation/index'
import type { EventoConversacion, EventoProducto } from '../src/voice/conversation/index'
import { FRONTERA_INICIAL, componerEvento } from '../src/voice/conversation/composicion'
import { getVadEnergyThreshold } from '../src/voice/lib/asr/asrConfig.js'

const SAMPLE_RATE = 16000
const BLOQUE = 1600 // 100 ms

/** Fila de la sesión ANTERIOR del reconocedor (ya commiteada: corte = 1). */
const TEXTO_P = 'antes del corte ya estaba escrito'
/** Final completo de la sesión nueva (evento medido: empezaba « a detalle…»). */
const COMPLETA = 'a detalle tres veces puso necesita'
/** Sus dos resultados reales: el final del tramo y su cola interina. */
const FINAL = 'a detalle tres veces'
const COLA = 'puso necesita'

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

/** Evento ACUMULADO, la forma real de Chrome (el array solo crece). */
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

/** Evento REEMPLAZADO, la forma del motor local (longitud 1). */
function eventoReemplazado(texto: string, final = false): EventoProducto {
  return {
    resultIndex: 0,
    results: [{ 0: { transcript: texto }, isFinal: final, length: 1 }],
  }
}

/** 1 s de silencio + 1 s de voz: abre el tramo de una locución nueva. */
function abrirLocucion(motor: Motor, base: number): void {
  for (let i = 0; i < 10; i += 1) motor.audio(silencio(100), SAMPLE_RATE, base + i * BLOQUE)
  for (let i = 0; i < 10; i += 1) {
    motor.audio(tono(100), SAMPLE_RATE, base + 16000 + i * BLOQUE)
  }
}

/** Espera el próximo `row.committed`. */
function esperarCommit(
  motor: Motor,
): Promise<Extract<EventoConversacion, { tipo: 'row.committed' }>> {
  return new Promise((resolver) => {
    motor.suscribir((evento) => {
      if (evento.tipo === 'row.committed') {
        resolver(evento as Extract<EventoConversacion, { tipo: 'row.committed' }>)
      }
    })
  })
}

beforeEach(async () => {
  await fluDb.conversations.clear()
})

describe('BARRERA frontera-sesion — la frontera es de UNA sesión del reconocedor', () => {
  it('falsificación: el corte heredado muerde el primer resultado de la sesión nueva', () => {
    const evento = eventoAcumulado(
      [
        { texto: FINAL, final: true },
        { texto: COLA, final: false },
      ],
      0,
    )
    // Con el `corte` de la sesión vieja sobre el array NUEVO (el defecto del
    // 19:04:07), el primer resultado (el final del tramo) desaparece y solo
    // queda su cola interina.
    const heredada = componerEvento(evento, { corte: 1, ultimoFinal: 0 })
    expect(heredada.trozo).not.toContain('a detalle')
    expect(heredada.trozo).toContain('puso necesita')
    // Desde la frontera de SU sesión, la hipótesis arranca en el índice 0.
    const propia = componerEvento(evento, FRONTERA_INICIAL)
    expect(propia.trozo).toContain('a detalle')
  })

  it('sesión nueva tras el commit: su primer evento multi-resultado no se muerde', async () => {
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
    })
    const filas: string[] = []
    motor.suscribir((evento: EventoConversacion) => {
      if (evento.tipo === 'row.committed') filas.push(evento.fila.texto)
    })
    // Sesión 1: una locución con su fila (el commit deja `corte` = 1).
    motor.abrir()
    abrirLocucion(motor, 0)
    await motor.evento(eventoReemplazado(TEXTO_P, true))
    const cierreP = esperarCommit(motor)
    motor.audio(silencio(5000), SAMPLE_RATE, 32000)
    await cierreP
    // Onstart (reinicio del reconocedor): SESIÓN NUEVA. Su primer evento ya
    // trae índice 0 con el final del tramo: el corte viejo lo mordería.
    motor.abrir()
    abrirLocucion(motor, 120000)
    const cierre = esperarCommit(motor)
    await motor.evento(
      eventoAcumulado(
        [
          { texto: FINAL, final: true },
          { texto: COLA, final: false },
        ],
        0,
      ),
    )
    expect(motor.instantanea().box.texto).toContain('a detalle')
    await motor.evento(eventoAcumulado([{ texto: COMPLETA, final: true }], 0))
    motor.audio(silencio(5000), SAMPLE_RATE, 152000)
    await cierre
    expect(filas).toHaveLength(2)
    expect(filas.at(-1)).toContain(COMPLETA)
  })

  it('sesión nueva a MITAD de frase: la base ya dicha no se borra', async () => {
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
    await motor.evento(eventoReemplazado('necesito para mi', false))
    expect(motor.instantanea().box.texto).toContain('necesito para mi')
    // onend → onstart a mitad de frase: NO hubo silencio ni commit; el tramo
    // sigue y su audio sigue entrando.
    motor.abrir()
    for (let i = 0; i < 10; i += 1) {
      motor.audio(tono(100), SAMPLE_RATE, 32000 + i * BLOQUE)
    }
    await motor.evento(eventoReemplazado('a detalle tres veces', false))
    const primera = motor.instantanea().box.texto
    expect(primera).toContain('necesito para mi')
    expect(primera).toContain('a detalle tres veces')
    expect(primera.indexOf('necesito')).toBeLessThan(primera.indexOf('a detalle'))
    // Chrome revisa su hipótesis: la base NO puede borrarse de la caja.
    await motor.evento(eventoReemplazado('a detalle tres veces puso necesita', false))
    const revisada = motor.instantanea().box.texto
    expect(revisada).toContain('necesito para mi')
    expect(revisada).toContain('puso necesita')
    const cierre = esperarCommit(motor)
    motor.audio(silencio(5000), SAMPLE_RATE, 48000)
    await cierre
    const fila = filas.at(-1)!
    expect(fila).toContain('necesito para mi')
    expect(fila).toContain('puso necesita')
    expect(fila.match(/necesito para mi/g) ?? []).toHaveLength(1)
  })

  it('el límite declara la sesión en abrir() y el hecho viene de onstart', () => {
    const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), 'utf8')
    const producto = leer('src/voice/conversation/producto.ts')
    // El reset va ANTES del retorno temprano: el reinicio ocurre con el motor
    // YA activo (Caso 13: la sesión del módulo sobrevive).
    const reset = producto.indexOf('frontera = FRONTERA_INICIAL')
    expect(reset).toBeGreaterThan(-1)
    expect(reset).toBeLessThan(producto.indexOf("if (estadoMotor !== 'inactiva') return"))
    expect(producto).toContain('let sesionNueva = true')
    expect(producto).toContain(
      'const reemplaza = !sesionNueva && (hayFinal || !compuesta.nuevaInstancia)',
    )
    expect(producto).toContain("sesionNueva ? null : libroDeLinea")
    const hook = leer('src/voice/hooks/useFluVoiceAssistant.js')
    const onstart = hook.indexOf('Recognition.onstart = () =>')
    expect(onstart).toBeGreaterThan(-1)
    expect(hook.indexOf('abrirMotorConversacion()', onstart)).toBeGreaterThan(onstart)
  })
})
