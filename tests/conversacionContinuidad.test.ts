// @vitest-environment node
/**
 * CONTINUIDAD DE VOZ — guard de la SESIÓN (dueño: `crearReglasCierre`).
 *
 * `conversacionFila.test.ts` ya cubre la tabla de prioridad pura de
 * `resolverEtiqueta`; aquí se mide la decisión que NO es pura: quién decide si
 * una locución continúa una voz de la sesión. Reglas del mandato (2026-10-30,
 * problema 4):
 *   SIN medida positiva NO hay continuidad: una locución sin vozId NO hereda la
 *     etiqueta anterior (el decreto viejo mezclaba hablantes);
 *   una medida que casa con una PLANTILLA de la sesión continúa ESA voz y
 *     recupera SU etiqueta (A→B→A devuelve la etiqueta de A, no la de B);
 *   una medida que NO casa es OTRA voz: no hereda;
 *   sin etiqueta anterior ni medida → semilla, nunca `?`.
 *
 * FALSIFICACIÓN (par de mutaciones): si el módulo heredara a ciegas, el caso de
 * otra voz es ROJO; si nunca continuara, el caso de la plantilla casada es ROJO.
 */
import { describe, expect, it } from 'vitest'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'
import { crearReglasCierre, resolverVoz } from '../src/voice/conversation/cierre.ts'
import type { EstadoCierre, ReglasCierre } from '../src/voice/conversation/cierre.ts'
import type { CambiosFila, Fila, FilaNueva } from '../src/voice/conversation/ports.ts'
import type { EvidenciaVoz, EventoConversacion } from '../src/voice/conversation/tipos.ts'

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

/** Crea el estado mínimo de la sesión con una etiqueta y plantillas previas. */
function crearProbe(
  ultimaEtiqueta = '',
  plantillas?: Readonly<Record<string, { vector: readonly number[]; etiqueta: string }>>,
): Probe {
  const estado: EstadoCierre = {
    sessionId: 'sesion-guard',
    abierta: null,
    ultimaEtiqueta,
    filas: new Map(),
    nombresPorVoz: new Map(),
    plantillasVoz: new Map(Object.entries(plantillas ?? {}).map(([vozId, p]) => [vozId, { ...p }])),
    muestrasAbierta: [],
    tramosDeLaAbierta: new Set(),
    muestrasEnUltimoIntento: 0,
    contadorVoces: 0,
    nombrePendiente: '',
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
    // Caso 7+6: la continuidad no mide el tramo; el medidor es un stub honesto.
    medidor: { medir: () => ({ speechLikeMs: 0, rms: 0 }) },
  })
  return { estado, reglas }
}

/**
 * Corre una locución completa (abrir → revisar → cerrar) sobre la MISMA sesión.
 * @param probe Sesión de prueba que conserva `ultimaEtiqueta` y plantillas.
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
    // Caso 8: un turnId => una fila. Cada locución es SU turno; compartir
    // 'turno-guard' haría que el gate ignore la segunda como reentrega.
    turnId: uuid,
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
  await reglas.cerrarLocucion(revisada, 'system', 'silencio', true)
  const fila = estado.filas.get(uuid)
  if (!fila) throw new Error('no se escribió la fila')
  return { continuidadApertura, continuidadRevision, fila }
}

/**
 * Sesión con etiqueta TEMPORAL y almacén que REGISTRA la única actualización
 * permitida (mandato del dueño 2026-10-30): la fila nace `pendiente` y su
 * medida tardía reemplaza el hablante SIN tocar texto, tramo ni estado.
 * @returns Estado, reglas y el registro de lo que el almacén recibió.
 */
