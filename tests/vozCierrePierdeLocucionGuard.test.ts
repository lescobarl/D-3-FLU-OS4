// ============================================================
// vozCierrePierdeLocucionGuard - GUARD de la PERDIDA MEDIDA (P9.59)
// ------------------------------------------------------------
// DEFECTO (log del dueno, 2026-10-10 10:09): 23 commits y SOLO 11 filas.
//   - `transcriptIngress.js:495-506`: el FINAL de Chrome llama a `scheduleTurnCommit`
//     SIN `settlesTurn` -> default false.
//   - `conversationStreamCommit.js:556`: el gate real de la fila es
//     `if (refreshNeeded && settlesTurn)` -> un FINAL no escribe fila.
//   - y el MISMO commit escribia `lastEmittedTranscriptRef.current = capture` aunque
//     NO hubiera emitido fila: ese ref es la FUENTE DEL DEDUPE
//     (`isDuplicateTurnCommit`), asi que el CIERRE real (mismo texto, settlesTurn:true)
//     caia como "duplicado" y la locucion entera se perdia sin fila.
//
// HARNESS FIEL: el sink del ingress ES el COMMIT real (`handleConversationStreamSync`),
// igual que en produccion (`useFluVoiceAssistant.js:1799`). Los harness anteriores
// escribian la fila desde un sink falso que NO pasaba por el commit, por eso podian
// estar VERDES mientras la app perdia texto.
//
// SECUENCIA FIEL: se reproduce lo que Chrome emite de verdad —interims que crecen,
// un FINAL de segmento, silencio (`srGap`) y `onend`— no un mock de un solo evento.
// ============================================================
import { describe, expect, it } from 'vitest'
import { createConversationIngressRuntime } from '../src/voice/lib/conversationIngressBridge.js'
import { pushMicSpeechEvent, pushRecognitionEndEvent, pushSrGapEvent } from '../src/voice/lib/micEventProducer.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'

function chromeEvent(specs: Array<{ isFinal?: boolean; transcript: string }>, resultIndex = 0) {
    const results = specs.map((s) => ({
        isFinal: Boolean(s.isFinal),
        0: { transcript: s.transcript, confidence: 0.9 },
        length: 1,
    }))
    return { resultIndex, results }
}

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
        lastCommitPerfAtRef: { current: 0 },
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
        getLastCommitPerfAt: () => 0,
        clearTurnAudioSnapshot: () => {},
        renameSpeakerRows: () => {},
        setSpeakerClusters: () => {},
        getSpeakerClusters: () => [],
        getTurnAudioSnapshot: () => null,
        // LA FILA: unica puerta de emision (la llama el commit real y nadie mas).
        emitConversationLog: (text: string) => {
            rows.push(text)
            return true
        },
        // sink del ingress = COMMIT REAL (mismo cableado que produccion)
        syncConversationStream: (payload: any = {}) => handleConversationStreamSync(ctx, payload),
    }
    // ctx tolerante: cualquier binding no listado es un no-op (o un ref vacio).
    const ctx = new Proxy(bindings, {
        get: (t, k) => {
            if (k in t) return (t as any)[k]
            if (typeof k === 'string' && k.endsWith('Ref')) return { current: null }
            return () => null
        },
    }) as any
    const runtime = createConversationIngressRuntime({ getBindings: () => ctx })
    const drain = (pushed: unknown) => {
        if (pushed) runtime.drainAll()
    }
    return {
        runtime,
        rows,
        // Un onresult de Chrome (interim o final). Chrome emite interims que crecen
        // antes del final del mismo tramo.
        result(event: unknown) {
            drain(pushMicSpeechEvent(event as never, runtime.queue))
        },
        // Silencio: el cierre REAL por srGap (mismo evento que emite fluTranscriptPause).
        srGap(sinceLastResultMs = 99999) {
            drain(pushSrGapEvent({ sinceLastResultMs }, runtime.queue))
        },
        // onend de Chrome: cierre REAL del turno.
        end() {
            drain(pushRecognitionEndEvent(runtime.queue))
        },
    }
}

// Locucion LARGA (la cuenta del dueno) y luego OTRA locucion distinta, cada una con su
// FINAL de Chrome y separadas por un SILENCIO real (`srGap`), como en su log.
const LARGA =
    'vamos a hacer pruebas de transcripcion diarizacion este aqui estamos haciendo las primeras pruebas voy a contar ahora 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 18 19 20'
