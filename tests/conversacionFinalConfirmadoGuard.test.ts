// BARRERA: final-confirmado
// @vitest-environment node
/**
 * conversacionFinalConfirmadoGuard — la fila adelanta con el final + silencio
 * de reloj confirmado (`finalCloseConfirmMs`), SIN que el final cierre por
 * contenido.
 *
 * Escenario del dueño (2026-11-12): «hablo, hago silencio, ya está escrito todo
 * y tarda mucho». La fila esperaba el silencio VAD completo (3,5 s, reseteado
 * por cualquier ruido). Ahora el final del ASR ARMA una ventana de reloj y la
 * frontera cierra con `finalCloseConfirmMs` (800 ms) de silencio SIN voz; cada
 * bloque con voz rearma la marca, así que una pausa interna no dispara la
 * ventana a media frase. La puerta de abajo (silencio VAD >= `silenceCloseMs`)
 * sigue como respaldo.
 *
 * LÍMITE MEDIDO: el final de Chrome llega ~1 s después del último audio. Una
 * pausa interna con regreso ANTES de `finalCloseConfirmMs` tras el final no
 * parte la frase (reinyección de 263adae9). Un regreso DESPUÉS de la ventana
 * parte la frase (el módulo no ve el futuro); la palanca del plan es
 * `finalCloseConfirmMs` (el caso con 2000 ms lo demuestra).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'
import {
  CONVERSACION_CONFIG,
  crearAlmacenMemoria,
  crearConversacion,
  crearIdUuid,
  crearMedidorTramo,
  crearPartidorWake,
} from '../src/voice/conversation/index'
import { crearVadProducto } from '../src/voice/conversation/adapters.ts'
import type {
  ConfigPort,
  ConfiguracionConversacion,
  MedidaVad,
} from '../src/voice/conversation/ports.ts'
import type {
  ConversacionApi,
  DependenciasConversacion,
  EventoConversacion,
} from '../src/voice/conversation/index'

const FRONTERA = readFileSync(
  join(process.cwd(), 'src/voice/conversation/frontera.ts'),
  'utf8',
)
const TEXTO = readFileSync(
  join(process.cwd(), 'src/voice/conversation/texto.ts'),
  'utf8',
)
const INGESTA = readFileSync(
  join(process.cwd(), 'src/voice/conversation/ingesta.ts'),
  'utf8',
)
const ADAPTERS = readFileSync(
  join(process.cwd(), 'src/voice/conversation/adapters.ts'),
  'utf8',
)

const SAMPLE_RATE = 16000
const VOZ = (): MedidaVad => ({ hayVoz: true, silencioMs: 0 })
const SILENCIO = (silencioMs: number): MedidaVad => ({ hayVoz: false, silencioMs })

/** Reloj controlado: el test avanza el tiempo del módulo en ms. */
let ahoraMs = 0
/** Cursor de muestras de la sesión sintética. */
let cursor = 0

type Escenario = Readonly<{ api: ConversacionApi }>

/** Monta el módulo REAL con el reloj controlado y la tabla inyectada. */
function crearEscenario(
  configuracion: ConfiguracionConversacion = CONVERSACION_CONFIG,
): Escenario {
  cursor = 0
  ahoraMs = 0
  const reloj = { ahora: () => ahoraMs }
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
    vad: crearVadProducto(),
    ultimoTextoDicho: () => '',
    configuracion,
  }
  return { api: crearConversacion(dependencias) }
}

const filasDe = (api: ConversacionApi) => api.snapshot().filas

/** Bloque de audio de `ms` con su medida; el reloj avanza lo mismo. */
async function entregarBloque(
  api: ConversacionApi,
  medida: MedidaVad,
  ms: number,
): Promise<void> {
  const muestras = Math.round((SAMPLE_RATE * ms) / 1000)
  ahoraMs += ms
  await api.ingestAudio({
    muestras: new Float32Array(muestras),
    sampleRate: SAMPLE_RATE,
    inicio: cursor,
    fin: cursor + muestras,
    medida,
  })
  cursor += muestras
}

/** Evento ASR final del turno (el módulo resuelve el tramo vigente). */
async function frase(
  api: ConversacionApi,
  texto: string,
  turnId: string,
): Promise<void> {
  await api.ingestAsr({ tramoId: '', texto, final: true, turnId })
}