function crearProbePendiente() {
  const estado: EstadoCierre = {
    sessionId: 'sesion-pendiente',
    abierta: null,
    ultimaEtiqueta: '',
    filas: new Map(),
    nombresPorVoz: new Map(),
    plantillasVoz: new Map(),
    muestrasAbierta: [],
    tramosDeLaAbierta: new Set(),
    muestrasEnUltimoIntento: 0,
    contadorVoces: 0,
    nombrePendiente: '',
  }
  const guardadas = new Map<string, Fila>()
  const actualizaciones: Array<{ locutionId: string; cambios: CambiosFila }> = []
  const eventos: EventoConversacion[] = []
  const reglas = crearReglasCierre({
    estado,
    emitir: (evento) => eventos.push(evento),
    emitirCaja: () => {},
    contarDescarte: () => {},
    registro: { registrar: () => {} },
    almacen: {
      guardar: async (fila: FilaNueva): Promise<Fila> => {
        const guardada = { ...fila, revision: 1, updated_at: 0, deleted: false }
        guardadas.set(fila.locutionId, guardada)
        return guardada
      },
      actualizar: async (locutionId, cambios) => {
        const previa = guardadas.get(locutionId)
        if (!previa) return null
        actualizaciones.push({ locutionId, cambios })
        const siguiente: Fila = {
          ...previa,
          etiqueta: cambios.etiqueta ?? previa.etiqueta,
          evidencia: cambios.evidencia ?? previa.evidencia,
          firma: cambios.firma ?? previa.firma,
          revision: previa.revision + 1,
          updated_at: 1,
        }
        guardadas.set(locutionId, siguiente)
        return siguiente
      },
    },
    config: {
      wakeWords: () => ['ok flu'],
      semillaEtiqueta: () => SEMILLA,
      // Etiqueta TEMPORAL: el dueño la autorizó mientras no haya medida.
      etiquetaPendiente: () => 'Hablante ?',
      esEtiquetaAnonima: isAutoSpeakerLabel,
      umbralContinuidadVoz: () => 0.8,
      etiquetaAnonima: (indice) => `Hablante ${indice}`,
      echoMinPalabrasCola: () => 4,
    },
    id: { uuid: () => UUIDS[0]! },
    medidor: { medir: () => ({ speechLikeMs: 0, rms: 0 }) },
    // Medida ausente (sin audio retenido y null al cerrar): fila TEMPORAL.
    embebedor: { medir: async () => null, comparar: () => 0 },
  })
  return { estado, reglas, guardadas, actualizaciones, eventos }
}

describe('continuidad de voz — decisión de la sesión', () => {
  it('P3 INVERTIDO (mandato 2026-10-30): tras "soy Luis", la siguiente locución SIN medida NO hereda', async () => {
    // El decreto viejo (sin medida → hereda la etiqueta anterior) mezclaba
    // hablantes: la mujer quedaba bajo la etiqueta del dueño. Sin medida
    // positiva no hay continuidad: cae a la semilla.
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
    expect(siguiente.continuidadApertura, 'sin medida positiva NO hay continuidad').toBe(false)
    expect(siguiente.fila.etiqueta).toBe(SEMILLA)
    expect(siguiente.fila.evidencia).toBe('semilla')
  })

  it('misma voz medida (vozId con plantilla de la sesión) → continuidad con SU etiqueta', async () => {
    const probe = crearProbe('Luis', { 'voz-a': { vector: [1, 0], etiqueta: 'Luis' } })
    const obs = await correrLocucion(probe, { vozId: 'voz-a' }, { vozId: 'voz-a' }, UUIDS[2]!)
    expect(obs.continuidadApertura).toBe(true)
    expect(obs.fila.etiqueta).toBe('Luis')
    expect(obs.fila.evidencia).toBe('medida')
  })

  it('Hablante N sin plantilla no hereda la etiqueta anterior: se sostiene SOLO (bug 2026-10-26 invertido)', async () => {
    // Con el decreto viejo, una agrupación anónima heredaba la etiqueta 'Luis'.
    // Sin medida positiva no hay continuidad: la medida anónima se sostiene.
    const probe = crearProbe('Luis')
    const obs = await correrLocucion(probe, { hablante: 'Hablante 1' }, {}, UUIDS[6]!)
    expect(obs.continuidadApertura).toBe(false)
    expect(obs.fila.etiqueta).toBe('Hablante 1')
    expect(obs.fila.evidencia).toBe('medida')
  })

  it('P3b: otra voz (vozId sin plantilla) NO hereda el nombre de la voz anterior', async () => {
    const probe = crearProbe('Luis', { 'voz-a': { vector: [1, 0], etiqueta: 'Luis' } })
    const obs = await correrLocucion(probe, { vozId: 'voz-b' }, { vozId: 'voz-b' }, UUIDS[3]!)
    expect(obs.continuidadApertura, 'otra voz no continúa la anterior').toBe(false)
    expect(obs.fila.etiqueta).not.toBe('Luis')
    expect(obs.fila.evidencia).toBe('semilla')
  })

  it('medida tardía de otra voz: la continuidad NO se afirma y no hereda', async () => {
    const probe = crearProbe('Luis', { 'voz-a': { vector: [1, 0], etiqueta: 'Luis' } })
    const obs = await correrLocucion(probe, {}, { vozId: 'voz-b' }, UUIDS[4]!)
    expect(obs.continuidadApertura, 'abrió sin medida: sin evidencia positiva').toBe(false)
    expect(obs.continuidadRevision, 'la medida tardía no casó plantilla').toBe(false)
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
    const plantillas = new Map([['voz-a', { vector: [1, 0], etiqueta: 'Luis' }]])
    const conOtraVoz = resolverVoz({ vozId: 'voz-b', continuidad: true }, false, new Map(), plantillas)
    expect(conOtraVoz.continuidad, 'la continuidad la decide el módulo').toBe(false)
    expect(conOtraVoz.etiquetaVoz).toBeUndefined()
    const sinMedida = resolverVoz({}, true, new Map(), plantillas)
    expect(sinMedida.continuidad).toBe(true)
    const casada = resolverVoz({ vozId: 'voz-a' }, true, new Map(), plantillas)
    expect(casada.etiquetaVoz, 'la plantilla casada aporta SU etiqueta').toBe('Luis')
  })
})

