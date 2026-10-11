// ============================================================
// vozRebuildNoPierdeLocucionGuard - GUARD del defecto medido P9.60
// ------------------------------------------------------------
// DEFECTO (log del dueno, 2026-10-10 11:26, con P9.59 ya en verde):
//   11:26:09.823 FINAL de 169 chars -> `commit turn=1 replace=false` (NO escribe fila).
//   PAUSA REAL de 10,7 s sin `srGap` (solo latidos MicPcm): a los ~4,2 s el watchdog hace
//   REBUILD del reconocedor (`useFluVoiceAssistant.js:2445`) y su `flushListenStateBeforeRebuild`
//   DESCARTA la linea viva (`openLine=''`) suponiendo que es "un interino en vuelo".
//   Falso: la linea traia un FINAL ya integrado y SIN fila. Al reanudar, el texto nuevo
//   REEMPLAZA la linea y el srGap (stale) escribe solo ese texto -> la locucion de 169
//   chars no esta en NINGUNA fila.
//
// PROPIEDAD (dos piezas, capas declaradas):
//   A) DECISION (comportamiento, tuberia REAL): la linea abierta es "captura CONFIRMADA"
//      solo si el ultimo escritor fue un FINAL; con un interino POSTERIOR ya NO lo es
//      (ese es el que SI se descarta, para no crear filas basura).
//   B) CABLEADO (estructura): el rebuild del hook consulta ese unico dueno y, si es
//      confirmada, pide el CIERRE por la MISMA puerta (pushRecognitionEndEvent) en vez de
//      descartarla; `hasConfirmedOpenLine` tiene UN solo dueno.
// ============================================================
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createConversationIngressRuntime } from '../src/voice/lib/conversationIngressBridge.js'
import { pushMicSpeechEvent, pushRecognitionEndEvent } from '../src/voice/lib/micEventProducer.js'
import { createActiveListenState, hasConfirmedOpenLine } from '../src/voice/lib/activeListen.js'
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'

function chromeEvent(specs: Array<{ isFinal?: boolean; transcript: string }>, resultIndex = 0) {
    const results = specs.map((s) => ({
        isFinal: Boolean(s.isFinal),
        0: { transcript: s.transcript, confidence: 0.9 },
        length: 1,
    }))
    return { resultIndex, results }
}

/** Ingresso REAL: el sink es el commit real, como en produccion. */
function createHarness() {
    const rows: string[] = []
    const bindings: Record<string, unknown> = {
        conversationActiveRef: { current: true },
        listenStateRef: { current: createActiveListenState() },
        publishedLiveRef: { current: '' },
        lastStreamPreviewRef: { current: '' },
        logRowsTextRef: { current: rows },
        logRowSpeakersRef: { current: [] as string[] },
        lastEmittedTranscriptRef: { current: '' },
        lastLoggedSpeakerRef: { current: 'Hablante 1' },
        lastSpeakerRef: { current: 'Hablante 1' },
        lastCommitAtRef: { current: 0 },
        preflightScheduledForTurnRef: { current: false },
        openPreviewTurnRef: { current: false },
        speakerClustersRef: { current: [] },
        debugHotPath: false,
        fluDebugHot: () => {},
        getIngressVoiceContext: () => ({}),
        tryDispatchConversationAction: () => false,
        flushTranscriptOnFinal: () => {},
        flushPcmAfterTurnCommit: () => {},
        maybeSwitchRecognitionLocale: () => {},
        commitTurnToSessionRows: () => {},
        peekTurnBridgeText: () => '',
        stashTurnBridgeText: () => {},
        consumeTurnBridgeText: () => '',
        onTurnFinalized: () => {},
        markAudioSegmentStart: () => {},
        touchMeaningfulIngress: () => {},
        scheduleIdentityPreflight: () => {},
        finalizeTurnIdentityPipeline: () => null,
        getSpeakerLabel: () => 'Hablante 1',
        formatClock: () => '00:00',
        syncSpeakerIndexFromLabel: () => {},
        detectWakeIntroducedName: () => false,
        wakeWords: [] as string[],
        markCommitPerfNow: () => {},
        clearTurnAudioSnapshot: () => {},
        renameSpeakerRows: () => {},
        setSpeakerClusters: () => {},
        getSpeakerClusters: () => [],
        getTurnAudioSnapshot: () => null,
        emitConversationLog: (text: string) => {
            rows.push(text)
            return true
        },
        syncConversationStream: (payload: any = {}) => handleConversationStreamSync(ctx, payload),
    }
    const ctx = new Proxy(bindings, {
        get: (t, k) => {
            if (k in t) return (t as any)[k]
            if (typeof k === 'string' && k.endsWith('Ref')) return { current: null }
            return () => null
        },
    }) as any
    const runtime = createConversationIngressRuntime({ getBindings: () => ctx })
    return {
        state: () => (bindings.listenStateRef as { current: Record<string, unknown> }).current,
        rows,
        result(event: unknown) {
            if (pushMicSpeechEvent(event as never, runtime.queue)) runtime.drainAll()
        },
        end() {
            if (pushRecognitionEndEvent(runtime.queue)) runtime.drainAll()
        },
    }
}

