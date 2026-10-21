// ============================================================
// vozAnclaVerificadaBandaMedida - criterio A del dueno (2026-10-19)
// ------------------------------------------------------------
// DEFECTO MEDIDO (sesion 18f3888c): la base de participantes TENIA el ancla
// verificada de "Luis", pero su voz quedo «Hablante 2» toda la sesion. La banda
// medida de la MISMA voz contra su ancla es 0.629–0.714 (otra ventana y otro dia);
// el piso registrado general (0.76) exige mas de lo que la misma persona alcanza,
// asi que la identidad verificada no confirmaba. La voz DISTINTA (la mujer) mide
// 0.29–0.58 contra esa ancla: por debajo del piso propio (0.62), nunca puede
// llevarse el nombre.
//
// ESTE GUARD recorre la CADENA REAL, sin mocks:
//   participante (voiceAnchorVerified) -> participantVoiceAnchorsForDiarization
//   -> seedRegisteredAnchors (anchorVerified en el cluster)
//   -> resolveConversationSpeaker (dueno unico de la decision de hablante).
//
// Los vectores tienen cosenos EXACTOS contra el ancla (base y ejes ortogonales),
// asi la medida no depende de la maquina ni de un modelo de embeddings.
// ============================================================
import { describe, expect, it } from 'vitest'
import { participantVoiceAnchorsForDiarization } from '../src/voice/lib/participantVoiceAnchors'
import { seedRegisteredAnchors } from '../src/voice/lib/speakerClusters.js'
import { resolveConversationSpeaker } from '../src/voice/lib/voiceIdentity.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const DIM = 64
/** Modelo de embedding vigente: un vector de OTRO modelo no es comparable. */
const MODELO = 'wavlm-sv-base'

function eje(indice: number): number[] {
  const vector = new Array(DIM).fill(0)
  vector[indice] = 1
  return vector
}

/**
 * Vector UNITARIO con coseno EXACTO `coseno` contra `base`.
 * `base` y `ortogonal` son unitarios y ortogonales entre si, asi que el resultado
 * conserva la norma y el coseno pedido sin ruido ni dependencia del azar.
 */
function vozConCoseno(base: number[], ortogonal: number[], coseno: number): number[] {
  const seno = Math.sqrt(Math.max(0, 1 - coseno * coseno))
  return base.map((x, i) => x * coseno + ortogonal[i] * seno)
}

const ANCLA_LUIS = eje(0) // vector guardado y verificado en la base de participantes
const EJE_LUIS = eje(1) // variacion natural de la MISMA voz
const EJE_MUJER = eje(2) // variacion de una voz DISTINTA (la mujer)

// Banda MEDIDA de la misma voz contra su ancla: extremos 0.629 y 0.714.
const LUIS_068 = vozConCoseno(ANCLA_LUIS, EJE_LUIS, 0.68)
const LUIS_063 = vozConCoseno(ANCLA_LUIS, EJE_LUIS, 0.63)
const LUIS_071 = vozConCoseno(ANCLA_LUIS, EJE_LUIS, 0.71)
// Banda MEDIDA de la voz DISTINTA contra esa ancla: extremos 0.58 y 0.29.
const MUJER_058 = vozConCoseno(ANCLA_LUIS, EJE_MUJER, 0.58)
const MUJER_029 = vozConCoseno(ANCLA_LUIS, EJE_MUJER, 0.29)

/** Turno SOSTENIDO (2 s de voz, frase larga): la unica ventana que puede afirmar nombre. */
const TURNO_SOSTENIDO = {
  voicedSampleCount: 96000,
  minVoicedSamples: 12000,
  sampleRate: 48000,
  utteranceText: 'esta es una frase sostenida de prueba para medir la voz',
  atTurnBoundary: true,
  allowNewCluster: true,
}

/** Participante con su ancla MEDIDA y VERIFICADA, como la guarda la base. */
const PARTICIPANTE_LUIS = {
  name: 'Luis',
  voiceVector: ANCLA_LUIS,
  voiceVectorModel: MODELO,
  voiceAnchorVerified: true,
}

/** Sesion sembrada por la cadena REAL de produccion (participante -> cluster). */
function sembrarDesdeLaBase(participantes: any[] = [PARTICIPANTE_LUIS]): any[] {
  const anchors = participantVoiceAnchorsForDiarization(participantes)
  return seedRegisteredAnchors([], anchors, { model: MODELO }) || []
}

/** Decisor REAL de hablante sobre los clusters de la sesion. */
function resolver(
  vector: number[],
  {
    clusters,
    lastSpeaker = '',
    lastSignature = null,
    diagnosis = {},
  }: { clusters: any[]; lastSpeaker?: string; lastSignature?: number[] | null; diagnosis?: Record<string, unknown> },
): string {
  return resolveConversationSpeaker({
    ...TURNO_SOSTENIDO,
    signatureVector: vector,
    speakerClusters: clusters,
    lastSpeaker,
    lastSignature,
    thresholds: FLU_CONFIG.voiceIdentity.capture.conversationSpeakerThresholds,
    diagnosis,
  } as never)
}

describe('A · la base produce anclas verificadas y la sesion las siembra como tales', () => {
  it('un participante con voiceAnchorVerified llega al cluster con anchorVerified: true', () => {
    const clusters = sembrarDesdeLaBase()
    expect(clusters.map((cluster) => cluster.label)).toEqual(['Luis'])
    expect(clusters[0].anchorSource).toBe('participant-base')
    expect(clusters[0].anchorVerified, 'sin la marca se usaria el piso registrado general').toBe(true)
    expect(clusters[0].signature).toEqual(ANCLA_LUIS)
  })
})

