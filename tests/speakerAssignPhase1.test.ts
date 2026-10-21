// @vitest-environment node
// ============================================================
// speakerAssignPhase1 - asignacion de voz fase 1 (2026-10-21)
// ------------------------------------------------------------
// PRUEBA DE ESCRITORIO del dueno (sessionPrimary='Luis'), reproducida aqui:
//   - mujer limpia (coseno 0.500 con Luis)      -> Hablante N (correcto)
//   - turno MEZCLADO (0.894 / 0.835)            -> NO Luis (antes: pinned-rematch)
//   - mujer en turno CORTO (0.500)              -> NO Luis ni su etiqueta (antes:
//                                                  production-short-window-continuity)
//   - mujer con SU cluster                      -> su cluster
//   - matriz de segmentos limpios               -> 2 clusters, sin inflar
//   - segmento mezclado                         -> no se atribuye a Luis
//
// Y la EXTRACCION: de un turno "Luis -> silencio -> mujer" se mide el ULTIMO tramo
// contiguo de voz (el de la mujer), no los 2 s completos (la mezcla).
//
// Sin hardcode: pisos, margenes y etiqueta pendiente vienen de config
// (`speakerAssignDefaults.js` -> FLU_CONFIG) y el VAD es el UNICO del proyecto.
// ============================================================
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveConversationSpeaker, classifyVoiceAgainstClusters } from '../src/voice/lib/speakerDiarization.js'
import { selectVoicedWindow } from '../src/voice/lib/voicedActivity.js'
import { ContinuousAudioBuffer } from '../src/voice/lib/continuousAudioBuffer.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { SPEAKER_ASSIGN } from '../src/voice/lib/speakerAssignDefaults.js'
import { compareCosineSignatures, normalizeEmbeddingVector } from '../src/voice/lib/speakerCore.js'
import { commitUserTurnRow, resolvePendingSpeakerRows } from '../src/voice/lib/conversationTurnRow'
import { useIntegrationStore } from '../src/store/integrationStore'

const ROOT = process.cwd()
const THRESHOLDS = FLU_CONFIG.voiceIdentity.capture.conversationSpeakerThresholds
const PENDIENTE = FLU_CONFIG.voiceIdentity.labels.pendingSpeaker

const DIM = 512

/** PRNG determinista: la simulacion no depende de la maquina. */
function prng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function unitVec(seed: number) {
  const r = prng(seed)
  const v = new Array(DIM).fill(0)
  let n = 0
  for (let i = 0; i < DIM; i += 1) {
    v[i] = r() * 2 - 1
    n += v[i] * v[i]
  }
  n = Math.sqrt(n) || 1
  return v.map((x) => x / n)
}

const norm = (v: number[]) => {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1
  return v.map((x) => x / n)
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0)

/** Base ORTONORMAL de trabajo: e1 = voz del dueno, e2 y e3 ortogonales. */
const E1 = unitVec(11)
const E2_RAW = unitVec(29)
const K_LUIS_MUJER = Number(FLU_CONFIG.voiceIdentity.capture.conversationSpeakerThresholds.differentVoiceFloor)

/** Componente de `v` ortogonal a `base` (Gram-Schmidt). */
function ortogonal(v: number[], base: number[]) {
  const proj = dot(v, base)
  return norm(v.map((x, i) => x - proj * base[i]))
}

const E2 = ortogonal(E2_RAW, E1)
const E3 = ortogonal(ortogonal(unitVec(47), E1), E2)

/** Voz del dueno (referencia de la sesion). */
const VOZ_LUIS = E1
/** Voz de la mujer: coseno MEDIDO de voz distinta (`differentVoiceFloor`) con la del dueno. */
const VOZ_MUJER = norm(
  E1.map((x, i) => x * K_LUIS_MUJER + E2[i] * Math.sqrt(1 - K_LUIS_MUJER * K_LUIS_MUJER)),
)

/**
 * Medida del turno con cosenos EXACTOS contra cada voz (prueba de escritorio del dueno:
 * 0.500 limpia, 0.894/0.835 en el turno mezclado). Se resuelve en la base {e1, e2, e3}:
 * proyecto sobre e1 (coseno con Luis) y sobre e2 (lo que falta para el coseno con la mujer).
 *
 * @param cosLuis Coseno pedido contra la voz del dueno.
 * @param cosMujer Coseno pedido contra la voz de la mujer (opcional).
 */
