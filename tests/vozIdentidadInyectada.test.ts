// ============================================================
// vozIdentidadInyectada - VALIDACION POR DATOS del escenario completo del dueno,
// sin microfono y sin worker: se inyectan los embeddings sinteticos y se ejecuta
// el DUENO UNICO de la decision (`resolveConversationSpeaker`) mas el escritor REAL
// de filas (`commitUserTurnRow`).
//
// Escenario: Luis y una mujer. Luis se identifica por voz ("soy luis"). Requisitos
// reportados: (1) la MISMA voz no cambia de etiqueta entre turnos; (2) el nombre
// identificado pega en TODA su participacion; (3) la mujer NUNCA se rotula con el
// nombre de Luis; (4) el indice de clusters no se infla.
//
// P9.57: antes llamaba a `speakerCore.assignSpeaker` (la segunda implementacion de la
// misma decision, la del worker). El worker ya solo embebe.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest'
import { resolveConversationSpeaker } from '../src/voice/lib/speakerDiarization.js'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow, renameSpeakerRows, resetSpeakerAliases } from '../src/voice/lib/conversationTurnRow'

type Vec = number[]
interface Cluster { label: string; signature: Vec }

// Anclas: dos voces DISTINTAS y ortogonales (coseno 0).
const LUIS: Vec = [1, 0, 0, 0]
const MUJER: Vec = [0, 1, 0, 0]
// Variacion natural de la MISMA voz (banda real medida: 0.70-0.79).
const luisVar = (cos: number): Vec => [cos, Math.sqrt(1 - cos * cos), 0, 0]
const mujerVar = (cos: number): Vec => [0, cos, Math.sqrt(1 - cos * cos), 0]

interface Turn { v: Vec; clusters: Cluster[]; prefer: string; lastSpeaker: string; lastSignature: Vec | null }
/** Decision por el DUENO UNICO (embeddings inyectados; sin microfono ni worker). */
const resolveTurn = (t: Turn): string =>
  resolveConversationSpeaker({
    signatureVector: t.v,
    speakerClusters: t.clusters,
    preferSpeaker: t.prefer,
    lastSpeaker: t.lastSpeaker,
    lastSignature: t.lastSignature,
    voicedSampleCount: 86400,
    sampleRate: 48000,
    atTurnBoundary: true,
    allowNewCluster: true,
  } as any)

describe('identidad inyectada: la MISMA voz no cambia de etiqueta entre turnos', () => {
  beforeEach(() => resetSpeakerAliases())

  it('con el primario "luis" tras identificarse, TODOS sus turnos son "luis"', () => {
    const clusters: Cluster[] = [{ label: 'luis', signature: LUIS }]
    const nombres = [0.74, 0.71, 0.78, 0.73].map((c) => resolveTurn({
      v: luisVar(c), clusters, prefer: 'luis', lastSpeaker: 'Hablante 2', lastSignature: MUJER,
    }))
    expect(new Set(nombres)).toEqual(new Set(['luis']))
  })

  it('la mujer NUNCA se rotula "luis" (su voz no llega a la ancla del nombre)', () => {
    const clusters: Cluster[] = [{ label: 'luis', signature: LUIS }, { label: 'Hablante 2', signature: MUJER }]
    const nombres = [0.76, 0.72, 0.79].map((c) => resolveTurn({
      v: mujerVar(c), clusters, prefer: 'luis', lastSpeaker: 'luis', lastSignature: LUIS,
    }))
    expect(nombres).not.toContain('luis')
    expect(new Set(nombres)).toEqual(new Set(['Hablante 2']))
  })

  it('sesion completa: 2 voces -> como mucho 2 etiquetas, sin inflar el indice', () => {
    const clusters: Cluster[] = [{ label: 'luis', signature: LUIS }]
    let last = ''
    const run = (voice: Vec): string => {
      const nombre = resolveTurn({ v: voice, clusters: [...clusters], prefer: 'luis', lastSpeaker: last, lastSignature: null })
      last = nombre
      if (!clusters.some((c) => c.label === nombre)) clusters.push({ label: nombre, signature: voice })
      return nombre
    }
    const nombres = [run(luisVar(0.75)), run(mujerVar(0.76)), run(luisVar(0.72)), run(mujerVar(0.74)), run(luisVar(0.78))]
    expect(clusters.length).toBeLessThanOrEqual(2)
    expect(nombres.filter((n) => n === 'luis')).toHaveLength(3)
    expect(nombres.filter((n) => n !== 'luis')).toHaveLength(2)
  })
})

describe('identidad inyectada: el nombre pega en las FILAS escritas (ruta real)', () => {
  beforeEach(() => {
    useIntegrationStore.getState().resetConversationHistory()
    resetSpeakerAliases()
  })

  it('tras identificar "luis", las filas del MISMO hablante salen "luis" y la mujer intacta', () => {
    commitUserTurnRow({ text: 'hola a todos como estan', speakerName: 'Hablante 1', turnId: 1 })
    commitUserTurnRow({ text: 'soy luis y estoy probando', speakerName: 'Hablante 1', turnId: 2 })
    renameSpeakerRows(['Hablante 1'], 'luis')
    commitUserTurnRow({ text: 'sigo hablando yo', speakerName: 'Hablante 1', turnId: 3 })
    commitUserTurnRow({ text: 'esta es de sabor de platano', speakerName: 'Hablante 2', turnId: 4 })
    const rows = useIntegrationStore.getState().conversationHistory.filter((r) => r.role === 'user')
    expect(rows.map((r) => r.speakerName)).toEqual(['luis', 'luis', 'luis', 'Hablante 2'])
  })
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('si el prefer es la etiqueta pegajosa generica (cliente viejo), la MISMA voz se pierde', () => {
    const clusters: Cluster[] = [{ label: 'luis', signature: LUIS }, { label: 'Hablante 2', signature: luisVar(0.98) }]
    const out = resolveTurn({
      v: luisVar(0.75), clusters, prefer: 'Hablante 2', lastSpeaker: 'Hablante 2', lastSignature: luisVar(0.98),
    })
    expect(out, `resolvio "${out}"`).not.toBe('luis')
  })
})
