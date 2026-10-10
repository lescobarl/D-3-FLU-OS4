// ============================================================
// vozCierrePierdeLocucionGuard - GUARD ROJO de la PERDIDA MEDIDA (P9.59)
// ------------------------------------------------------------
// DEFECTO (log del dueno, 2026-10-10 10:09): 23 commits y SOLO 11 filas. La causa:
//   - `transcriptIngress.js:495-506`: el FINAL de Chrome llama a `scheduleTurnCommit`
//     SIN `settlesTurn` -> default false.
//   - `conversationStreamCommit.js:495/556`: el gate real de la fila es
//     `if (refreshNeeded && settlesTurn)` -> un FINAL no escribe fila.
//   - el texto de esa locucion queda solo en `lastEmittedTranscriptRef` y el commit
//     siguiente lo PISA -> la locucion anterior se pierde.
// Resultado medido en su sesion: D1=10 turnos, D5=28 palabras del asrFinal en NINGUNA
// fila; la cuenta 1..40 en NINGUNA fila.
//
// HUECO DE FIDELIDAD QUE TAPA ESTE GUARD: los harness de voz empujaban la fila con
// solo `turnCommit: true`, SIN el gate real, asi que podian estar VERDES mientras la
// app perdia texto. Aqui el harness SI aplica el gate.
//
// NACE ROJO: la primera locucion no llega a ninguna fila.
// ============================================================
import { describe, expect, it } from 'vitest'
import { createConversationIngressRuntime } from '../src/voice/lib/conversationIngressBridge.js'
import { pushMicSpeechEvent, pushRecognitionEndEvent } from '../src/voice/lib/micEventProducer.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'

function chromeEvent(specs: Array<{ isFinal?: boolean; transcript: string }>, resultIndex = 0) {
    const results = specs.map((s) => ({
        isFinal: Boolean(s.isFinal),
        0: { transcript: s.transcript, confidence: 0.9 },
        length: 1,
    }))
    return { resultIndex, results }
}

function createHarness() {
    const logRowsTextRef = { current: [] as string[] }
    const lastEmittedTranscriptRef = { current: '' }
    const bindings = {
        conversationActiveRef: { current: true },
        listenStateRef: { current: createActiveListenState() },
        publishedLiveRef: { current: '' },
        lastStreamPreviewRef: { current: '' },
        logRowsTextRef,
        logRowSpeakersRef: { current: [] as string[] },
        lastEmittedTranscriptRef,
        lastLoggedSpeakerRef: { current: 'Hablante 1' },
        lastCommitAtRef: { current: 0 },
        preflightScheduledForTurnRef: { current: false },
        openPreviewTurnRef: { current: false },
        debugHotPath: false,
        fluDebugHot: () => {},
        getIngressVoiceContext: () => ({}),
        tryDispatchConversationAction: () => false,
        flushTranscriptOnFinal: () => {},
        flushPcmAfterTurnCommit: () => {},
        maybeSwitchRecognitionLocale: () => {},
        commitTurnToSessionRows: () => {},
        // GATE REAL (conversationStreamCommit.js:495/556): la fila se escribe SOLO si el
        // commit declara cierre (`settlesTurn`). Sin esta linea el guard seria teatro.
        syncConversationStream: (payload: any = {}) => {
            const capture = payload?.capture || ''
            if (!capture) return
            if (payload?.turnCommit) {
                if (payload?.settlesTurn === true) logRowsTextRef.current.push(capture)
                lastEmittedTranscriptRef.current = capture
                bindings.publishedLiveRef.current = capture
                bindings.lastCommitAtRef.current = Date.now()
            } else {
                bindings.publishedLiveRef.current = capture
            }
        },
        markAudioSegmentStart: () => {},
        touchMeaningfulIngress: () => {},
        scheduleIdentityPreflight: () => {},
        peekTurnBridgeText: () => '',
        stashTurnBridgeText: () => {},
        consumeTurnBridgeText: () => '',
        onTurnFinalized: () => {},
    }
    const runtime = createConversationIngressRuntime({ getBindings: () => bindings })
    return {
        runtime,
        logRowsTextRef,
        inject(event: unknown) {
            pushMicSpeechEvent(event as never, runtime.queue)
            runtime.drainAll()
        },
        end() {
            pushRecognitionEndEvent(runtime.queue)
            runtime.drainAll()
        },
    }
}

// Locucion LARGA (la cuenta del dueno) y luego OTRA locucion distinta, sin cierre entre
// ellas: es el patron exacto de su log (23 commits -> 11 filas).
const LARGA =
    'vamos a hacer pruebas de transcripcion diarizacion este aqui estamos haciendo las primeras pruebas voy a contar ahora 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 18 19 20'
const CORTA = 'sigue igual mal se perdio la transcripcion'

describe('P9.59 - ninguna locucion puede quedarse fuera de la conversacion', () => {
    it('final LARGO + final CORTO + cierre: la locucion larga NO puede perderse', () => {
        const h = createHarness()
        h.inject(chromeEvent([{ isFinal: true, transcript: LARGA }], 0))
        h.inject(chromeEvent([{ isFinal: true, transcript: CORTA }], 0))
        h.end()
        const todo = h.logRowsTextRef.current.join(' | ')
        expect(
            todo,
            'filas=' + JSON.stringify(h.logRowsTextRef.current),
        ).toContain('vamos a hacer pruebas')
    })

    it('los dos textos acaban en la conversacion (una locucion cada uno)', () => {
        const h = createHarness()
        h.inject(chromeEvent([{ isFinal: true, transcript: LARGA }], 0))
        h.inject(chromeEvent([{ isFinal: true, transcript: CORTA }], 0))
        h.end()
        const todo = h.logRowsTextRef.current.join(' | ')
        expect(todo, 'filas=' + JSON.stringify(h.logRowsTextRef.current)).toContain('sigue igual mal')
    })
})

describe('el detector no es decorativo', () => {
    it('con el cierre declarado (final + onend) el texto SI llega a la fila', () => {
        const h = createHarness()
        h.inject(chromeEvent([{ isFinal: true, transcript: CORTA }], 0))
        h.end()
        expect(h.logRowsTextRef.current.join(' ')).toContain('sigue igual mal')
    })
})