/**
 * MANDATO DEL DUEÑO (2026-10-30) — «puedes poner un hablante temporal si aún no
 * llega, y cuando lo tengas reemplazar; ese es el único campo de la conversación
 * que se puede actualizar».
 *
 * FALSIFICACIÓN: si `reetiquetarFila` escribiera otro campo, `cambios` traería
 * más claves; si reetiquetara una fila con hablante YA afirmado, el segundo caso
 * sería ROJO; si no emitiera `speaker.labeled`, la vista no podría reemplazar la
 * etiqueta temporal.
 */
describe('el hablante es el ÚNICO campo actualizable de una fila commiteada', () => {
  it('la fila nace TEMPORAL y la medida tardía reemplaza hablante y firma', async () => {
    const { estado, reglas, guardadas, actualizaciones, eventos } = crearProbePendiente()
    // La medida tardía ya registró su plantilla (vector) antes de reetiquetar.
    estado.plantillasVoz.set('voz-1', { vector: [1, 0], etiqueta: 'Hablante 2' })
    const locutionId = UUIDS[0]!
    reglas.abrirLocucion({
      tramoId: locutionId,
      texto: 'hola',
      tramo: { inicio: 0, fin: 16000, sampleRate: 16000 },
      turnId: locutionId,
      idioma: 'es',
      voz: {},
    })
    const abierta = estado.abierta
    if (!abierta) throw new Error('no abrió la locución')
    await reglas.cerrarLocucion(abierta, 'system', 'silencio', true)

    const pendiente = guardadas.get(locutionId)
    if (!pendiente) throw new Error('no se guardó la fila')
    expect(pendiente.etiqueta, 'sin medida: etiqueta TEMPORAL').toBe('Hablante ?')
    expect(pendiente.evidencia).toBe('pendiente')

    expect(await reglas.reetiquetarFila(locutionId, 'voz-1', 'Hablante 2')).toBe(true)
    const actualizada = guardadas.get(locutionId)
    expect(actualizada).toMatchObject({
      etiqueta: 'Hablante 2',
      evidencia: 'medida',
      firma: [1, 0],
      texto: pendiente.texto,
      tramo: pendiente.tramo,
      revision: 2,
    })
    // El almacén recibió hablante y su TIMBRE; ni texto ni tramo.
    expect(actualizaciones).toHaveLength(1)
    expect(Object.keys(actualizaciones[0]!.cambios).sort()).toEqual(['etiqueta', 'evidencia', 'firma'])
    expect(eventos.at(-1)).toMatchObject({
      tipo: 'speaker.labeled',
      locutionId,
      etiqueta: 'Hablante 2',
      evidencia: 'medida',
    })
    // Segunda medida sobre la fila ya afirmada: no hay nada que reemplazar.
    expect(await reglas.reetiquetarFila(locutionId, 'voz-9', 'Hablante 9')).toBe(false)
    expect(actualizaciones).toHaveLength(1)
  })

  it('una fila con hablante ya afirmado NO se reetiqueta', async () => {
    const { estado, reglas, guardadas } = crearProbePendiente()
    const locutionId = UUIDS[1]!
    reglas.abrirLocucion({
      tramoId: locutionId,
      texto: 'hola',
      tramo: { inicio: 0, fin: 16000, sampleRate: 16000 },
      turnId: locutionId,
      idioma: 'es',
      voz: { hablante: 'Hablante 1' },
    })
    const abierta = estado.abierta
    if (!abierta) throw new Error('no abrió la locución')
    await reglas.cerrarLocucion(abierta, 'system', 'silencio', true)
    const fila = guardadas.get(locutionId)
    if (!fila) throw new Error('no se guardó la fila')
    expect(fila.evidencia).toBe('medida')
    expect(await reglas.reetiquetarFila(locutionId, 'voz-1', 'Luis')).toBe(false)
    expect(guardadas.get(locutionId)?.etiqueta).toBe(fila.etiqueta)
  })
})
