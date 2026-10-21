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
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow, renameSpeakerRows } from '../src/voice/lib/conversationTurnRow'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { resetVoiceDirectory } from '../src/voice/lib/speakerDirectory.js'
import { consolidateSpeakerClusters } from '../src/voice/lib/speakerClusters.js'
import { foldSpeakerKey } from '../src/voice/lib/speakerLabels.js'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'

type Vec = number[]
interface Cluster { label: string; signature: Vec }

// Anclas: dos voces DISTINTAS y ortogonales (coseno 0).
const LUIS: Vec = [1, 0, 0, 0]
const MUJER: Vec = [0, 1, 0, 0]
// Variacion natural de la MISMA voz. La banda medida de "misma voz" llega hasta ~0.74,
// pero MANDATO 2026-10-18: un NOMBRE PROPIO solo se afirma desde `registeredVoiceFloor`
// (identidad registrada), porque en esa banda la voz de la hija se llevaba "Luis".
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
    thresholds: FLU_CONFIG.voiceIdentity.capture.conversationSpeakerThresholds,
    atTurnBoundary: true,
    allowNewCluster: true,
  } as any)

// Aislamiento: el DIRECTORIO de nombres por VOZ (estado de sesion) se vacia entre casos.
beforeEach(() => {
  resetVoiceDirectory()
})

describe('identidad inyectada: la MISMA voz no cambia de etiqueta entre turnos', () => {

  it('con el primario "luis" y medida de identidad, TODOS sus turnos son "luis"', () => {
    const clusters: Cluster[] = [{ label: 'luis', signature: LUIS }]
    const nombres = [0.80, 0.77, 0.78, 0.76].map((c) => resolveTurn({
      v: luisVar(c), clusters, prefer: 'luis', lastSpeaker: 'Hablante 2', lastSignature: MUJER,
    }))
    expect(new Set(nombres)).toEqual(new Set(['luis']))
  })

  it('POR DEBAJO del piso de identidad la voz NO se nombra (banda de "misma voz")', () => {
    // 0.74 es timbre parecido, no identidad: antes se estampaba "luis" y la mujer
    // medida ahi quedaba rotulada con el nombre ajeno (defecto del log del dueno).
    const clusters: Cluster[] = [{ label: 'luis', signature: LUIS }]
    const out = resolveTurn({
      v: luisVar(0.74), clusters, prefer: 'luis', lastSpeaker: 'Hablante 2', lastSignature: MUJER,
    })
    expect(out).not.toBe('luis')
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
    const nombres = [run(luisVar(0.80)), run(mujerVar(0.76)), run(luisVar(0.78)), run(mujerVar(0.74)), run(luisVar(0.79))]
    expect(clusters.length).toBeLessThanOrEqual(2)
    expect(nombres.filter((n) => n === 'luis')).toHaveLength(3)
    expect(nombres.filter((n) => n !== 'luis')).toHaveLength(2)
  })
})