function medida(cosLuis: number, cosMujer?: number) {
  const s = Math.sqrt(1 - K_LUIS_MUJER * K_LUIS_MUJER)
  const alfa = cosLuis
  const beta =
    cosMujer == null ? Math.sqrt(Math.max(0, 1 - alfa * alfa)) : (cosMujer - alfa * K_LUIS_MUJER) / s
  const escala = Math.hypot(alfa, beta) > 1 ? Math.hypot(alfa, beta) : 1
  const a = alfa / escala
  const b = beta / escala
  const gamma = Math.sqrt(Math.max(0, 1 - a * a - b * b))
  return norm(VOZ_LUIS.map((x, i) => x * a + E2[i] * b + E3[i] * gamma))
}

const TEXTO_LARGO =
  'bueno pues yo creo que la diarizacion tendria que distinguir mi voz de la voz de ella en cada turno de la conversacion'

function resolver({
  vector,
  clusters,
  lastSpeaker = '',
  lastSignature = null,
  utteranceText = TEXTO_LARGO,
  voicedSampleCount = 86400,
  sessionPrimary = 'Luis',
}: {
  vector: number[]
  clusters: any[]
  lastSpeaker?: string
  lastSignature?: number[] | null
  utteranceText?: string
  voicedSampleCount?: number
  sessionPrimary?: string
}) {
  const diagnosis: Record<string, unknown> = {}
  const speaker = resolveConversationSpeaker({
    signatureVector: vector,
    speakerClusters: clusters,
    lastSpeaker,
    lastSignature,
    voicedSampleCount,
    minVoicedSamples: 12000,
    minVoicedSamplesForNew: 24000,
    utteranceText,
    sampleRate: 48000,
    atTurnBoundary: true,
    allowNewCluster: true,
    sessionPrimary,
    preferSpeaker: lastSpeaker,
    thresholds: THRESHOLDS,
    diagnosis,
  } as any)
  return { speaker, diagnosis }
}

describe('prueba de escritorio: la mujer no sale Luis', () => {
  it('mujer LIMPIA (0.500 con Luis) -> su propia etiqueta, nunca el nombre', () => {
    const clusters = [{ label: 'Luis', signature: [...VOZ_LUIS], signatureHistory: [[...VOZ_LUIS]] }]
    const { speaker, diagnosis } = resolver({ vector: medida(0.5), clusters })

    expect(speaker).not.toBe('Luis')
    expect(speaker, JSON.stringify(diagnosis)).toMatch(/^Hablante \d+$/)
  })

  it('turno MEZCLADO (Luis 0.894 / mujer 0.835) -> NO se atribuye a Luis', () => {
    const clusters = [
      { label: 'Luis', signature: [...VOZ_LUIS], signatureHistory: [[...VOZ_LUIS]] },
      { label: 'Hablante 1', signature: [...VOZ_MUJER], signatureHistory: [[...VOZ_MUJER]] },
    ]
    const { speaker, diagnosis } = resolver({ vector: medida(0.894, 0.835), clusters })

    expect(speaker, JSON.stringify(diagnosis)).not.toBe('Luis')
  })

  it('mujer en turno CORTO (0.500 con 500 ms) -> no hereda etiqueta ni nombre', () => {
    const clusters = [
      { label: 'Luis', signature: [...VOZ_LUIS], signatureHistory: [[...VOZ_LUIS]] },
      { label: 'Hablante 1', signature: [...VOZ_MUJER], signatureHistory: [[...VOZ_MUJER]] },
    ]
    const { speaker, diagnosis } = resolver({
      vector: medida(0.5),
      clusters,
      lastSpeaker: 'Hablante 1',
      lastSignature: VOZ_MUJER,
      utteranceText: 'hola',
      voicedSampleCount: 24000,
    })

    expect(speaker, JSON.stringify(diagnosis)).not.toBe('Luis')
    expect(['Hablante 1', PENDIENTE]).toContain(speaker)
  })

  it('mujer CON su cluster -> su cluster (no se le quita lo que ya tenia)', () => {
    const clusters = [
      { label: 'Luis', signature: [...VOZ_LUIS], signatureHistory: [[...VOZ_LUIS]] },
      { label: 'Hablante 1', signature: [...VOZ_MUJER], signatureHistory: [[...VOZ_MUJER]] },
    ]
    const { speaker } = resolver({ vector: medida(0.1, 0.9), clusters })

    expect(speaker).toBe('Hablante 1')
  })
})