const CORTA = 'sigue igual mal se perdio la transcripcion'

describe('P9.59 - ninguna locucion puede quedarse fuera de la conversacion', () => {
    it('una locucion con FINAL + onend SI llega a la fila (el caso mas comun)', () => {
        const h = createHarness()
        h.result(chromeEvent([{ isFinal: false, transcript: CORTA }], 0))
        h.result(chromeEvent([{ isFinal: true, transcript: CORTA }], 0))
        h.end()
        expect(h.rows.join(' | '), 'filas=' + JSON.stringify(h.rows)).toContain('sigue igual mal')
    })

    it('pausa real (srGap) entre dos locuciones: las DOS quedan en la conversacion', () => {
        const h = createHarness()
        h.result(chromeEvent([{ isFinal: false, transcript: LARGA }], 0))
        h.result(chromeEvent([{ isFinal: true, transcript: LARGA }], 0))
        h.srGap() // el dueno hace una pausa
        h.result(chromeEvent([{ isFinal: false, transcript: CORTA }], 0))
        h.result(chromeEvent([{ isFinal: true, transcript: CORTA }], 0))
        h.end()
        const todo = h.rows.join(' | ')
        expect(todo, 'filas=' + JSON.stringify(h.rows)).toContain('vamos a hacer pruebas')
        expect(todo, 'filas=' + JSON.stringify(h.rows)).toContain('sigue igual mal')
    })

    it('Chrome SEGMENTA la frase (interims + varios finales) y onend: queda la frase ENTERA', () => {
        const h = createHarness()
        // Chrome acumula `results` y sube `resultIndex` tramo a tramo: interim del tramo,
        // final del tramo, interim del siguiente... (lo que emite el micro de verdad).
        h.result(chromeEvent([{ isFinal: false, transcript: 'vamos a hacer pruebas' }], 0))
        h.result(chromeEvent([{ isFinal: true, transcript: 'vamos a hacer pruebas' }], 0))
        h.result(chromeEvent([
            { isFinal: true, transcript: 'vamos a hacer pruebas' },
            { isFinal: false, transcript: 'de transcripcion' },
        ], 1))
        h.result(chromeEvent([
            { isFinal: true, transcript: 'vamos a hacer pruebas' },
            { isFinal: false, transcript: 'de transcripcion diarizacion' },
        ], 1))
        h.result(chromeEvent([
            { isFinal: true, transcript: 'vamos a hacer pruebas' },
            { isFinal: true, transcript: 'de transcripcion diarizacion' },
        ], 1))
        h.result(chromeEvent([
            { isFinal: true, transcript: 'vamos a hacer pruebas' },
            { isFinal: true, transcript: 'de transcripcion diarizacion' },
            { isFinal: false, transcript: 'con 1 2 3' },
        ], 2))
        h.result(chromeEvent([
            { isFinal: true, transcript: 'vamos a hacer pruebas' },
            { isFinal: true, transcript: 'de transcripcion diarizacion' },
            { isFinal: true, transcript: 'con 1 2 3' },
        ], 2))
        h.end()
        const todo = h.rows.join(' | ')
        expect(todo, 'filas=' + JSON.stringify(h.rows)).toContain('vamos a hacer pruebas')
        expect(todo, 'filas=' + JSON.stringify(h.rows)).toContain('con 1 2 3')
    })
})

describe('el detector no es decorativo: el gate del CIERRE discrimina', () => {
    it('un final de SEGMENTO sin cierre NO escribe fila (no vuelve el vaciado)', () => {
        const h = createHarness()
        h.result(chromeEvent([{ isFinal: true, transcript: LARGA }], 0))
        // sin srGap y sin onend: el dictado sigue abierto
        expect(h.rows, 'filas=' + JSON.stringify(h.rows)).toHaveLength(0)
    })

    it('el silencio corto (srGap con resultado reciente) NO vuelca: no hay cierre real', () => {
        const h = createHarness()
        h.result(chromeEvent([{ isFinal: true, transcript: CORTA }], 0))
        h.srGap(50) // silencio por debajo del umbral: el turno sigue vivo
        expect(h.rows, 'filas=' + JSON.stringify(h.rows)).toHaveLength(0)
    })
})
