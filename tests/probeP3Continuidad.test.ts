// @vitest-environment node
/**
 * PROBE CRUDO de continuidad de voz (mandato del dueño 2026-10-25).
 *
 * No usa log, ni E2E, ni `SpeechRecognition` falso: inyecta evidencia en
 * `crearReglasCierre` y en `EstadoCierre`, y pega la salida de `resolverVoz`
 * y `resolverEtiqueta` para las cuatro situaciones pedidas:
 *   1. sin medida (vozId vacío);
 *   2. medida igual a la anterior (mismo vozId);
 *   3. medida distinta (otro vozId);
 *   3b. medida tardía distinta (abre sin medida, la revisión trae otra voz);
 *   4. sin etiqueta anterior.
 */
import { describe, it } from 'vitest'
import { crearReglasCierre, resolverVoz } from '../src/voice/conversation/cierre.ts'
import type { EstadoCierre } from '../src/voice/conversation/cierre.ts'
import { resolverEtiqueta } from '../src/voice/conversation/fila.ts'
import type { Fila, FilaNueva } from '../src/voice/conversation/ports.ts'
import type { EvidenciaVoz } from '../src/voice/conversation/tipos.ts'

const SEMILLA = 'Hablante 1'
const UUIDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
]

const filas: FilaNueva[] = []

/** Evidencia en una línea, con los campos que el mandato pide crudos. */
function evidencia(voz: EvidenciaVoz): string {
  return `vozId="${voz.vozId ?? ''}" | hablante="${voz.hablante ?? ''}" | nombre="${voz.nombre ?? ''}" | continuidad=${String(voz.continuidad)}`
}

/** Estado mínimo de la sesión: el dueño de la continuidad es `crearReglasCierre`. */
function estadoBase(ultimaVozId: string, ultimaEtiqueta: string): EstadoCierre {
  return {
    sessionId: 'sesion-probe',
    abierta: null,
    ultimaEtiqueta,
    ultimaVozId,
    filas: new Map(),
    nombresPorVoz: new Map(),
  }
}

/**
 * Ejecuta un caso completo: abre, revisa, cierra y devuelve las observaciones.
 * @param nombre Etiqueta del caso en la salida.
 * @param ultimaVozId Última voz medida antes de la locución.
 * @param ultimaEtiqueta Última etiqueta cerrada antes de la locución.
 * @param vozApertura Evidencia con la que se abre.
 * @param vozRevision Evidencia que trae la revisión.
 * @param uuid `locutionId` válido del caso.
 */
async function caso(
  nombre: string,
  ultimaVozId: string,
  ultimaEtiqueta: string,
  vozApertura: EvidenciaVoz,
  vozRevision: EvidenciaVoz,
  uuid: string,
): Promise<void> {
  const estado = estadoBase(ultimaVozId, ultimaEtiqueta)
  const reglas = crearReglasCierre({
    estado,
    emitir: () => {},
    emitirCaja: () => {},
    contarDescarte: () => {},
    registro: { registrar: () => {} },
    almacen: {
      guardar: async (fila: FilaNueva): Promise<Fila> => {
        filas.push(fila)
        return { ...fila, revision: 1, updated_at: 0, deleted: false }
      },
      actualizar: async () => null,
    },
    config: {
      wakeWords: () => ['ok flu'],
      semillaEtiqueta: () => SEMILLA,
      conversationEngine: () => 'new',
    },
  })

  console.log(`\n[CASO] ${nombre}`)
  console.log(`  antes: ultimaVozId="${estado.ultimaVozId}" | ultimaEtiqueta="${estado.ultimaEtiqueta}"`)
  console.log(`  apertura: ${evidencia(vozApertura)}`)

  reglas.abrirLocucion({
    tramoId: uuid,
    texto: 'hola',
    tramo: { inicio: 0, fin: 16000, sampleRate: 16000 },
    turnId: 'turno-probe',
    idioma: 'es',
    voz: vozApertura,
  })
  const abierta = estado.abierta
  if (!abierta) throw new Error('no abrió la locución')
  console.log(`  abrir: continuidadVoz=${String(abierta.continuidadVoz)} | ${evidencia(abierta.voz)}`)

  console.log(`  revisión: ${evidencia(vozRevision)}`)
  reglas.aplicarRevision(abierta, 'hola mundo', false, vozRevision)
  const revisada = estado.abierta
  if (!revisada) throw new Error('la revisión cerró la locución')
  console.log(
    `  aplicarRevision: continuidadVoz=${String(revisada.continuidadVoz)} | ${evidencia(revisada.voz)}`,
  )

  const resuelta = resolverVoz(revisada.voz, revisada.continuidadVoz, estado.nombresPorVoz)
  console.log(`  resolverVoz: ${JSON.stringify(resuelta)}`)
  console.log(
    `  resolverEtiqueta: ${JSON.stringify(
      resolverEtiqueta({
        voz: resuelta,
        anterior: estado.ultimaEtiqueta || null,
        semilla: SEMILLA,
      }),
    )}`,
  )

  await reglas.cerrarLocucion(revisada, 'system', 'final', true)
  const fila = estado.filas.get(uuid)
  if (!fila) throw new Error('no se escribió la fila')
  console.log(`  fila: etiqueta="${fila.etiqueta}" | evidencia="${fila.evidencia}"`)
  console.log(`  después: ultimaVozId="${estado.ultimaVozId}" | ultimaEtiqueta="${estado.ultimaEtiqueta}"`)
}

describe('probe de continuidad de voz', () => {
  it('pega los cuatro casos crudos', async () => {
    await caso(
      '1. sin medida (vozId vacío)',
      'voz-a',
      'Luis',
      {},
      {},
      UUIDS[0]!,
    )
    await caso(
      '2. medida igual a la anterior (mismo vozId)',
      'voz-a',
      'Luis',
      { vozId: 'voz-a' },
      { vozId: 'voz-a' },
      UUIDS[1]!,
    )
    await caso(
      '3. medida distinta (otro vozId)',
      'voz-a',
      'Luis',
      { vozId: 'voz-b' },
      { vozId: 'voz-b' },
      UUIDS[2]!,
    )
    await caso(
      '3b. medida tardía distinta (abre sin medida, revisión con otra voz)',
      'voz-a',
      'Luis',
      {},
      { vozId: 'voz-b' },
      UUIDS[3]!,
    )
    await caso(
      '4. sin etiqueta anterior',
      '',
      '',
      {},
      {},
      UUIDS[4]!,
    )
    console.log(`\n[FILAS] ${filas.length}`)
  })
})