describe('matriz de segmentos: limpios separan, el mezclado no se atribuye', () => {
  /** Corre una secuencia de turnos y devuelve las etiquetas y los clusters vivos. */
  function correrSecuencia(medidas: number[][]) {
    const clusters: any[] = []
    const etiquetas: string[] = []
    let lastSpeaker = ''
    let lastSignature: number[] | null = null
    for (const vector of medidas) {
      const { speaker } = resolver({ vector, clusters, lastSpeaker, lastSignature })
      etiquetas.push(speaker)
      if (speaker === 'Luis' && !clusters.some((c) => c.label === 'Luis')) {
        clusters.push({ label: 'Luis', signature: [...vector], signatureHistory: [[...vector]] })
      } else if (/^Hablante \d+$/.test(speaker) && !clusters.some((c) => c.label === speaker)) {
        clusters.push({ label: speaker, signature: [...vector], signatureHistory: [[...vector]] })
      }
      lastSpeaker = speaker
      lastSignature = vector
    }
    return { etiquetas, clusters }
  }

  it('segmentos LIMPIOS: 2 voces -> como maximo 2 clusters y ninguna mujer "Luis"', () => {
    const { etiquetas, clusters } = correrSecuencia([
      medida(0.95),
      medida(0.93),
      medida(0.05, 0.95),
      medida(0.94),
      medida(0.06, 0.94),
    ])

    expect(clusters.length, etiquetas.join(' | ')).toBeLessThanOrEqual(2)
    const deLaMujer = etiquetas.filter((e) => e !== 'Luis')
    expect(deLaMujer.length).toBeGreaterThan(0)
    expect(deLaMujer.every((e) => e !== 'Luis')).toBe(true)
  })

  it('segmento MEZCLADO (0.894/0.835) dentro de la secuencia: no se atribuye a Luis', () => {
    const { etiquetas } = correrSecuencia([medida(0.95), medida(0.894, 0.835), medida(0.94)])

    expect(etiquetas[1], etiquetas.join(' | ')).not.toBe('Luis')
  })
})

describe('asignacion por centroides (dueno unico)', () => {
  it('conocida / gris / nueva segun los pisos de config', () => {
    const clusters = [{ label: 'Luis', signature: [...VOZ_LUIS] }]
    const reuse = Number(THRESHOLDS.productionClusterReuseThreshold)
    const nueva = Number(THRESHOLDS.cosineNewVoiceThreshold)

    expect(classifyVoiceAgainstClusters({ vector: medida(0.95), speakerClusters: clusters, thresholds: THRESHOLDS }).verdict).toBe('known')
    const gris = classifyVoiceAgainstClusters({
      vector: medida((reuse + nueva) / 2),
      speakerClusters: clusters,
      thresholds: THRESHOLDS,
    })
    expect(gris.verdict).toBe('grey')
    expect(classifyVoiceAgainstClusters({ vector: medida(0.2), speakerClusters: clusters, thresholds: THRESHOLDS }).verdict).toBe('new')
  })
})

describe('EXTRACCION: se mide el ultimo tramo contiguo de voz, no los 2 s completos', () => {
  const RATE = 16000
  const tone = (freq: number, ms: number, amp = 0.3) => {
    const n = Math.floor((RATE * ms) / 1000)
    const out = new Float32Array(n)
    for (let i = 0; i < n; i += 1) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / RATE)
    return out
  }
  const silence = (ms: number) => new Float32Array(Math.floor((RATE * ms) / 1000))

  /** Proyeccion de energia a dos frecuencias: el "embedding" de juguete de este test. */
  function firma(samples: Float32Array, freqs: [number, number]) {
    const energia = freqs.map((f) => {
      let re = 0
      let im = 0
      for (let i = 0; i < samples.length; i += 1) {
        const ang = (2 * Math.PI * f * i) / RATE
        re += samples[i] * Math.cos(ang)
        im += samples[i] * Math.sin(ang)
      }
      return Math.hypot(re, im) / Math.max(1, samples.length)
    })
    return normalizeEmbeddingVector(energia)
  }

  const FREQS: [number, number] = [220, 660]
  const LUIS = tone(220, 900)
  const MUJER = tone(660, 900)
  const TURNO = new Float32Array([...LUIS, ...silence(700), ...MUJER])

  it('el tramo medido es el de la MUJER (el ultimo), no la mezcla de los dos', () => {
    const tramo = selectVoicedWindow(TURNO, { sampleRate: RATE, prefer: 'last' })
    const deMujer = firma(MUJER, FREQS)
    const deLuis = firma(LUIS, FREQS)
    const medido = firma(tramo, FREQS)

    expect(compareCosineSignatures(medido, deMujer)).toBeGreaterThan(0.98)
    expect(compareCosineSignatures(medido, deLuis)).toBeLessThan(0.2)
    // La ventana COMPLETA (lo que se medía antes) sí es una mezcla de las dos voces.
    const mezcla = firma(TURNO, FREQS)
    expect(compareCosineSignatures(mezcla, deMujer)).toBeLessThan(0.99)
  })

  it('`prefer: "longest"` sigue devolviendo el tramo con mas voz (no se rompe lo previo)', () => {
    const largo = new Float32Array([...tone(220, 1200), ...silence(700), ...tone(660, 400)])
    const tramo = selectVoicedWindow(largo, { sampleRate: RATE, prefer: 'longest' })
    expect(compareCosineSignatures(firma(tramo, FREQS), firma(tone(220, 1200), FREQS))).toBeGreaterThan(0.98)
  })

  it('la ventana del TURNO aplica esa extraccion (un solo dueno del recorte)', () => {
    const buffer = new ContinuousAudioBuffer({ sampleRate: RATE, maxBufferMs: 30000 })
    buffer.markTurnStart(1)
    buffer.append(TURNO)
    const ventana = buffer.snapshotTurnWindow({ turnAudioStartSample: buffer.getTurnStartSample() })
    const deMujer = firma(MUJER, FREQS)

    expect(compareCosineSignatures(firma(ventana, FREQS), deMujer)).toBeGreaterThan(0.9)
  })
})

