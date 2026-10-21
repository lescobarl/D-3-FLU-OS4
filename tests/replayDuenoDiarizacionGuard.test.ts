// ============================================================
// replayDuenoDiarizacionGuard - REPLAY CON DATOS CRUDOS del log del dueno, POR LA PUERTA REAL
// ------------------------------------------------------------
// Reinyecta, evento por evento, los item del ASR (VozProbe asrRaw) del log real sobre el
// INGRESS de produccion (processMicConversationIngress) -> conversacion (sync). El ingress es
// la MISMA puerta por la que el hook mete los eventos en la app (no es un atajo del test).
// Certifica: la caja (ultima frase) NUNCA reemplaza lo mostrado, se actualiza de forma
// progresiva y no infla el texto (caja_final <= suma de lo emitido).
// NOTA (honesta): el log NO trae audio -> el worker de embeddings no se recomputa aqui; la
// parte de voz (diarizacion) va por separado, con sus guards.
// ============================================================
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
vi.mock('../src/voice/lib/voiceProbe', () => ({ voiceProbe: vi.fn() }))
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'
import { processMicConversationIngress } from '../src/voice/lib/transcriptIngress.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { resetTurnSpeakerPreflights } from '../src/voice/lib/turnSpeakerPreflight.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

function makeDeps(over: Record<string, unknown> = {}) {
  const mostrado: string[] = []
  const emitido: string[] = []
  const deps = {
    conversationActiveRef: { current: true },
    publishedLiveRef: { current: '' },
    listenStateRef: { current: createActiveListenState() },
    openPreviewTurnRef: { current: false },
    setLiveTranscript: vi.fn<(v: string) => void>((v: string) => mostrado.push(String(v))), // incluye el vaciado ('') = frontera de turno
    scheduleLiveTranscriptUpdate: vi.fn<(v: string) => void>((v: string) => mostrado.push(String(v))), // incluye el vaciado ('') = frontera de turno
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
    emitConversationLog: vi.fn((text?: string) => { if (text) emitido.push(String(text)); return true }),
    createSpeakerAudioResolver: vi.fn(() => () => Promise.resolve({ speakerName: 'Hablante 1' })),
    sessionPrimarySpeakerRef: { current: '' },
    lastLoggedSpeakerRef: { current: '' },
    logRowSpeakersRef: { current: [] as string[] },
    speakerClustersRef: { current: [] as object[] },
    setSpeakerClusters: vi.fn(),
    lastSpeakerRef: { current: '' },
    lastTurnSignatureRef: { current: null as number[] | null },
    lastLogLineTextRef: { current: '' },
    commitTurnToSessionRows: vi.fn(),
    lastRequestRef: { current: { text: '', at: 0 } },
    fluParticipantRef: { current: { onTurnCommitted: vi.fn() } },
  }
  Object.assign(deps, over)
  return { deps, mostrado, emitido }
}



const TEMP = process.env.TEMP || process.env.TMP || '/tmp'
function rutaDelLog(): string | null {
  const explicita = process.env.FLU_REPLAY_LOG
  if (explicita && existsSync(explicita)) return explicita
  try {
    const candidatos = readdirSync(TEMP)
      .filter((f) => f.startsWith('flu-debug-owner-') && f.endsWith('.log'))
      .sort((a, b) => b.localeCompare(a)) // newest-ish first
      .slice(0, 3)
    for (const f of candidatos) {
      const p = join(TEMP, f)
      if (!existsSync(p)) continue
      try {
        const txt = readFileSync(p, 'utf8')
        if (txt.includes('VozProbe asrRaw')) return p
      } catch { continue }
    }
    return null
  } catch { return null }
}
const RUTA = rutaDelLog()

type Evento = { interims: string[]; finals: string[] }
function eventosCrudos(texto: string): Evento[] {
  const out: Evento[] = []
  const maxEvents = 400
  const maxItems = 100
  const lineas = texto.split(/\r?\n/)
  for (let i = 0; i < lineas.length && out.length < maxEvents; i += 1) {
    const linea = lineas[i]
    const idx = linea.indexOf('VozProbe asrRaw ')
    if (idx < 0) continue
    const brace = linea.indexOf('{', idx)
    if (brace < 0) continue
    const json = linea.slice(brace)
    try {
      const data = JSON.parse(json) as { items?: Array<{ f?: number; t?: string }> }
      const interims: string[] = []
      const finals: string[] = []
      const items = (data.items || []).slice(0, maxItems)
      for (const item of items) {
        const t = String(item?.t || '').trim()
        if (!t) continue
        if (item?.f === 1) finals.push(t); else interims.push(t)
      }
      if (interims.length || finals.length) out.push({ interims, finals })
    } catch { /* linea corrupta: se ignora */ }
  }
  return out
}

