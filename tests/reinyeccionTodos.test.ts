// ============================================================
// reinyeccionTodos - EVIDENCIA de reinyeccion sobre el ULTIMO log de la prueba del dueno, con el
// codigo ACTUAL, por la PUERTA REAL (no se llama al escritor de filas a mano):
//   E1 CAJA   : `asrRaw` -> processMicConversationIngress -> caja (reemplazos y crecimiento).
//   E2 FILAS  : los `commit` -> handleConversationStreamSync(turnCommit+settlesTurn) = la MISMA
//               compuerta del cierre real -> se cuentan las FILAS ESCRITAS (commitTurnToSessionRows).
//   E3 HABLANTE: los nombres (`identity`) sobre las claves (`clusters`) -> cuantas CLAVES pasan a
//               tener nombre (el batido: la fila se resuelve por CLAVE, no por la etiqueta escrita).
// ============================================================
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/voice/lib/voiceProbe', () => ({ voiceProbe: vi.fn() }))

import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'
import { processMicConversationIngress } from '../src/voice/lib/transcriptIngress.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { resetTurnSpeakerPreflights } from '../src/voice/lib/turnSpeakerPreflight.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { registerVoiceName, resetVoiceDirectory, resolveVoiceName } from '../src/voice/lib/speakerDirectory.js'

const TEMP = process.env.TEMP || process.env.TMP || '/tmp'
const TOPE = Number(process.env.FLU_EVENTOS || 150)

type Sonda = { tipo: string; datos: Record<string, unknown> }
const parse = (texto: string): Sonda[] => {
  const out: Sonda[] = []
  for (const linea of texto.split(/\r?\n/)) {
    const m = /VozProbe (\w+) (\{.*\})\s*$/.exec(linea)
    if (!m) continue
    try { out.push({ tipo: m[1] || '', datos: JSON.parse(m[2] || '{}') as Record<string, unknown> }) } catch { /* ignorar */ }
  }
  return out
}
const eventosAsr = (sondas: Sonda[]) => sondas.filter((s) => s.tipo === 'asrRaw').map((s) => {
  const items = (s.datos.items || []) as Array<{ f?: number; t?: string }>
  const interims: string[] = []; const finals: string[] = []
  for (const it of items) { const t = String(it?.t || '').trim(); if (!t) continue; if (it?.f === 1) finals.push(t); else interims.push(t) }
  return { interims, finals }
}).filter((e) => e.interims.length || e.finals.length)

/** Deps minimas de la puerta real (mismo cableado que produccion para lo que se mide). */
function montarDeps() {
  const serie: string[] = []
  const filas: string[] = []
  const deps = {
    conversationActiveRef: { current: true }, publishedLiveRef: { current: '' },
    listenStateRef: { current: createActiveListenState() }, openPreviewTurnRef: { current: false },
    setLiveTranscript: vi.fn((v: string) => serie.push(String(v))),
    scheduleLiveTranscriptUpdate: vi.fn((v: string) => serie.push(String(v))),
    applyConversationSpeaker: vi.fn(), flushPendingStreamLog: vi.fn(),
    logRowsTextRef: { current: [] as string[] }, activeTurnIdRef: { current: 0 },
    flushPcmAfterTurnCommit: vi.fn(), lastCommitAtRef: { current: 0 }, lastOnresultAtRef: { current: 0 },
    turnAudioStartSampleRef: { current: 0 }, chunkTotalSamplesRef: { current: 0 },
    preflightScheduledForTurnRef: { current: true }, srGapFiredForOpenLineRef: { current: true },
    processConversationFluQueryRef: { current: vi.fn() }, lastEmittedTranscriptRef: { current: '' },
    emitConversationLog: vi.fn(() => true),
    createSpeakerAudioResolver: vi.fn(() => () => Promise.resolve({ speakerName: 'Hablante 1' })),
    sessionPrimarySpeakerRef: { current: '' }, lastLoggedSpeakerRef: { current: '' },
    logRowSpeakersRef: { current: [] as string[] }, speakerClustersRef: { current: [] as object[] },
    setSpeakerClusters: vi.fn(), lastSpeakerRef: { current: '' },
    lastTurnSignatureRef: { current: null as number[] | null }, lastLogLineTextRef: { current: '' },
    commitTurnToSessionRows: vi.fn((text: string) => { if (text) filas.push(String(text)) }),
    lastRequestRef: { current: { text: '', at: 0 } },
    fluParticipantRef: { current: { onTurnCommitted: vi.fn() } },
  }
  const ctx = {
    ...deps, conversationActive: true, listenState: deps.listenStateRef.current, lastStreamPreviewRef: { current: '' },
    tryDispatch: vi.fn(() => false),
    syncConversationStream: (payload: object) => handleConversationStreamSync(deps as never, payload as never),
    maybeSwitchLocale: vi.fn(), peekTurnBridgeText: vi.fn(() => ''), stashTurnBridgeText: vi.fn(),
    consumeTurnBridgeText: vi.fn(), markAudioSegmentStart: vi.fn(), scheduleIdentityPreflight: vi.fn(),
    getIngressVoiceContext: vi.fn(() => ({ lastAssistantText: '', lastAssistantAtMs: 0 })),
    touchMeaningfulIngress: vi.fn(), onTurnFinalized: vi.fn(), flushTranscriptOnFinal: vi.fn(), debugHotPath: false,
  }
  return { deps, ctx, serie, filas }
}