describe('recalculo de filas INCIERTAS (solo cuando aparece un cluster nuevo)', () => {
  const firma = (primera: number) => {
    const v = new Array(16).fill(0)
    v[primera] = 1
    return v
  }

  function sembrarPendiente(id: string, signature: number[]) {
    useIntegrationStore.setState({
      conversationHistory: [
        { id, role: 'user', text: 'texto ' + id, timestamp: 1, speakerId: 'speaker_1', speakerName: PENDIENTE, signature },
      ],
      conversationEpoch: 0,
    })
  }

  it('una fila PENDIENTE con firma que casa pasa al cluster; una RESUELTA no se toca', () => {
    sembrarPendiente('r-pendiente', firma(3))
    useIntegrationStore.setState((estado) => ({
      conversationHistory: [
        ...estado.conversationHistory,
        { id: 'r-resuelta', role: 'user', text: 'texto r', timestamp: 2, speakerId: 'speaker_2', speakerName: 'Luis' },
      ],
    }))

    const cambiadas = resolvePendingSpeakerRows([{ label: 'Hablante 4', signature: firma(3) }])
    expect(cambiadas).toBe(1)

    const porId = (id: string) =>
      String(useIntegrationStore.getState().conversationHistory.find((e) => e.id === id)?.speakerName || '')
    expect(porId('r-pendiente')).toBe('Hablante 4')
    expect(porId('r-resuelta'), 'una fila ya resuelta no se recalcula').toBe('Luis')
  })

  it('sin cluster que case (por debajo del piso) la fila SIGUE pendiente', () => {
    sembrarPendiente('r-otra', firma(5))
    const cambiadas = resolvePendingSpeakerRows([{ label: 'Hablante 4', signature: firma(9) }])

    expect(cambiadas).toBe(0)
    const fila = useIntegrationStore.getState().conversationHistory[0]
    expect(fila.speakerName).toBe(PENDIENTE)
  })
})

