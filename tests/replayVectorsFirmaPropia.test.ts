// @vitest-environment node
/**
 * GUARD del modo `vectors`: una firma compartida por LOCUCIONES distintas NO es la medida
 * del turno.
 *
 * Defecto que cierra: el runner trataba `commit.signature` como la medida del audio del turno.
 * La grabacion guarda ahi una REFERENCIA cuando el commit no tuvo medida propia
 * (`resolveCommitRowSignature` cae a la firma del cluster y despues a la del commit anterior),
 * asi que el resolutor comparaba el cluster consigo mismo. Con esa evidencia circular todo
 * resultado es un artefacto: en las dos grabaciones del dueno la misma firma aparece bajo
 * decenas de locuciones distintas (7fce0045: 149 commits / 17 firmas; d4c1c8f3: 29 / 2).
 *
 * El guard tiene FALSIFICACION en los dos sentidos: firmas distintas -> se evalua; firma
 * repetida bajo el MISMO texto (fila duplicada de la misma locucion) -> tambien se evalua.
 */
import { describe, expect, it } from 'vitest'
import { runVectorsSession } from '../scripts/replay/vectorsRunner.mjs'

/** Vector unitario de 4 dimensiones (la medida no depende de la dimension). */
function unit(pairs: Array<[number, number]>): number[] {
  const v = new Array(4).fill(0)
  for (const [i, x] of pairs) v[i] = x
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1
  return v.map((x) => x / n)
}

const VOZ_A = unit([[0, 1]])
const VOZ_B = unit([[1, 1]])
const VOZ_C = unit([[0.2, 1]])

const BASE = {
  kind: 'base',
  t: 0,
  participants: [{ name: 'luis', voiceAnchorVerified: true, voiceVector: [...VOZ_A] }],
}

/** Commit minimo con lo que el runner lee: firma, duracion, texto, clusters y hablante. */
function commit(firma: number[], clusters: Array<Record<string, unknown>>, text: string) {
  return {
    kind: 'commit',
    t: 1000,
    text,
    speaker: 'Hablante 1',
    signature: [...firma],
    clusters,
    lastSpeaker: 'Hablante 1',
    primary: 'luis',
    audioStartSample: 0,
    audioEndSample: 96000,
  }
}

function sesion(commits: Array<Record<string, unknown>>) {
  return { turns: [BASE, ...commits], meta: { sampleRate: 48000 } }
}

/** Forma del resultado que este guard consume (el runner es JS sin tipos). */
type VectorsResult = {
  evaluated: number
  conclusive: boolean
  skipped: Array<{ index: number; motivo: string }>
  notConclusive: string[]
  avisos: string[]
}

/** Ejecuta el runner REAL sobre la sesion construida. */
function correr(session: unknown): Promise<VectorsResult> {
  return runVectorsSession({ session } as never) as Promise<VectorsResult>
}

const CLUSTERS = [{ label: 'Hablante 1', signature: [...VOZ_A] }]
const motivos = (r: VectorsResult) => r.skipped.map((turno) => turno.motivo)

describe('vectors: firma compartida entre locuciones = referencia, no medida del turno', () => {
  it('la MISMA firma en dos LOCUCIONES distintas -> no se evalua (firma-repetida)', async () => {
    const observado = await correr(
      sesion([commit(VOZ_A, CLUSTERS, 'primera locucion'), commit(VOZ_A, CLUSTERS, 'segunda locucion')]),
    )

    expect(observado.evaluated).toBe(0)
    expect(observado.conclusive).toBe(false)
    expect(motivos(observado)).toEqual(['firma-repetida', 'firma-repetida'])
    expect(observado.notConclusive).toContain('firma-repetida')
    expect(observado.avisos).toContain('firma-no-propia-del-turno')
  })

  it('FALSIFICACION: firmas DISTINTAS -> se evaluan todas y el detector no marca nada', async () => {
    const observado = await correr(
      sesion([
        commit(VOZ_A, CLUSTERS, 'primera locucion'),
        commit(VOZ_B, CLUSTERS, 'segunda locucion'),
        commit(VOZ_C, CLUSTERS, 'tercera locucion'),
      ]),
    )

    expect(observado.evaluated).toBe(3)
    expect(observado.conclusive).toBe(true)
    expect(observado.notConclusive).toEqual([])
    expect(observado.skipped).toEqual([])
    expect(observado.avisos).not.toContain('firma-no-propia-del-turno')
  })

  it('FALSIFICACION: la MISMA firma bajo el MISMO texto es una FILA DUPLICADA y si se evalua', async () => {
    const observado = await correr(
      sesion([commit(VOZ_A, CLUSTERS, 'la misma locucion'), commit(VOZ_A, CLUSTERS, 'la misma locucion')]),
    )

    expect(observado.evaluated).toBe(2)
    expect(observado.conclusive).toBe(true)
    expect(observado.skipped).toEqual([])
  })

  it('mezcla: solo la firma unica se evalua; la compartida entre locuciones se declara', async () => {
    const observado = await correr(
      sesion([
        commit(VOZ_A, CLUSTERS, 'primera locucion'),
        commit(VOZ_A, CLUSTERS, 'segunda locucion'),
        commit(VOZ_C, CLUSTERS, 'tercera locucion'),
      ]),
    )

    expect(observado.evaluated).toBe(1)
    expect(motivos(observado)).toEqual(['firma-repetida', 'firma-repetida'])
  })
})
