// @vitest-environment node
// BARRERA: reemision-turno
/**
 * REEMISIÓN DEL FINAL RETENIDO — la frase ya escrita no vuelve a entregarse.
 *
 * DEFECTO MEDIDO EN VIVO (2026-11-12): «después que cierro la escucha escribe
 * cosas que ya había escrito antes». El reconocedor ACUMULA los resultados de
 * su instancia y re-emite delante el final retenido del enunciado anterior
 * (patrones 10/11, medido 8f3112c2). El límite del producto componía la
 * hipótesis completa desde 0 y la frase ya commiteada viajaba dentro de la
 * frase nueva: un `[P final, Q final]` se escribía como «P Q».
 *
 * DÓNDE VIVE LA BARRERA. NO en el módulo: el módulo nunca deduplica por texto
 * entre turnos (D11 — la repetición legítima tras pausa conserva su fila).
 * Vive en el LÍMITE DEL PRODUCTO, como marca de TRANSPORTE por índice
 * (`corteFinales`): una fila commiteada cubre los resultados que sostuvieron su
 * texto y no se re-componen. El motor local reemplaza el array en cada segmento
 * (longitud 1), así que su composición queda intacta.
 *
 * Se mide con el PRODUCTO REAL (Dexie + VAD real sobre tonos) y eventos con la
 * forma de Chrome (resultados que SOLO crecen).
 *
 * FALSIFICACIONES: (a) la MISMA frase repetida tras una pausa SÍ se escribe
 * (otra vez, con su fila); (b) un motor que REEMPLAZA el array por segmento
 * (longitud 1) sigue transcribiendo tras un commit.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { fluDb } from '../src/core/db/fluDatabase'
import { crearMotorConversacionProducto } from '../src/voice/conversation/index'
import type { EventoConversacion, EventoProducto } from '../src/voice/conversation/index'
import { getVadEnergyThreshold } from '../src/voice/lib/asr/asrConfig.js'

const SAMPLE_RATE = 16000
const BLOQUE = 1600 // 100 ms

/** Frase de la primera locución (ya commiteada cuando llega la reemisión). */
const TEXTO_P = 'uno dos tres cuatro cinco seis siete ocho'

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

/**
 * Evento REEMPLAZADO, la forma del motor local (`buildResultEvent`): cada
 * segmento sustituye el array completo y su longitud es siempre 1.
 */
function eventoReemplazado(texto: string, final = false): EventoProducto {
  return {
    resultIndex: 0,
    results: [{ 0: { transcript: texto }, isFinal: final, length: 1 }],
  }
}