describe('B · el dueno suena con su nombre y la mujer NO lo hereda (banda medida)', () => {
  it('Luis 0.68 / 0.63 / 0.71 contra SU ancla -> "Luis" por la rama del ancla verificada', () => {
    const clusters = sembrarDesdeLaBase()
    const diagnosis: Record<string, unknown> = {}
    expect(resolver(LUIS_068, { clusters, diagnosis })).toBe('Luis')
    expect(diagnosis.reason).toBe('production-verified-anchor')
    // Extremo BAJO de la banda medida (0.629): sigue confirmando.
    expect(resolver(LUIS_063, { clusters, lastSpeaker: 'Luis', lastSignature: LUIS_068 })).toBe('Luis')
    // Extremo ALTO de la banda medida (0.714).
    expect(resolver(LUIS_071, { clusters, lastSpeaker: 'Luis', lastSignature: LUIS_063 })).toBe('Luis')
  })

  it('la mujer (0.58 y 0.29 contra el ancla) abre UN «Hablante N» y jamas es "Luis"', () => {
    const clusters = sembrarDesdeLaBase()
    const etiquetas: string[] = []
    const primera = resolver(MUJER_058, { clusters })
    etiquetas.push(primera)
    expect(primera, 'una voz distinta no toma el nombre de la base').toBe('Hablante 1')
    // La MISMA mujer sigue hablando: conserva su etiqueta, no se renumera.
    const segunda = resolver(MUJER_029, { clusters, lastSpeaker: primera, lastSignature: MUJER_058 })
    etiquetas.push(segunda)
    expect(segunda).toBe('Hablante 1')
    expect(etiquetas.filter((label) => label === 'Luis'), 'ninguna intervencion de la mujer es "Luis"').toEqual([])
  })

  it('escena completa: Luis, mujer, mujer, Luis, Luis -> 2 voces, cero «Hablante 2»', () => {
    const clusters = sembrarDesdeLaBase()
    const luis1 = resolver(LUIS_068, { clusters })
    const mujer1 = resolver(MUJER_058, { clusters, lastSpeaker: luis1, lastSignature: LUIS_068 })
    const mujer2 = resolver(MUJER_029, { clusters, lastSpeaker: mujer1, lastSignature: MUJER_058 })
    const luis2 = resolver(LUIS_071, { clusters, lastSpeaker: mujer2, lastSignature: MUJER_029 })
    const luis3 = resolver(LUIS_063, { clusters, lastSpeaker: luis2, lastSignature: LUIS_071 })
    expect([luis1, luis2, luis3]).toEqual(['Luis', 'Luis', 'Luis'])
    expect([mujer1, mujer2]).toEqual(['Hablante 1', 'Hablante 1'])
    expect(clusters.map((cluster) => cluster.label).sort(), 'una etiqueta por voz real').toEqual([
      'Hablante 1',
      'Luis',
    ])
    expect(clusters.map((cluster) => cluster.label), 'no hay «Hablante 2» fantasma').not.toContain('Hablante 2')
  })
})

describe('C · FALSIFICADOR: sin la marca de verificada vuelve el defecto medido', () => {
  it('el MISMO 0.68 contra el MISMO ancla SIN verificar NO confirma (piso registrado 0.76)', () => {
    const clusters =
      seedRegisteredAnchors([], [{ name: 'Luis', vector: ANCLA_LUIS, model: MODELO }], { model: MODELO }) || []
    expect(clusters[0].anchorVerified, 'control: el ancla sin la marca usa el piso general').toBe(false)
    const diagnosis: Record<string, unknown> = {}
    const label = resolver(LUIS_068, { clusters, diagnosis })
    expect(label, 'con el piso 0.76 la misma voz no confirma y cae a Hablante (defecto A)').toBe('Hablante 1')
    expect(label).not.toBe('Luis')
    expect(diagnosis.reason).not.toBe('production-verified-anchor')
  })
})

describe('D · margen entre DOS anclas verificadas (verifiedAnchorMargin)', () => {
  const ANCLA_ANA = eje(3)

  function dosAnclas(): any[] {
    return (
      seedRegisteredAnchors(
        [],
        [
          { name: 'Luis', vector: ANCLA_LUIS, model: MODELO, verified: true },
          { name: 'Ana', vector: ANCLA_ANA, model: MODELO, verified: true },
        ],
        { model: MODELO },
      ) || []
    )
  }

  /** Vector con coseno EXACTO contra las dos anclas (resto ortogonal). */
  function vozConDosCosenos(cosLuis: number, cosAna: number): number[] {
    const vector = new Array(DIM).fill(0)
    vector[0] = cosLuis
    vector[3] = cosAna
    vector[4] = Math.sqrt(Math.max(0, 1 - cosLuis * cosLuis - cosAna * cosAna))
    return vector
  }

  it('si la mejor ancla NO saca 0.05 a la segunda, NO se adivina el nombre', () => {
    const diagnosis: Record<string, unknown> = {}
    const label = resolver(vozConDosCosenos(0.64, 0.62), { clusters: dosAnclas(), diagnosis })
    expect(label, '0.64 vs 0.62 es ambiguo: ninguna identidad se afirma').toBe('Hablante 1')
    expect(label).not.toBe('Luis')
    expect(label).not.toBe('Ana')
  })

  it('si la segunda ancla queda bajo el piso, la mejor confirma aunque el margen no exista', () => {
    const diagnosis: Record<string, unknown> = {}
    const label = resolver(vozConDosCosenos(0.65, 0.59), { clusters: dosAnclas(), diagnosis })
    expect(label).toBe('Luis')
    expect(diagnosis.reason).toBe('production-verified-anchor')
  })
})
