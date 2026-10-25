// @vitest-environment node
/**
 * FIXTURE SINTÉTICO del módulo CONVERSACIÓN.
 *
 * No existe grabación del dueño: este fixture reconstruye la FORMA medida del
 * ASR (interinos que crecen, un final limpio, varios tramos) y fija el conteo
 * `N/0/0` del plan: N locuciones producen N filas, 0 pérdidas y 0 duplicados.
 * El valor N de la aceptación REAL sigue PENDIENTE: no se inventa.
 *
 * Determinista: reloj fijo, ids inyectados y sin timers. El almacén es el real
 * en memoria del módulo.
 */
import { describe, expect, it } from 'vitest'
import {
  CONVERSACION_CONFIG,
  crearAlmacenMemoria,
  crearConversacion,
  crearPartidorWake,
} from '../src/voice/conversation/index'
import type { InstantaneaConversacion } from '../src/voice/conversation/index'
import type {
  ConfigPort,
  ConfiguracionConversacion,
  IdPort,
} from '../src/voice/conversation/ports'

type LocucionFixture = Readonly<{
  interinos: readonly string[]
  final: string
}>

/**
 * Tres locuciones con la forma del ASR real: el interino tartamudea y el final
 * llega limpio; la segunda revisa el texto sin perder palabras.
 */
const FIXTURE: readonly LocucionFixture[] = [
  { interinos: ['hola', 'hola flu'], final: 'hola flu' },
  { interinos: ['pon', 'pon una', 'pon una nota'], final: 'pon una nota' },
  { interinos: ['que', 'que tal'], final: 'que tal' },
]

/** Reloj fijo: la sesión no depende de la hora de la máquina. */
const RELOJ = { ahora: () => 1_700_000_000_000 }

/** Id determinista por tramo para que dos corridas cuenten lo mismo. */
function crearIdDeterminista(): IdPort {
  let siguiente = 0
  return {
    uuid: () => {
      siguiente += 1
      return `00000000-0000-4000-8000-${String(siguiente).padStart(12, '0')}`
    },
  }
}

/** Id de tramo determinista y con forma UUIDv4 (el motor lo exige). */
function tramoDe(indice: number): string {
  return `00000000-0000-4000-8000-${String(indice + 100).padStart(12, '0')}`
}

/** Configuración del plan con el motor nuevo y wake declarada. */
function configNueva(): ConfiguracionConversacion {
  return { ...CONVERSACION_CONFIG, conversation: { engine: 'new' } }
}

/** Monta el motor como el producto: puertos reales y almacén en memoria. */
function crearMotorDeFixture() {
  const config: ConfigPort = {
    wakeWords: () => ['ok flu'],
    semillaEtiqueta: () => 'Hablante 1',
  }
  const almacen = crearAlmacenMemoria({ reloj: RELOJ })
  const api = crearConversacion({
    reloj: RELOJ,
    id: crearIdDeterminista(),
    registro: { registrar: () => undefined },
    almacen,
    config,
    partidor: crearPartidorWake(config),
    configuracion: configNueva(),
    ultimoTextoDicho: () => '',
  })
  return { api, almacen }
}

/** Ingesta una locución completa con su tramo y devuelve su texto final. */
async function ingestarLocucion(
  api: ReturnType<typeof crearConversacion>,
  locucion: LocucionFixture,
  indice: number,
  tramoId: string,
): Promise<void> {
  const tramo = { inicio: indice * 32_000, fin: (indice + 1) * 32_000, sampleRate: 16_000 }
  for (const texto of locucion.interinos) {
    await api.ingestAsr({ tramoId, texto, final: false, idioma: 'es', tramo, turnId: `turno-${indice}` })
  }
  await api.ingestAsr({ tramoId, texto: locucion.final, final: true, idioma: 'es', tramo, turnId: `turno-${indice}` })
}

/** Conteo del plan sobre la instantánea final. */
function contar(estado: InstantaneaConversacion): { filas: number; perdidas: number; duplicados: number } {
  const ids = estado.filas.map((fila) => fila.locutionId)
  return {
    filas: estado.filas.length,
    perdidas: estado.descartes.length,
    duplicados: ids.length - new Set(ids).size,
  }
}

describe('fixture sintético N/0/0 del motor de conversación', () => {
  it('N locuciones producen N filas, 0 pérdidas y 0 duplicados', async () => {
    const { api, almacen } = crearMotorDeFixture()
    await api.start({ turnId: 'turno-fijo', idioma: 'es' })

    for (let indice = 0; indice < FIXTURE.length; indice += 1) {
      const locucion = FIXTURE[indice]
      if (!locucion) throw new Error(`fixture sin locucion en el indice ${indice}`)
      await ingestarLocucion(api, locucion, indice, tramoDe(indice))
    }
    const estado = await api.stop('user')

    expect(contar(estado)).toEqual({ filas: FIXTURE.length, perdidas: 0, duplicados: 0 })
    expect(estado.filas.map((fila) => fila.texto)).toEqual(FIXTURE.map((locucion) => locucion.final))
    expect(estado.filas.every((fila) => fila.revision === 1 && fila.deleted === false)).toBe(true)

    const sessionId = estado.sessionId
    if (!sessionId) throw new Error('la sesion cerrada no expone sessionId')
    expect(await almacen.leerSesion(sessionId)).toHaveLength(FIXTURE.length)
  })

  it('la misma entrada produce el mismo conteo (determinista)', async () => {
    const primera = crearMotorDeFixture()
    await primera.api.start({ turnId: 'turno-fijo', idioma: 'es' })
    for (let indice = 0; indice < FIXTURE.length; indice += 1) {
      const locucion = FIXTURE[indice]
      if (!locucion) throw new Error(`fixture sin locucion en el indice ${indice}`)
      await ingestarLocucion(primera.api, locucion, indice, tramoDe(indice))
    }
    const estadoPrimera = await primera.api.stop('user')

    const segunda = crearMotorDeFixture()
    await segunda.api.start({ turnId: 'turno-fijo', idioma: 'es' })
    for (let indice = 0; indice < FIXTURE.length; indice += 1) {
      const locucion = FIXTURE[indice]
      if (!locucion) throw new Error(`fixture sin locucion en el indice ${indice}`)
      await ingestarLocucion(segunda.api, locucion, indice, tramoDe(indice))
    }
    const estadoSegunda = await segunda.api.stop('user')

    expect(contar(estadoSegunda)).toEqual(contar(estadoPrimera))
    expect(estadoSegunda.filas.map((fila) => fila.texto)).toEqual(
      estadoPrimera.filas.map((fila) => fila.texto),
    )
  })
})