const LARGA =
    'voy a hacer una prueba para identificar el comportamiento de la transcripcion y de la avisacion soy luis no digo el comando y hago una pausa'

describe('P9.60 - la captura CONFIRMADA sin fila no se puede descartar', () => {
    it('un FINAL integrado deja la linea como CONFIRMADA (aunque no haya fila)', () => {
        const h = createHarness()
        h.result(chromeEvent([{ isFinal: true, transcript: LARGA }], 0))
        expect(h.rows, 'una fila de segmento sin cierre: ' + JSON.stringify(h.rows)).toHaveLength(0)
        expect(hasConfirmedOpenLine(h.state())).toBe(true)
    })

    it('un FINAL confirmado con un interino POSTERIOR: la CONFIRMADA se sella (el parcial en vuelo se descarta)', () => {
        // REGLA CORREGIDA (2026-10-10, perdida medida en el log del dueno 19:24): antes se
        // miraba "la linea fue tocada DESPUES del final?" y con interinos posteriores la
        // locucion CONFIRMADA se daba por no-confirmada -> el rebuild la DESCARTA. Ahora la
        // pregunta es "hay una locucion CONFIRMADA sin fila?" (`pendingFinal`): el parcial
        // en vuelo se sigue descartando, pero la confirmada NO se pierde.
        const h = createHarness()
        h.result(chromeEvent([{ isFinal: true, transcript: LARGA }], 0))
        expect(hasConfirmedOpenLine(h.state())).toBe(true)
        // Reanuda el habla sin cerrar el turno: la linea pasa a llevar interino en vuelo.
        h.result(chromeEvent([{ isFinal: false, transcript: 'la transcripcion desde' }], 0))
        expect(hasConfirmedOpenLine(h.state()), 'la confirmada sigue sin fila: hay que sellarla').toBe(true)
    })

    it('sin ningun final, la linea es solo interino', () => {
        const h = createHarness()
        h.result(chromeEvent([{ isFinal: false, transcript: 'vamos a hacer pruebas' }], 0))
        expect(hasConfirmedOpenLine(h.state())).toBe(false)
    })

    it('el CIERRE de una captura confirmada SI escribe la fila (la puerta no cambia)', () => {
        const h = createHarness()
        h.result(chromeEvent([{ isFinal: true, transcript: LARGA }], 0))
        expect(hasConfirmedOpenLine(h.state())).toBe(true)
        h.end() // la misma peticion que hace el rebuild
        expect(h.rows.join(' '), 'filas=' + JSON.stringify(h.rows)).toContain('voy a hacer una prueba')
    })
})

describe('el detector no es decorativo: el rebuild pide el CIERRE, no el descarte', () => {
    const HOOK = 'src/voice/hooks/useFluVoiceAssistant.js'
    const src = readFileSync(HOOK, 'utf8')

    it('flushListenStateBeforeRebuild consulta el dueno y pide el cierre por la misma puerta', () => {
        const cuerpo = src.slice(
            src.indexOf('const flushListenStateBeforeRebuild'),
            src.indexOf('const cleanupAudio'),
        )
        expect(cuerpo).toContain('hasConfirmedOpenLine(listenStateRef.current)')
        expect(cuerpo).toContain('pushRecognitionEndEvent')
        // el cierre va ANTES del reset de la linea
        expect(cuerpo.indexOf('pushRecognitionEndEvent')).toBeLessThan(cuerpo.lastIndexOf("openLine = ''"))
    })

    it('hasConfirmedOpenLine tiene UN solo dueno (nadie lo reimplementa)', () => {
        const definiciones = [
            'src/voice/lib/activeListen.js',
            'src/voice/lib/conversationStream.js',
            'src/voice/lib/conversationStreamCommit.js',
            'src/voice/lib/transcriptIngress.js',
            HOOK,
        ].filter((f) => /export\s+function\s+hasConfirmedOpenLine\b/.test(readFileSync(f, 'utf8')))
        expect(definiciones).toEqual(['src/voice/lib/activeListen.js'])
    })
})
