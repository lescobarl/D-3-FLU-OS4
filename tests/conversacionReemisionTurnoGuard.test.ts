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
 * texto y no se re-componen. La marca avanza cuando una fila commitea Y cuando
 * un final se APLICA (sin esperar el commit: entre uno y otro pueden mediar el
 * silencio de cierre o un worker ocupado — medido 994bbf46 2026-11-12, 61 s de
 * cola parada — y en esa ventana la re-emisión volvía a viajar). Un evento con
 * VARIOS finales compone el ÚLTIMO: la hipótesis más nueva viaja aunque la
 * frontera esté rancia (el final viejo retenido no puede taparla). Es POR
 * SESIÓN del reconocedor: `abrir()` (onstart) la reinicia a 0 porque la sesión
 * nueva no conserva los índices de la vieja. Con la frontera rancia el producto
 * reconoce la RE-EMISIÓN PURA del final retenido (texto igual a la última fila
 * commiteada) y no la ingesta; un final NUEVO más corto pinta limpio. El motor
 * local reemplaza el array en cada segmento (longitud 1): su composición queda
 * intacta y sus MÉTRICAS (siempre presentes) lo distinguen del replay.
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

/**
 * Reinyección 994bbf46: la narración larga (643 caracteres en vivo) cuyo final
 * retenido Chrome re-emitía delante de cada enunciado nuevo.
 */
const TEXTO_LARGO =
  'okay vamos a continuar hablando una voy a hablar un poco largo y posiblemente incoherente estamos viendo el tenis y el torneo en la television mientras grabamos esta sesion de prueba'
/** Enunciados nuevos del dueño, tapados por el final retenido en vivo. */
const TEXTO_NUEVO_A = 'voy a preparar para que de una vez grabe la mujer'
const TEXTO_NUEVO_B = 'voy a pasarle la voz a una mujer'
/** La mujer: su final y su interino (en vivo el interino nunca llegó a final). */
const TEXTO_MUJER_F = 'conmigo'
const TEXTO_MUJER_I = 'de rodajas'

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
 * segmento sustituye el array completo y su longitud es siempre 1. Sus eventos
 * SIEMPRE traen métricas (whisperRecognitionEngine): el producto las usa para
 * no confundir su repetición legítima con el replay de Chrome (que no trae).
 */