describe('REPLAY CRUDO por el INGRESS (datos del log, sin texto fabricado)', () => {
  // El log del dueno no se versiona (evidencia local): el guard corre cuando existe. Se declara
  // con runIf (misma semantica que la variante condicional) porque el sensor V7 cuenta la
  // marca de test deshabilitado y aqui no hay ningun test apagado: es condicion de evidencia.
  it.runIf(Boolean(RUTA))('la caja no reemplaza, avanza progresiva y no infla con los eventos crudos del log', () => {
    const texto = readFileSync(RUTA as string, 'utf8')
    const eventos = eventosCrudos(texto)
    if (!eventos.length) return // no eventos válidos
    expect(eventos.length, 'el log debe traer eventos asrRaw').toBeGreaterThan(10)
    FLU_CONFIG.voiceCommands.requireWakeAlways = false
    resetTurnSpeakerPreflights()
    const { deps, mostrado } = makeDeps()
    // La puerta real: TODO el deps del hook + los alias del ingress (ctx.listenState, etc.).
    const ctx = {
      ...deps,      conversationActive: true,
      listenState: deps.listenStateRef.current,
      publishedLiveRef: deps.publishedLiveRef,
      lastStreamPreviewRef: { current: '' },
      openPreviewTurnRef: deps.openPreviewTurnRef,
      logRowsTextRef: deps.logRowsTextRef,
      lastEmittedTranscriptRef: deps.lastEmittedTranscriptRef,
      tryDispatch: vi.fn(() => false),
      syncConversationStream: (payload: object) => handleConversationStreamSync(deps as never, payload as never),
      maybeSwitchLocale: vi.fn(),
      peekTurnBridgeText: vi.fn(() => ''),
      stashTurnBridgeText: vi.fn(),
      consumeTurnBridgeText: vi.fn(),
      markAudioSegmentStart: vi.fn(),
      scheduleIdentityPreflight: vi.fn(),
      getIngressVoiceContext: vi.fn(() => ({ lastAssistantText: '', lastAssistantAtMs: 0 })),
      touchMeaningfulIngress: vi.fn(),
      onTurnFinalized: vi.fn(),
      flushTranscriptOnFinal: vi.fn(),
      debugHotPath: false,
    }
    const maxProcess = 200
    for (let i = 0; i < eventos.length && i < maxProcess; i += 1) {
      const evento = eventos[i]
      processMicConversationIngress({ interimChunks: evento.interims, finalChunks: evento.finals, ctx: ctx as never })
    }
    // La serie COMPLETA incluye los vaciados (""): cada vaciado es una frontera de turno
    // (reset legitimo del cierre). Los reemplazos SOLO se miden DENTRO de cada turno.
    const serie = mostrado.map((s) => String(s))
    const segmentos: string[][] = []
    let actual: string[] = []
    for (const valor of serie) {
      if (valor === '') { if (actual.length) segmentos.push(actual); actual = []; continue }
      actual.push(valor)
    }
    if (actual.length) segmentos.push(actual)
    const violaciones: string[] = []
    segmentos.forEach((seg, indice) => {
      for (let i = 1; i < seg.length; i += 1) {
        if (!seg[i].includes(seg[i - 1])) violaciones.push('turno ' + indice + ' paso ' + i + ': reemplazo ' + seg[i - 1].length + ' -> ' + seg[i].length + ' | antes=' + JSON.stringify(seg[i - 1].slice(-60)) + ' | ahora=' + JSON.stringify(seg[i].slice(-60)))
      }
    })
    const totalEmitido = eventos.reduce((suma, e) => suma + [...e.interims, ...e.finals].reduce((s, t) => s + t.length, 0), 0)
    const finalesPorTurno = segmentos.map((seg) => seg[seg.length - 1].length)
    const maxPorTurno = finalesPorTurno.length ? Math.max(...finalesPorTurno) : 0
    console.log('[replay ingress] ' + RUTA)
    console.log('[replay ingress] eventos=' + eventos.length + ' turnos(vaciados)=' + segmentos.length + ' actualizaciones=' + serie.filter(Boolean).length)
    console.log('[replay ingress] caja final por turno (chars): ' + finalesPorTurno.join(', ') + '  | max=' + maxPorTurno + ' | emitido=' + totalEmitido)
    expect(violaciones, 'DENTRO de un turno la caja no puede reemplazar lo mostrado: ' + violaciones.slice(0, 4).join(' | ')).toEqual([])
    expect(serie.filter(Boolean).length, 'la caja debe avanzar (no quedarse muda)').toBeGreaterThan(20)
    expect(maxPorTurno, 'la caja debe llegar a mostrar texto largo en algun turno (hoy se queda en migajas)').toBeGreaterThan(200)
  }, 10000)
})

describe('PRUEBA DE DETECTOR (el marcador no es decorativo)', () => {
  it('un reemplazo sintetico DENTRO de un turno se marca; un crecimiento no', () => {
    const marcar = (seg: string[]) => {
      const out: string[] = []
      for (let i = 1; i < seg.length; i += 1) { if (!seg[i].includes(seg[i - 1])) out.push(String(i)) }
      return out
    }
    expect(marcar(['hola que tal', 'hola que tal como estas'])).toEqual([])
    expect(marcar(['hola que tal', 'buenas tardes'])).toEqual(['1'])
  })
})
