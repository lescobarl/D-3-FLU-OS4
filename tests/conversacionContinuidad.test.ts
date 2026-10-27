// @vitest-environment node
/**
 * CONTINUIDAD DE VOZ — guard de la SESIÓN (dueño: `crearReglasCierre`).
 *
 * `conversacionFila.test.ts` ya cubre la tabla de prioridad pura de
 * `resolverEtiqueta`; aquí se mide la decisión que NO es pura: quién decide si
 * una locución SIN medida hereda la etiqueta anterior de la MISMA sesión.
 * Reglas del mandato (2026-10-25):
 *   P3  tras "soy Luis", la siguiente locución sin medida queda `Luis`;
 *   P3b otra voz (vozId distinto) NO hereda el nombre de la voz anterior;
 *   sin etiqueta anterior → semilla, nunca `?`.
 *
 * FALSIFICACIÓN (par de mutaciones): si el módulo heredara a ciegas, el caso de
 * otra voz es ROJO; si nunca heredara, el caso sin medida es ROJO.
 */
import { describe, expect, it } from 'vitest'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'
import { crearReglasCierre, resolverVoz } from '../src/voice/conversation/cierre.ts'
import type { EstadoCierre, ReglasCierre } from '../src/voice/conversation/cierre.ts'
import type { Fila, FilaNueva } from '../src/voice/conversation/ports.ts'
import type { EvidenciaVoz } from '../src/voice/conversation/tipos.ts'

const SEMILLA = 'Hablante 1'
const UUIDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
  '77777777-7777-4777-8777-777777777777',
]

/** Sesión de prueba: estado real de cierre + almacén que devuelve la fila. */
type Probe = Readonly<{ estado: EstadoCierre; reglas: ReglasCierre }>

/** Observación de una locución: continuidad decidida y fila resultante. */
type Observacion = Readonly<{
  continuidadApertura: boolean
  continuidadRevision: boolean
  fila: Fila
}>

/** Crea el estado mínimo de la sesión con una etiqueta y voz previas. */
function crearProbe(ultimaVozId = '', ultimaEtiqueta = ''): Probe {
  const estado: EstadoCierre = {
    sessionId: 'sesion-guard',
    abierta: null,
    ultimaEtiqueta,
    ultimaVozId,
    filas: new Map(),
    nombresPorVoz: new Map(),
    muestrasAbierta: [],
    ultimoVectorVoz: null,
    contadorVoces: 0,
  }
  const reglas = crearReglasCierre({
    estado,
    emitir: () => {},
    emitirCaja: () => {},
    contarDescarte: () => {},
    registro: { registrar: () => {} },
    almacen: {
      guardar: async (fila: FilaNueva): Promise<Fila> => ({ ...fila, revision: 1, updated_at: 0, deleted: false }),
      actualizar: async () => null,
    },
    config: {
      wakeWords: () => ['ok flu'],
      semillaEtiqueta: () => SEMILLA,
      esEtiquetaAnonima: isAutoSpeakerLabel,
      umbralContinuidadVoz: () => 0.8,
      etiquetaAnonima: (indice) => `Hablante ${indice}`,
      echoMinPalabrasCola: () => 4,
    },
    id: { uuid: () => '00000000-0000-4000-8000-000000000001' },
  })
  return { estado, reglas }
}

/**
 * Corre una locución completa (abrir → revisar → cerrar) sobre la MISMA sesión.
 * @param probe Sesión de prueba que conserva `ultimaEtiqueta`/`ultimaVozId`.
 * @param vozApertura Evidencia con la que abre la locución.
 * @param vozRevision Evidencia que trae la revisión (por defecto, ninguna).
 * @param uuid `locutionId` válido de la locución.
 * @returns La continuidad decidida en cada paso y la fila cerrada.
 */
async function correrLocucion(
  probe: Probe,
  vozApertura: EvidenciaVoz,
  vozRevision: EvidenciaVoz,
  uuid: string,
): Promise<Observacion> {
  const { estado, reglas } = probe
  reglas.abrirLocucion({
    tramoId: uuid,
    texto: 'hola',
    tramo: { inicio: 0, fin: 16000, sampleRate: 16000 },
    turnId: 'turno-guard',
    idioma: 'es',
    voz: vozApertura,
  })
  const abierta = estado.abierta
  if (!abierta) throw new Error('no abrió la locución')
  const continuidadApertura = abierta.continuidadVoz
  reglas.aplicarRevision(abierta, 'hola mundo', false, vozRevision)
  const revisada = estado.abierta
  if (!revisada) throw new Error('la revisión cerró la locución')
  const continuidadRevision = revisada.continuidadVoz
  await reglas.cerrarLocucion(revisada, 'system', 'final', true)
  const fila = estado.filas.get(uuid)
  if (!fila) throw new Error('no se escribió la fila')
  return { continuidadApertura, continuidadRevision, fila }
}