const palabras = (t: string) => t.trim().split(/\s+/).filter(Boolean)
const repetidos6 = (texto: string) => {
  const w = palabras(texto); const v = new Map<string, number>()
  for (let i = 0; i + 6 <= w.length; i += 1) { const k = w.slice(i, i + 6).join(' ').toLowerCase(); v.set(k, (v.get(k) || 0) + 1) }
  return [...v.values()].filter((n) => n > 1).length
}

const SOLO = process.env.FLU_LOG || ''
const LOGS = (SOLO ? [join(TEMP, SOLO)] : readdirSync(TEMP)
  .filter((f) => f.startsWith('flu-debug-owner-') && f.endsWith('.log'))
  .map((f) => join(TEMP, f)).sort().slice(-1))
  .filter((p) => { try { return readFileSync(p, 'utf8').includes('VozProbe asrRaw') } catch { return false } })

describe('REINYECCION por la PUERTA REAL sobre el ultimo log de la prueba', () => {
  it.runIf(LOGS.length > 0)('E1 caja / E2 filas (cierre real) / E3 nombre por clave', () => {
    for (const ruta of LOGS) {
      const texto = readFileSync(ruta, 'utf8')
      const sondas = parse(texto)
      const asr = eventosAsr(sondas)
      const commits = sondas.filter((s) => s.tipo === 'commit')
      const identity = sondas.filter((s) => s.tipo === 'identity')
      const clusters = sondas.filter((s) => s.tipo === 'clusters')
      const logRowTurns = new Set(sondas.filter((s) => s.tipo === 'row').map((s) => Number(s.datos.turnId ?? -1)))

      // --- E1 CAJA -------------------------------------------------------------------------
      FLU_CONFIG.voiceCommands.requireWakeAlways = false
      resetTurnSpeakerPreflights()
      const e1 = montarDeps()
      for (const e of asr.slice(0, TOPE)) {
        processMicConversationIngress({ interimChunks: e.interims, finalChunks: e.finals, ctx: e1.ctx as never })
      }
      let reemplazos = 0; let anterior = ''
      for (const v of e1.serie) { if (v === '') { anterior = ''; continue } if (anterior && !v.includes(anterior)) reemplazos += 1; anterior = v }
      const caja = String(e1.deps.publishedLiveRef.current)

      // --- E2 FILAS por la compuerta del cierre real ---------------------------------------
      resetTurnSpeakerPreflights()
      const e2 = montarDeps()
      const cierrePorTurno = new Map<number, Record<string, unknown>>()
      for (const c of commits) { const t = Number(c.datos.turn ?? -1); if (logRowTurns.has(t)) cierrePorTurno.set(t, c.datos) }
      for (const c of [...cierrePorTurno.values()].map((datos) => ({ datos }))) {
        const t = String(c.datos.capture || c.datos.text || '').trim()
        if (!t) continue
        handleConversationStreamSync(e2.deps as never, {
          capture: t, utterance: t, speaker: String(c.datos.written || c.datos.name || 'Hablante 1'),
          turnCommit: true, settlesTurn: true, freshUtterance: true,
        } as never)
      }

      // --- E3 HABLANTE: el nombre entra por CLAVE y se resuelve por CLAVE -------------------
      resetVoiceDirectory()
      const nombres = [...new Set(identity.map((l) => String(l.datos.name || '')).filter(Boolean))]
      const claves = [...new Set(clusters.flatMap((l) => (Array.isArray(l.datos.labels) ? l.datos.labels.map(String) : [])))]
      for (const nombre of nombres) for (const clave of claves) registerVoiceName(clave, nombre)
      const resueltas = claves.filter((clave) => resolveVoiceName(clave))

      console.log(
        `[reinyeccion] ${ruta.split(/[\\/]/).pop()}` +
        ` | E1 CAJA: asr=${Math.min(TOPE, asr.length)}/${asr.length} caja=${caja.length} actualizaciones=${e1.serie.filter(Boolean).length} reemplazos=${reemplazos} repetidos6=${repetidos6(caja)}` +
        ` | E2 FILAS: commits=${commits.length} filasEscritas=${e2.filas.length} turnosConFilaEnLog=${logRowTurns.size}` +
        ` | E3 HABLANTE: nombres=[${nombres.join(', ')}] claves=[${claves.join(', ')}] clavesConNombre=${resueltas.length}/${claves.length}`,
      )
      expect(asr.length).toBeGreaterThan(0)
      expect(reemplazos, 'la caja no puede reemplazar lo mostrado (turno a turno)').toBe(0)
    }
  }, 600_000)
})

/** Marcador de la caja: una actualizacion NO puede dejar de contener la anterior. */
export function reemplazoDeCaja(anterior: string, siguiente: string): boolean {
  return Boolean(anterior) && !siguiente.includes(anterior)
}

describe('PRUEBA DE DETECTOR (el marcador no es decorativo)', () => {
  it('marca el reemplazo y NO el crecimiento', () => {
    expect(reemplazoDeCaja('hola que tal', 'hola que tal como estas')).toBe(false)
    expect(reemplazoDeCaja('hola que tal', 'buenas tardes')).toBe(true)
    expect(reemplazoDeCaja('', 'cualquiera')).toBe(false)
  })
})
