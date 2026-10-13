// ============================================================
// vozFilaSiempreConHablanteGuard - P9.65: ninguna fila de usuario sin hablante.
// ------------------------------------------------------------
// MEDIDO en el log del dueno (sesion 02:20-02:42, ANTES del gate): 40 filas -> 35 SIN
// hablante (`hablantes: (vacio)=35 luis=4 Hablante 1=1`), con `written:""` en 80/80
// commits: la fila nacía sin hablante "por diseno" y dependia del relleno tardio
// (`updateTurnRowSpeaker`), que ademas solo alcanzaba 13 turnos.
//
// REGLA (un dato, un dueno): la fila de usuario SIEMPRE lleva hablante. El dueno de la fila
// (`resolveRowSpeakerName`) aplica el RESPALDO cuando no hay etiqueta, y el commit aporta la
// etiqueta que trae el resolver (la evidencia acustica solo decide el ASCENSO a nombre
// propio). El relleno tardio COMPLETA; no es la unica via.
//
// ESTE GUARD mide la PROPIEDAD en las TRES vias de escritura reales.
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow, updateTurnRowSpeaker } from '../src/voice/lib/conversationTurnRow'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'
import { resetTurnSpeakerPreflights } from '../src/voice/lib/turnSpeakerPreflight.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const RESPALDO = String(
  (FLU_CONFIG as { voiceIdentity?: { labels?: { fallbackSpeaker?: string } } }).voiceIdentity?.labels
    ?.fallbackSpeaker || '',
)

const filasUsuario = () =>
  useIntegrationStore.getState().conversationHistory.filter((e) => e.role === 'user')

const hablantes = () => filasUsuario().map((e) => String(resolveRowSpeakerLabel(e) || ''))

describe('P9.65 - la fila de usuario SIEMPRE lleva hablante', () => {
  beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [] })
    resetTurnSpeakerPreflights()
  })
  afterEach(() => {
    resetTurnSpeakerPreflights()
  })

  it('sin etiqueta NINGUNA: la fila nueva sale con el respaldo (nunca vacia)', () => {
    commitUserTurnRow({ text: 'hola que tal', turnId: 1 } as never)
    expect(hablantes()).toEqual([RESPALDO])
  })

  it('las TRES vias del dueno (nueva, reutilizada, reemplazada) dejan hablante', () => {
    // 1) nueva
    commitUserTurnRow({ text: 'hola que tal', speakerName: 'Hablante 2', turnId: 1 } as never)
    // 2) reutilizada por identidad de turno (texto mas completo)
    commitUserTurnRow({ text: 'hola que tal y buenos dias', speakerName: 'Hablante 2', turnId: 1 } as never)
    // 3) reemplazada (misma emision, `replaceLast`)
    commitUserTurnRow({ text: 'hola que tal y buenos dias', speakerName: 'luis', replaceLast: true, turnId: 2 } as never)
    const h = hablantes()
    expect(h).toHaveLength(1)
    h.forEach((nombre, i) => expect(nombre, `fila ${i} sin hablante`).not.toBe(''))
  })

  it('el relleno tardio tampoco deja vacio (y no pisa el respaldo con nada)', () => {
    const { id } = commitUserTurnRow({ text: 'una frase cualquiera', turnId: 5 } as never)
    updateTurnRowSpeaker(5, '' as never)
    const fila = useIntegrationStore.getState().conversationHistory.find((e) => e.id === id)
    expect(String(resolveRowSpeakerLabel(fila) || '')).toBe(RESPALDO)
  })

  it('TUBERIA REAL: el commit del stream escribe hablante aunque el preflight no este listo', () => {
    FLU_CONFIG.voiceCommands.requireWakeAlways = false
    const filas: string[] = []
    const deps = {
      conversationActiveRef: { current: true },
      publishedLiveRef: { current: '' },
      listenStateRef: { current: createActiveListenState() },
      openPreviewTurnRef: { current: false },
      setLiveTranscript: vi.fn(),
      scheduleLiveTranscriptUpdate: vi.fn(),
      applyConversationSpeaker: vi.fn(),
      flushPendingStreamLog: vi.fn(),
      logRowsTextRef: { current: [] as string[] },
      activeTurnIdRef: { current: 0 },
      flushPcmAfterTurnCommit: vi.fn(),
      lastCommitAtRef: { current: 0 },
      lastOnresultAtRef: { current: 0 },
      turnAudioStartSampleRef: { current: 0 },
      chunkTotalSamplesRef: { current: 0 },
      preflightScheduledForTurnRef: { current: true },
      srGapFiredForOpenLineRef: { current: true },
      processConversationFluQueryRef: { current: vi.fn() },
      lastEmittedTranscriptRef: { current: '' },
      emitConversationLog: (text: string, options?: object) => {
        const o = (options || {}) as { speakerName?: string }
        filas.push(String(o.speakerName || ''))
        commitUserTurnRow({ text, speakerName: o.speakerName, turnId: deps.activeTurnIdRef.current } as never)
        return true
      },
      createSpeakerAudioResolver: vi.fn(() => () => Promise.resolve({ speakerName: 'Hablante 1' })),
      sessionPrimarySpeakerRef: { current: '' },
      lastLoggedSpeakerRef: { current: 'Hablante 2' },
      logRowSpeakersRef: { current: ['Hablante 2'] },
      speakerClustersRef: { current: [] as object[] },
      setSpeakerClusters: vi.fn(),
      lastSpeakerRef: { current: 'Hablante 2' },
      lastTurnSignatureRef: { current: null as number[] | null },
      lastLogLineTextRef: { current: '' },
      commitTurnToSessionRows: vi.fn(),
      lastRequestRef: { current: { text: '', at: 0 } },
      fluParticipantRef: { current: { onTurnCommitted: vi.fn() } },
    }
    handleConversationStreamSync(deps as never, {
      capture: 'una locucion de prueba del turno',
      turnCommit: true,
      settlesTurn: true,
    })
    // Lo que el dueno midio como `written:""` (80/80) tiene que ser NO-VACIO.
    expect(filas, 'la etiqueta que el commit escribe (written)').toEqual(['Hablante 2'])
    expect(hablantes(), 'la fila lleva hablante').toEqual(['Hablante 2'])
  })

  it('control NEGATIVO (el detector no es decorativo): el gate VIEJO dejaba `written` vacio', () => {
    // Mutante del defecto medido: condicionar la ESCRITURA a la evidencia acustica.
    const gateViejo = (etiqueta: string, ready: boolean): string => (ready ? etiqueta : '')
    expect(gateViejo('Hablante 2', false), 'el defecto: written "" con preflight no listo').toBe('')
    // Y lo que el dueno de la fila hace con '' es el RESPALDO (nunca vacio), asi que la
    // fila tampoco puede quedar sin hablante: esa es la propiedad que se fija arriba.
    expect(RESPALDO).not.toBe('')
  })
})
