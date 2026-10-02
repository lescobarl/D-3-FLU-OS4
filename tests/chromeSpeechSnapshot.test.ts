// Conducta de chromeSpeechSnapshot: snapshot EXACTO de SpeechRecognition.onresult
// sin mutar los transcripts. No hay frontera externa: se le entrega un evento
// con forma de SpeechRecognitionEvent (results array-like) y se comprueba la copia.
import { describe, it, expect } from 'vitest'
import { snapshotChromeSpeechResult } from '../src/voice/lib/chromeSpeechSnapshot'

type Alt = { transcript: string | null; confidence: number | null }

function result(alts: Alt[], isFinal = false): any {
    const arr: any = alts.map((a) => ({ transcript: a.transcript, confidence: a.confidence }))
    arr.isFinal = isFinal
    return arr
}

function event(results: any[], resultIndex = 0): any {
    return { results, resultIndex }
}

describe('snapshotChromeSpeechResult: copia exacta de onresult', () => {
    it('devuelve null si no hay evento o no hay results', () => {
        expect(snapshotChromeSpeechResult(null)).toBeNull()
        expect(snapshotChromeSpeechResult(undefined)).toBeNull()
        expect(snapshotChromeSpeechResult({})).toBeNull()
        expect(snapshotChromeSpeechResult({ results: null })).toBeNull()
    })

    it('captura indice, isFinal, transcript y confidence de un unico resultado', () => {
        const snap = snapshotChromeSpeechResult(event([result([{ transcript: 'hola', confidence: 0.9 }], true)])) as any
        expect(snap).toEqual({
            resultIndex: 0,
            resultsLength: 1,
            newResults: [{ index: 0, isFinal: true, alternatives: [{ transcript: 'hola', confidence: 0.9 }] }],
        })
    })

    it('empieza en resultIndex y solo copia los resultados nuevos', () => {
        const e = event(
            [result([{ transcript: 'a', confidence: 0.1 }]), result([{ transcript: 'b', confidence: 0.2 }])],
            1,
        )
        const snap = snapshotChromeSpeechResult(e) as any
        expect(snap.resultIndex).toBe(1)
        expect(snap.newResults).toHaveLength(1)
        expect(snap.newResults[0].index).toBe(1)
        expect(snap.newResults[0].alternatives[0].transcript).toBe('b')
    })

    it('un resultIndex ausente o invalido se trata como 0', () => {
        const r = result([{ transcript: 'a', confidence: 1 }])
        expect((snapshotChromeSpeechResult({ results: [r] }) as any).resultIndex).toBe(0)
        expect((snapshotChromeSpeechResult({ results: [r], resultIndex: 'x' }) as any).resultIndex).toBe(0)
    })

    it('conserva todas las alternativas en su orden', () => {
        const snap = snapshotChromeSpeechResult(
            event([
                result([
                    { transcript: 'uno', confidence: 0.5 },
                    { transcript: 'dos', confidence: 0.3 },
                ]),
            ]),
        ) as any
        expect(snap.newResults[0].alternatives).toEqual([
            { transcript: 'uno', confidence: 0.5 },
            { transcript: 'dos', confidence: 0.3 },
        ])
    })

    it('normaliza transcript ausente a null', () => {
        const snap = snapshotChromeSpeechResult(event([result([{ transcript: null, confidence: 1 }])])) as any
        expect(snap.newResults[0].alternatives[0].transcript).toBeNull()
    })

    it('normaliza confidence no numerica a null', () => {
        const snap = snapshotChromeSpeechResult(
            event([result([{ transcript: 'x', confidence: 'alta' as any }])]),
        ) as any
        expect(snap.newResults[0].alternatives[0].confidence).toBeNull()
    })

    it('normaliza isFinal a booleano', () => {
        const truthy = snapshotChromeSpeechResult(
            event([result([{ transcript: 'x', confidence: 1 }], 1 as any)]),
        ) as any
        expect(truthy.newResults[0].isFinal).toBe(true)
        const falsy = snapshotChromeSpeechResult(
            event([result([{ transcript: 'x', confidence: 1 }], 0 as any)]),
        ) as any
        expect(falsy.newResults[0].isFinal).toBe(false)
    })

    it('reporta resultsLength como el total recibido', () => {
        const e = event([
            result([{ transcript: 'a', confidence: 1 }]),
            result([{ transcript: 'b', confidence: 1 }]),
        ])
        expect((snapshotChromeSpeechResult(e) as any).resultsLength).toBe(2)
    })

    it('no muta el evento original (snapshot, no referencia)', () => {
        const r0 = result([{ transcript: 'hola', confidence: 0.9 }], true)
        const e = event([r0])
        const before = JSON.stringify(e)
        const snap = snapshotChromeSpeechResult(e) as any
        expect(JSON.stringify(e)).toBe(before)
        expect(snap.newResults[0]).not.toBe(r0)
    })

    it('un resultIndex fuera de rango produce una lista vacia', () => {
        const snap = snapshotChromeSpeechResult(
            event([result([{ transcript: 'a', confidence: 1 }])], 5),
        ) as any
        expect(snap.newResults).toEqual([])
        expect(snap.resultsLength).toBe(1)
    })
})