describe('confirmación del final — la fila adelanta sin cerrar por contenido', () => {
  it('final + 800 ms de silencio de reloj => fila commiteada ANTES de los 3,5 s del VAD', async () => {
    const escenario = crearEscenario()
    const eventos: EventoConversacion[] = []
    escenario.api.subscribe((evento) => eventos.push(evento))
    await escenario.api.start({ turnId: 'T1' })

    await entregarBloque(escenario.api, VOZ(), 1000)
    await frase(escenario.api, 'ok flu crea una cita', 'T1')
    expect(filasDe(escenario.api)).toHaveLength(0)
    // 800 ms de silencio (menos que minSilenceMs y mucho menos que la puerta
    // de abajo): la ventana de confirmación cierra la fila EN EL ACTO.
    await entregarBloque(escenario.api, SILENCIO(800), 800)

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(1)
    expect(filas[0]!.texto).toBe('ok flu crea una cita')
    const causas = eventos
      .filter(
        (evento): evento is Extract<EventoConversacion, { tipo: 'locution.closed' }> =>
          evento.tipo === 'locution.closed',
      )
      .map((evento) => evento.causa)
    expect(causas).toContain('silencio')
  })

  it('la voz durante la ventana rearma la marca: no cierra a media frase', async () => {
    const escenario = crearEscenario()
    await escenario.api.start({ turnId: 'T1' })

    await entregarBloque(escenario.api, VOZ(), 1000)
    await frase(escenario.api, 'ok flu crea una cita', 'T1')
    await entregarBloque(escenario.api, SILENCIO(400), 400)
    expect(filasDe(escenario.api)).toHaveLength(0)
    // La persona sigue hablando: cada bloque con voz rearma la ventana.
    await entregarBloque(escenario.api, VOZ(), 400)
    await entregarBloque(escenario.api, SILENCIO(400), 400)
    expect(filasDe(escenario.api)).toHaveLength(0)
    // Solo tras 800 ms SIN voz desde el último bloque con voz cierra.
    await entregarBloque(escenario.api, SILENCIO(400), 400)
    expect(filasDe(escenario.api)).toHaveLength(1)
  })

  it('sin final aplicado la ventana NO existe: solo la puerta de abajo cierra', async () => {
    const escenario = crearEscenario()
    await escenario.api.start({ turnId: 'T1' })

    await entregarBloque(escenario.api, VOZ(), 1000)
    // Texto por interino (SIN final): la locución tiene qué decir, pero la
    // ventana de confirmación no existe.
    await escenario.api.ingestAsr({
      tramoId: '',
      texto: 'ok flu crea una cita',
      final: false,
      turnId: 'T1',
    })
    // 1,5 s de silencio: el reloj ya superó la ventana, pero no hay final.
    await entregarBloque(escenario.api, SILENCIO(1500), 1500)
    expect(filasDe(escenario.api)).toHaveLength(0)
    // La puerta de abajo (silencio VAD completo) sigue cerrando.
    await entregarBloque(escenario.api, SILENCIO(3500), 3500)
    expect(filasDe(escenario.api)).toHaveLength(1)
  })

  it('REINYECCIÓN 263adae9: pausa interna de 1,5 s con el final a mitad => UNA fila', async () => {
    // El final de Chrome llega ~1 s después del último audio; la voz regresa a
    // los 1,5 s. La ventana (800 ms) no alcanza a disparar: regreso a 500 ms
    // del final. Con el reloj REAL (el fixture histórico lo tenía fijo).
    const escenario = crearEscenario()
    await escenario.api.start({ turnId: 'T5' })

    await entregarBloque(escenario.api, VOZ(), 1000)
    await entregarBloque(escenario.api, SILENCIO(1000), 1000)
    await frase(escenario.api, 'ok flu crea una cita', 'T5')
    await entregarBloque(escenario.api, SILENCIO(500), 500)
    // La voz vuelve: rearma la ventana y el tramo NUEVO continúa la frase.
    await entregarBloque(escenario.api, VOZ(), 500)
    await frase(escenario.api, 'ok flu crea una cita con el doctor', 'T5')
    // La confirmación del SEGUNDO final cierra la fila completa.
    await entregarBloque(escenario.api, SILENCIO(800), 800)

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(1)
    expect(filas[0]!.texto).toBe('ok flu crea una cita con el doctor')
  })

  it('LÍMITE: con el default, un final al ARRANCAR una pausa larga parte la frase (la palanca lo protege)', async () => {
    // Documenta la frontera del trade-off: si el final llegara en el instante
    // en que empieza una pausa de 1,5 s, la ventana de 800 ms dispara antes del
    // regreso y la continuación abre una fila nueva. No es el caso medido de
    // Chrome (el final llega a mitad de la pausa), pero es el límite que la
    // palanca `finalCloseConfirmMs` mueve.
    const escenario = crearEscenario({ ...CONVERSACION_CONFIG, finalCloseConfirmMs: 2000 })
    await escenario.api.start({ turnId: 'T5' })

    await entregarBloque(escenario.api, VOZ(), 1000)
    await frase(escenario.api, 'ok flu crea una cita', 'T5')
    await entregarBloque(escenario.api, SILENCIO(1500), 1500)
    // Con la palanca en 2000 la pausa de 1,5 s NO parte la frase.
    expect(filasDe(escenario.api)).toHaveLength(0)
    await entregarBloque(escenario.api, VOZ(), 500)
    await frase(escenario.api, 'ok flu crea una cita con el doctor', 'T5')
    await entregarBloque(escenario.api, SILENCIO(3500), 3500)

    const filas = filasDe(escenario.api)
    expect(filas).toHaveLength(1)
    expect(filas[0]!.texto).toBe('ok flu crea una cita con el doctor')
  })

  it('los literales de la confirmación viven en sus dueños (fuente)', () => {
    expect(FRONTERA).toContain('finalDesdeMs')
    expect(FRONTERA).toContain('finalCloseConfirmMs')
    expect(TEXTO).toContain('confirmacionFinalDesdeMs')
    expect(INGESTA).toContain('confirmacionFinalDesdeMs')
    expect(ADAPTERS).toContain('rachaVoz')
    // El final sigue SIN cerrar por contenido: la marca solo arma la ventana.
    expect(FRONTERA).not.toContain('finalDeFrase')
    expect(TEXTO).not.toContain('finalDeFrase')
    // La frontera conserva sus DOS puertas (la confirmación es silencio).
    const puertas = (FRONTERA.match(/return\s*\{\s*cerrar:\s*true/g) ?? []).length
    expect(puertas).toBe(2)
  })
})