/** Recolecta los textos de las filas commiteadas (viven la sesión entera). */
function textosCommiteados(motor: Motor): string[] {
  const textos: string[] = []
  motor.suscribir((evento) => {
    if (evento.tipo === 'row.committed') textos.push(evento.fila.texto)
  })
  return textos
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

/** 1 s de silencio + 1 s de voz: abre el tramo de una locución nueva. */
function abrirLocucion(motor: Motor, base: number): void {
  for (let i = 0; i < 10; i += 1) motor.audio(silencio(100), SAMPLE_RATE, base + i * BLOQUE)
  for (let i = 0; i < 10; i += 1) {
    motor.audio(tono(100), SAMPLE_RATE, base + 16000 + i * BLOQUE)
  }
}

/** CORTE de 5 s de silencio (puerta de abajo): commitea la fila abierta. */
function cerrarLocucion(motor: Motor, base: number): Promise<EventoConversacion> {
  const cierre = esperarCommit(motor)
  motor.audio(silencio(5000), SAMPLE_RATE, base + 32000)
  return cierre
}

/**
 * Primera locución del escenario: se commitea por silencio (fila P) y la
 * sesión SIGUE ABIERTA, igual que el ciclo real de la escucha.
 */
async function filaP(motor: Motor): Promise<void> {
  motor.abrir()
  abrirLocucion(motor, 0)
  await motor.evento(eventoReemplazado(TEXTO_P, true))
  await cerrarLocucion(motor, 0)
}

beforeEach(async () => {
  await fluDb.conversations.clear()
})

describe('reemisión del final retenido — la frase ya commiteada no se repite', () => {
  it('misma sesión: el final retenido delante del enunciado nuevo no se escribe', async () => {
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
    })
    const textos = textosCommiteados(motor)
    await filaP(motor)
    // Chrome sigue acumulando: el enunciado nuevo llega CON el final anterior
    // delante en el mismo array.
    abrirLocucion(motor, 120000)
    await motor.evento(
      eventoAcumulado(
        [
          { texto: TEXTO_P, final: true },
          { texto: 'nueve diez', final: false },
        ],
        1,
      ),
    )
    const cierre = esperarCommit(motor)
    await motor.evento(
      eventoAcumulado(
        [
          { texto: TEXTO_P, final: true },
          { texto: 'nueve diez once doce', final: true },
        ],
        1,
      ),
    )
    motor.audio(silencio(5000), SAMPLE_RATE, 152000)
    await cierre
    // Sin la barrera el final compuesto desde 0 escribía «P nueve…» (frase ya
    // escrita otra vez); con ella, solo el enunciado nuevo.
    expect(textos).toEqual([TEXTO_P, 'nueve diez once doce'])
  })

  it('ciclo siguiente: el retenido re-emitido al reabrir la escucha no se escribe', async () => {
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
    })
    const textos = textosCommiteados(motor)
    await filaP(motor)
    await motor.cerrar('user')
    // Reabre la escucha (ciclo continuo): el reconocedor SIGUE VIVO y
    // reintenta delante su final retenido.
    motor.abrir()
    abrirLocucion(motor, 120000)
    await motor.evento(
      eventoAcumulado(
        [
          { texto: TEXTO_P, final: true },
          { texto: 'hacia el final', final: false },
        ],
        1,
      ),
    )
    const cierre = esperarCommit(motor)
    await motor.evento(
      eventoAcumulado(
        [
          { texto: TEXTO_P, final: true },
          { texto: 'hacia el final del dia', final: true },
        ],
        1,
      ),
    )
    motor.audio(silencio(5000), SAMPLE_RATE, 152000)
    await cierre
    expect(textos).toEqual([TEXTO_P, 'hacia el final del dia'])
  })

  it('FALSIFICACIÓN: la MISMA frase repetida tras una pausa SÍ se escribe', async () => {
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
    })
    const textos = textosCommiteados(motor)
    await filaP(motor)
    // La misma voz repite la misma frase: palabra suya, otra fila (D11 — el
    // módulo no deduplica por texto entre turnos; la barrera es de ÍNDICE y
    // solo recorta lo que una fila ya cubrió).
    abrirLocucion(motor, 120000)
    await motor.evento(
      eventoAcumulado(
        [
          { texto: TEXTO_P, final: true },
          { texto: TEXTO_P, final: false },
        ],
        1,
      ),
    )
    const cierre = esperarCommit(motor)
    await motor.evento(
      eventoAcumulado(
        [
          { texto: TEXTO_P, final: true },
          { texto: TEXTO_P, final: true },
        ],
        1,
      ),
    )
    motor.audio(silencio(5000), SAMPLE_RATE, 152000)
    await cierre
    expect(textos).toEqual([TEXTO_P, TEXTO_P])
  })

  it('FALSIFICACIÓN: el motor que REEMPLAZA el array sigue transcribiendo tras un commit', async () => {
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
    })
    const textos = textosCommiteados(motor)
    await filaP(motor)
    // El motor local emite cada segmento como un array NUEVO de longitud 1:
    // `total` nunca supera la frontera y su texto debe entregarse igual.
    abrirLocucion(motor, 120000)
    const cierre = esperarCommit(motor)
    await motor.evento(eventoReemplazado('segmento del motor local', true))
    motor.audio(silencio(5000), SAMPLE_RATE, 152000)
    await cierre
    expect(textos).toEqual([TEXTO_P, 'segmento del motor local'])
  })
})