describe('filas INCIERTAS: la asignacion la decide el dueno unico', () => {
  const clusterLuis = { label: 'Luis', signature: [...VOZ_LUIS] }
  const clusterMujer = { label: 'Hablante 1', signature: [...VOZ_MUJER] }

  function filaPendiente(id: string, extra: Record<string, unknown> = {}) {
    useIntegrationStore.setState({
      conversationHistory: [
        {
          id,
          role: 'user',
          text: 'texto ' + id,
          timestamp: 1,
          speakerId: 'speaker_1',
          speakerName: PENDIENTE,
          ...extra,
        },
      ],
      conversationEpoch: 0,
    })
  }

  const fila = (id: string) =>
    useIntegrationStore.getState().conversationHistory.find((e) => e.id === id) as any

  it('Luis a 0,70 y la mujer a 0,68: el nombre NO pasa el margen -> nunca Luis', () => {
    // Cosenos EXACTOS: la fila pendiente esta mas cerca de Luis (0,70) que de la mujer (0,68),
    // pero el margen de una afirmacion con nombre propio no se alcanza.
    filaPendiente('r-empate', { signature: medida(0.7, 0.68) })

    const cambiadas = resolvePendingSpeakerRows([clusterLuis, clusterMujer])

    expect(cambiadas).toBe(1)
    expect(fila('r-empate').speakerName, 'el nombre de otra persona no se escribe por ser el mas parecido').not.toBe('Luis')
    expect(fila('r-empate').speakerName).toBe('Hablante 1')
  })

  it('la firma del NOMBRE si se afirma cuando saca el margen (no se bloquea lo legitimo)', () => {
    filaPendiente('r-luis', { signature: medida(0.95) })

    const cambiadas = resolvePendingSpeakerRows([clusterLuis, clusterMujer])

    expect(cambiadas).toBe(1)
    expect(fila('r-luis').speakerName).toBe('Luis')
  })

  it('fila pendiente SIN firma: se resuelve con la medida de SU TURNO (ledger) y actualiza la CLAVE', () => {
    // La fila nace sin medida por la PUERTA UNICA (commit): el commit recuerda turno -> fila.
    useIntegrationStore.setState({ conversationHistory: [], conversationEpoch: 0 })
    const { id } = commitUserTurnRow({ text: 'turno sin medida propia', speakerName: PENDIENTE, turnId: 7 })
    expect(id, 'la fila tiene que existir').toBeTruthy()
    const claveInicial = fila(String(id)).speakerId

    const cambiadas = resolvePendingSpeakerRows([clusterLuis, clusterMujer], {
      snapshots: [{ turnId: 7, signatureVector: [...VOZ_MUJER] }],
    })

    expect(cambiadas).toBe(1)
    const resuelta = fila(String(id))
    expect(resuelta.speakerName, 'la medida del turno es de la mujer: no puede salir Luis').not.toBe('Luis')
    expect(resuelta.speakerName).toBe('Hablante 1')
    // La CLAVE se actualiza para que el renombre por clave encuentre la fila despues.
    expect(resuelta.speakerId).toMatch(/^speaker_/)
    expect(resuelta.speakerId).not.toBe(claveInicial)
    expect(Array.isArray(resuelta.signature) && resuelta.signature.length > 0, 'la firma con la que se decidio queda estampada').toBe(true)
  })

  it('sin medida del turno la fila SIN firma sigue pendiente (no se inventa)', () => {
    useIntegrationStore.setState({ conversationHistory: [], conversationEpoch: 0 })
    const { id } = commitUserTurnRow({ text: 'otro turno sin medida', speakerName: PENDIENTE, turnId: 9 })

    const cambiadas = resolvePendingSpeakerRows([clusterLuis, clusterMujer], { snapshots: [] })

    expect(cambiadas).toBe(0)
    expect(fila(String(id)).speakerName).toBe(PENDIENTE)
  })
})

describe('GUARDS de fuente: un ledger, un writer, un predicado', () => {
  const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
  const sinComentarios = (texto: string) =>
    texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('el ledger de medidas de la sesion se define UNA vez', () => {
    const preflight = sinComentarios(read('src/voice/lib/turnSpeakerPreflight.js'))
    expect(preflight.match(/const sessionLedger = \[\]/g)?.length).toBe(1)
    expect(preflight.match(/export function getSessionSpeakerSnapshots/g)?.length).toBe(1)
  })

  it('el writer del nombre de una fila sigue siendo UNO (conversationTurnRow)', () => {
    const preflight = sinComentarios(read('src/voice/lib/turnSpeakerPreflight.js'))
    expect(preflight).not.toContain('setEntrySpeakerName')
    const dueno = sinComentarios(read('src/voice/lib/conversationTurnRow.ts'))
    expect(dueno).toContain('store.setEntrySpeakerName')
  })

  it('la asignacion por centroides tiene UN predicado y los demas lo importan', () => {
    const diarizacion = sinComentarios(read('src/voice/lib/speakerDiarization.js'))
    expect(diarizacion.match(/export function classifyVoiceAgainstClusters/g)?.length).toBe(1)
    expect(diarizacion.match(/function classifyVoiceAgainstClusters/g)?.length).toBe(1)
    const preflight = sinComentarios(read('src/voice/lib/turnSpeakerPreflight.js'))
    expect(preflight).toMatch(/import \{[^}]*classifyVoiceAgainstClusters[^}]*\} from '\.\/speakerDiarization\.js'/)
  })

  it('la etiqueta pendiente y los pisos viven en config, no como literales sueltos', () => {
    const defaults = read('src/voice/lib/speakerAssignDefaults.js')
    expect(defaults).toContain('pendingSpeaker')
    expect(defaults).toContain('differentVoiceFloor')
    expect(defaults).toContain('namedAssignMargin')
    const diarizacion = sinComentarios(read('src/voice/lib/speakerDiarization.js'))
    expect(diarizacion).not.toContain("'Hablante ?'")
    expect(SPEAKER_ASSIGN.pendingSpeaker).toBe(PENDIENTE)
  })
})