describe('continuidad de voz — decisión de la sesión', () => {
  it('P3: tras "soy Luis", la siguiente locución SIN medida queda Luis (continuidad, no semilla)', async () => {
    const probe = crearProbe()
    const identificada = await correrLocucion(
      probe,
      { nombre: 'Luis', nombreConfirmado: true },
      {},
      UUIDS[0]!,
    )
    expect(identificada.fila.etiqueta).toBe('Luis')
    expect(identificada.fila.evidencia).toBe('nombre')

    const siguiente = await correrLocucion(probe, {}, {}, UUIDS[1]!)
    expect(siguiente.continuidadApertura, 'sin medida hereda la etiqueta de la misma sesión').toBe(true)
    expect(siguiente.fila.etiqueta).toBe('Luis')
    expect(siguiente.fila.evidencia).toBe('continuidad')
  })

  it('misma voz medida (vozId igual al anterior) → continuidad, no semilla', async () => {
    const probe = crearProbe('voz-a', 'Luis')
    const obs = await correrLocucion(probe, { vozId: 'voz-a' }, { vozId: 'voz-a' }, UUIDS[2]!)
    expect(obs.continuidadApertura).toBe(true)
    expect(obs.fila.etiqueta).toBe('Luis')
    expect(obs.fila.evidencia).toBe('continuidad')
  })

  it('Hablante N no desplaza la continuidad sin evidencia positiva (bug 2026-10-26)', async () => {
    // Caso del dueño: la voz venía etiquetada 'Luis'; el preflight mide pero solo
    // produce una agrupación anónima ('Hablante 1'). Sin evidencia POSITIVA de
    // identidad (speakerCore:98), la etiqueta no puede pisar la continuidad.
    const probe = crearProbe('', 'Luis')
    const obs = await correrLocucion(probe, { hablante: 'Hablante 1' }, {}, UUIDS[6]!)
    expect(obs.continuidadApertura).toBe(true)
    expect(obs.fila.etiqueta).toBe('Luis')
    expect(obs.fila.evidencia).toBe('continuidad')
  })

  it('P3b: otra voz (vozId distinto) NO hereda el nombre de la voz anterior', async () => {
    const probe = crearProbe('voz-a', 'Luis')
    const obs = await correrLocucion(probe, { vozId: 'voz-b' }, { vozId: 'voz-b' }, UUIDS[3]!)
    expect(obs.continuidadApertura, 'otra voz no continúa la anterior').toBe(false)
    expect(obs.fila.etiqueta).not.toBe('Luis')
    expect(obs.fila.evidencia).toBe('semilla')
  })

  it('medida tardía de otra voz: la continuidad se recalcula y NO hereda', async () => {
    const probe = crearProbe('voz-a', 'Luis')
    const obs = await correrLocucion(probe, {}, { vozId: 'voz-b' }, UUIDS[4]!)
    expect(obs.continuidadApertura, 'abrió sin medida: aún no hay evidencia en contra').toBe(true)
    expect(obs.continuidadRevision, 'la medida tardía manda sobre la continuidad').toBe(false)
    expect(obs.fila.etiqueta).not.toBe('Luis')
    expect(obs.fila.evidencia).toBe('semilla')
  })

  it('sin etiqueta anterior ni medida → semilla, nunca "?"', async () => {
    const probe = crearProbe()
    const obs = await correrLocucion(probe, {}, {}, UUIDS[5]!)
    expect(obs.fila.etiqueta).toBe(SEMILLA)
    expect(obs.fila.evidencia).toBe('semilla')
    expect(obs.fila.etiqueta).not.toBe('?')
  })

  it('la evidencia entrante NO puede afirmar continuidad de otra voz (resolverVoz)', () => {
    const conOtraVoz = resolverVoz({ vozId: 'voz-b', continuidad: true }, false, new Map())
    expect(conOtraVoz.continuidad, 'la continuidad la decide el módulo').toBe(false)
    const sinMedida = resolverVoz({}, true, new Map())
    expect(sinMedida.continuidad).toBe(true)
  })
})