function eventoReemplazado(texto: string, final = false): EventoProducto {
  return {
    resultIndex: 0,
    results: [{ 0: { transcript: texto }, isFinal: final, length: 1 }],
    metrics: { durationMs: 100, speechLikeMs: 80, rms: 0.2 },
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

  it('ciclo siguiente: al reabrir la escucha, la sesión nueva arranca en 0 y no se muerde', async () => {
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
    })
    const textos = textosCommiteados(motor)
    await filaP(motor)
    await motor.cerrar('user')
    // Reabre la escucha (ciclo continuo): onstart → `abrir()` declara la sesión
    // NUEVA del reconocedor y su array empieza en 0. Su primer evento trae ya
    // varios resultados (medido 2026-11-12 19:04:07): la frontera de la sesión
    // vieja no puede morderlos.
    motor.abrir()
    abrirLocucion(motor, 120000)
    await motor.evento(
      eventoAcumulado(
        [
          { texto: 'hacia el final', final: true },
          { texto: 'del dia', final: false },
        ],
        0,
      ),
    )
    const cierre = esperarCommit(motor)
    await motor.evento(
      eventoAcumulado([{ texto: 'hacia el final del dia completo', final: true }], 0),
    )
    motor.audio(silencio(5000), SAMPLE_RATE, 152000)
    await cierre
    // La frase del ciclo nuevo se escribe UNA vez y completa; el texto retenido
    // de la sesión vieja no viaja dentro de ella (el array nuevo no lo tiene).
    expect(textos).toEqual([TEXTO_P, 'hacia el final del dia completo'])
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

  it('FALSIFICACIÓN: la MISMA frase repetida tras un REBUILD SÍ se escribe', async () => {
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
    })
    const textos = textosCommiteados(motor)
    await filaP(motor)
    // Rebuild (watchdog): onstart -> `abrir()` -> sesión nueva, frontera 0.
    motor.abrir()
    // El replay de la sesión nueva trae el final retenido SOLO: el producto lo
    // descarta (texto igual a la última fila commiteada).
    abrirLocucion(motor, 160000)
    await motor.evento(eventoAcumulado([{ texto: TEXTO_P, final: true }], 0))
    // La MISMA voz repite la MISMA frase: su INTERINO pinta (palabra suya, D11
    // — el producto tampoco deduplica por texto entre locuciones)…
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
    // …y su FINAL igual a la última fila se descarta como replay, pero la línea
    // ya pintada commitea: la repetición conserva su fila.
    await motor.evento(
      eventoAcumulado(
        [
          { texto: TEXTO_P, final: true },
          { texto: TEXTO_P, final: true },
        ],
        1,
      ),
    )
    motor.audio(silencio(5000), SAMPLE_RATE, 192000)
    await cierre
    expect(textos).toEqual([TEXTO_P, TEXTO_P])
  })

  it('994bbf46: tras un rebuild con la frontera rancia, los finales nuevos no se tapan', async () => {
    // REINYECCIÓN de la sesión viva 994bbf46 (2026-11-12 22:08-22:19): el
    // watchdog reconstruyó el reconocedor -> onstart -> `abrir()` dejó la
    // frontera en 0. La instancia NUEVA de Chrome re-emite delante el final
    // retenido de la narración (643 caracteres en vivo) y acumula detrás los
    // enunciados nuevos. Con la frontera rancia el final largo GANABA el merge
    // y tapaba todo: la frase se duplicaba y «voy a preparar…», «voy a pasarle
    // la voz a una mujer», «conmigo» y «de rodajas» nunca se escribieron.
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
    })
    const textos = textosCommiteados(motor)
    // La narración larga commitea su fila y la escucha sigue abierta.
    motor.abrir()
    abrirLocucion(motor, 0)
    await motor.evento(eventoReemplazado(TEXTO_LARGO, true))
    await cerrarLocucion(motor, 0)
    // El watchdog reconstruyó: onstart -> `abrir()` -> frontera en 0.
    motor.abrir()
    // Re-emisión del final retenido SOLO: el producto la reconoce (sesión
    // nueva, texto igual a la última fila commiteada) y NO la ingesta — la
    // línea abierta nunca lo adopta. La frontera avanza (corte 1): el
    // enunciado siguiente compone desde 1 y pinta limpio.
    abrirLocucion(motor, 160000)
    await motor.evento(eventoAcumulado([{ texto: TEXTO_LARGO, final: true }], 0))
    // El enunciado NUEVO llega con el final retenido delante (forma real de
    // Chrome): compone el ÚLTIMO final, no el largo.
    await motor.evento(
      eventoAcumulado(
        [
          { texto: TEXTO_LARGO, final: true },
          { texto: TEXTO_NUEVO_A, final: true },
        ],
        0,
      ),
    )
    await cerrarLocucion(motor, 160000)
    // Siguiente enunciado: la historia acumulada crece y el final nuevo es el
    // de atrás del todo.
    abrirLocucion(motor, 320000)
    await motor.evento(
      eventoAcumulado(
        [
          { texto: TEXTO_LARGO, final: true },
          { texto: TEXTO_NUEVO_A, final: true },
          { texto: TEXTO_NUEVO_B, final: true },
        ],
        0,
      ),
    )
    await cerrarLocucion(motor, 320000)
    // La mujer: su final corto llega detrás de la historia acumulada.
    abrirLocucion(motor, 480000)
    await motor.evento(
      eventoAcumulado(
        [
          { texto: TEXTO_LARGO, final: true },
          { texto: TEXTO_NUEVO_A, final: true },
          { texto: TEXTO_NUEVO_B, final: true },
          { texto: TEXTO_MUJER_F, final: true },
        ],
        0,
      ),
    )
    await cerrarLocucion(motor, 480000)
    // Su interino (nunca llegó a final en vivo) también viaja: la frontera ya
    // cubre los finales de atrás.
    abrirLocucion(motor, 640000)
    await motor.evento(
      eventoAcumulado(
        [
          { texto: TEXTO_LARGO, final: true },
          { texto: TEXTO_NUEVO_A, final: true },
          { texto: TEXTO_NUEVO_B, final: true },
          { texto: TEXTO_MUJER_F, final: true },
          { texto: TEXTO_MUJER_I, final: false },
        ],
        0,
      ),
    )
    await cerrarLocucion(motor, 640000)
    // Nada se duplica y nada de lo nuevo se pierde.
    expect(textos).toEqual([
      TEXTO_LARGO,
      TEXTO_NUEVO_A,
      TEXTO_NUEVO_B,
      TEXTO_MUJER_F,
      TEXTO_MUJER_I,
    ])
  })
})