describe('identidad inyectada: el nombre pega en las FILAS escritas (ruta real)', () => {
  beforeEach(() => {
    useIntegrationStore.getState().resetConversationHistory()
  })

  it('tras identificar "luis", la VOZ lleva el nombre: las filas del MISMO hablante salen "Luis" y la mujer intacta', () => {
    commitUserTurnRow({ text: 'hola a todos como estan', speakerName: 'Hablante 1', evidenciaAcustica: true, turnId: 1 })
    commitUserTurnRow({ text: 'soy luis y estoy probando', speakerName: 'Hablante 1', evidenciaAcustica: true, turnId: 2 })
    // Mandato del dueno 2026-10-13: el NOMBRE vive en el DIRECTORIO por VOZ; el registro
    // (`renameSpeakerRows`) NO reescribe ninguna fila (la conversacion es texto insertado).
    // La fila guarda su VOZ (`speakerId`) y la etiqueta se resuelve AL MOSTRAR.
    renameSpeakerRows(['Hablante 1'], 'luis')
    commitUserTurnRow({ text: 'sigo hablando yo', speakerName: 'luis', evidenciaAcustica: true, turnId: 3 })
    commitUserTurnRow({ text: 'esta es de sabor de platano', speakerName: 'Hablante 2', evidenciaAcustica: true, turnId: 4 })
    const rows = useIntegrationStore.getState().conversationHistory.filter((r) => r.role === 'user')
    // El nombre entra CANONICO ('luis' -> 'Luis'); la mujer (otra VOZ) queda intacta.
    expect(rows.map((r) => resolveRowSpeakerLabel(r))).toEqual(['Luis', 'Luis', 'Luis', 'Hablante 2'])
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

// P9.64 + H8 (MEDIDO 2026-10-12): la MISMA persona con el cluster en otra caja ("luis" del
// historico) y el primario "Luis" producia DOS etiquetas Y DOS clusters (ruta doble de DATOS).
//
// DUEÑO DEL DUPLICADO (mandato 2026-10-18): la fusion de las dos grafias vive en
// `consolidateSpeakerClusters` (la consume `capAndFuseSpeakerClusters` en el preflight), que
// pliega por identidad ('luis' == 'Luis') y deja UN cluster. El resolver ya no fusiona
// nombres: el mandato retira los nombres de la ventana corta, y `utteranceText: 'si'` es
// ventana corta -> el turno conserva una etiqueta ANONIMA (nunca un nombre por cercania).
describe('P9.64 + H8: la MISMA persona no lleva DOS etiquetas NI DOS clusters', () => {
  it('los DOS ordenes: la consolidacion deja UN cluster con una sola identidad', () => {
    const ordenes: Array<Array<'luis' | 'Luis'>> = [['luis', 'Luis'], ['Luis', 'luis']]
    for (const orden of ordenes) {
      const clusters: Cluster[] = orden.map((label) => ({ label, signature: LUIS }))
      const fusionados = consolidateSpeakerClusters(clusters)
      const etiqueta = `orden=[${orden.join(', ')}]`
      expect(fusionados.length, `${etiqueta}: un cluster por persona, quedo ${JSON.stringify(fusionados.map((c) => c.label))}`).toBe(1)
      expect(foldSpeakerKey(fusionados[0].label), `${etiqueta}: la identidad plegada es la misma`).toBe(foldSpeakerKey('Luis'))
    }
  })

  it('ventana CORTA: el resolver no afirma ningun nombre propio (la etiqueta es anonima)', () => {
    const ordenes: Array<Array<'luis' | 'Luis'>> = [['luis', 'Luis'], ['Luis', 'luis']]
    for (const orden of ordenes) {
      const clusters: Cluster[] = orden.map((label) => ({ label, signature: LUIS }))
      const out = resolveConversationSpeaker({
        signatureVector: luisVar(0.80), speakerClusters: clusters,
        thresholds: FLU_CONFIG.voiceIdentity.capture.conversationSpeakerThresholds,
        sessionPrimary: 'Luis', lastSpeaker: 'luis',
        // VENTANA CORTA = AUDIO corto (mandato 2026-10-19: la duracion manda cuando hay
        // medida). Antes este caso usaba 1.8 s de voz y solo el conteo de palabras lo daba
        // por corto: esa regla es la que dejaba al dueno en "Hablante 1" (log 2026-10-19).
        voicedSampleCount: 48000, sampleRate: 48000,
        atTurnBoundary: true, allowNewCluster: true, utteranceText: 'si',
      } as never)
      expect(isAutoSpeakerLabel(out), `orden=[${orden.join(', ')}]: "${out}" no es una identidad medida`).toBe(true)
    }
  })

  it('DETECTOR positivo: con ancla unica y ventana SOSTENIDA el nombre SI se afirma', () => {
    const clusters: Cluster[] = [{ label: 'Luis', signature: LUIS }]
    const out = resolveConversationSpeaker({
      signatureVector: luisVar(0.80), speakerClusters: clusters,
      thresholds: FLU_CONFIG.voiceIdentity.capture.conversationSpeakerThresholds,
      sessionPrimary: 'Luis', lastSpeaker: '', voicedSampleCount: 96000, sampleRate: 48000,
      atTurnBoundary: true, allowNewCluster: true,
      utteranceText: 'esta es una frase sostenida para medir la voz',
    } as never)
    expect(out).toBe('Luis')
  })
})
