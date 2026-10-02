// Conducta de audioSegmentClock: reloj de segmentos de audio (performance.now)
// para diarizacion cronologica. Frontera sustituida: el reloj de navegador
// performance.now (se espia) y su recaida a Date.now. La config se pasa
// explicita para no depender del valor real de FLU_CONFIG.
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
    getSegmentSilenceGapMs,
    nowPerf,
    markCommitPerfNow,
    getLastCommitPerfAt,
    isNewAudioSegment,
} from '../src/voice/lib/audioSegmentClock'

afterEach(() => {
    vi.restoreAllMocks()
})

const cfgGap = (gap: number) => ({
    voiceIdentity: { capture: { identityPipeline: { segmentSilenceGapMs: gap } } },
})

describe('getSegmentSilenceGapMs: umbral de silencio config-driven', () => {
    it('usa segmentSilenceGapMs cuando es valido', () => {
        expect(getSegmentSilenceGapMs(cfgGap(800) as any)).toBe(800)
    })

    it('recae en voiceHoldMs cuando falta segmentSilenceGapMs', () => {
        const cfg = { voiceIdentity: { capture: { conversationAudio: { voiceHoldMs: 500 } } } }
        expect(getSegmentSilenceGapMs(cfg as any)).toBe(500)
    })

    it('usa 1200 ms por defecto si no hay config valida', () => {
        expect(getSegmentSilenceGapMs({} as any)).toBe(1200)
        expect(getSegmentSilenceGapMs({ voiceIdentity: { capture: {} } } as any)).toBe(1200)
    })

    it('ignora valores no finitos o no positivos', () => {
        const cfg = {
            voiceIdentity: {
                capture: {
                    identityPipeline: { segmentSilenceGapMs: 0 },
                    conversationAudio: { voiceHoldMs: -3 },
                },
            },
        }
        expect(getSegmentSilenceGapMs(cfg as any)).toBe(1200)
    })
})

describe('reloj de commit (performance.now)', () => {
    it('nowPerf usa performance.now cuando existe', () => {
        vi.spyOn(performance, 'now').mockReturnValue(1234)
        expect(nowPerf()).toBe(1234)
    })

    it('nowPerf recae en Date.now si performance.now no es funcion', () => {
        const original = performance.now
        ;(performance as any).now = undefined
        try {
            vi.spyOn(Date, 'now').mockReturnValue(777)
            expect(nowPerf()).toBe(777)
        } finally {
            ;(performance as any).now = original
        }
    })

    it('markCommitPerfNow registra el instante y getLastCommitPerfAt lo lee', () => {
        markCommitPerfNow(5000)
        expect(getLastCommitPerfAt()).toBe(5000)
    })

    it('markCommitPerfNow recalcula cuando el valor no es finito', () => {
        vi.spyOn(performance, 'now').mockReturnValue(2000)
        expect(markCommitPerfNow(NaN)).toBe(2000)
        expect(getLastCommitPerfAt()).toBe(2000)
    })
})

describe('isNewAudioSegment: detecta un segmento nuevo por silencio', () => {
    it('es true cuando el hueco alcanza el umbral', () => {
        expect(isNewAudioSegment(2000, 1000, cfgGap(1000) as any)).toBe(true)
    })

    it('es false cuando el hueco es menor que el umbral', () => {
        expect(isNewAudioSegment(1500, 1000, cfgGap(1000) as any)).toBe(false)
    })

    it('es false con entradas no numericas o no positivas', () => {
        expect(isNewAudioSegment(0, 1000)).toBe(false)
        expect(isNewAudioSegment(NaN, 1000)).toBe(false)
        expect(isNewAudioSegment(1000, 0)).toBe(false)
        expect(isNewAudioSegment(1000, NaN)).toBe(false)
    })

    it('usa el ultimo commit registrado como referencia por defecto', () => {
        markCommitPerfNow(1000)
        expect(isNewAudioSegment(1600, undefined, cfgGap(500) as any)).toBe(true)
    })
})
