// Guard - la espera previa al lanzamiento del turno es explícita y config-driven.
// Antes estaba embebida en el hook y era invisible: un retardo FIJO de wake (3 s)
// más la gracia de dictado se leía como "la IA tarda". Aquí se fija el contrato
// del cálculo con config sintética; el valor REAL de FLU_CONFIG se vigila aparte,
// porque su umbral decide cuántos segundos espera el usuario antes de ver nada.
import { describe, it, expect } from 'vitest'
import { resolvePreLaunchDelay } from '../src/voice/lib/preLaunchDelay'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig'

const CFG = {
    wakeWordCommandDelayMs: 3000,
    interimCommandDelayMs: 1400,
    incompleteCommandWaitMs: 6000,
    dictationGraceWords: 10,
    dictationGraceBaseMs: 800,
    dictationGracePerWordMs: 120,
    dictationGraceMaxMs: 4000,
}

describe('espera previa al lanzamiento', () => {
    it('comando con wake usa el margen de wake y lo declara', () => {
        const r = resolvePreLaunchDelay({ turnPhrase: 'ok flu borra la clase', wakeWordMatched: true, ready: true, timingCfg: CFG })
        expect(r.origin).toBe('wake')
        expect(r.baseMs).toBe(3000)
        expect(r.dictationExtraMs).toBe(0)
        expect(r.delayMs).toBe(3000)
    })

    it('comando sin wake usa el margen de interim', () => {
        const r = resolvePreLaunchDelay({ turnPhrase: 'borra la clase', wakeWordMatched: false, ready: true, timingCfg: CFG })
        expect(r.origin).toBe('interim')
        expect(r.delayMs).toBe(1400)
    })

    it('comando incompleto nunca se lanza antes de su margen', () => {
        const r = resolvePreLaunchDelay({ turnPhrase: 'ok flu busca en la web', wakeWordMatched: false, ready: false, timingCfg: CFG })
        expect(r.delayMs).toBe(6000)
    })

    it('dictado amplía el margen y queda desglosado', () => {
        const largo = resolvePreLaunchDelay({
            turnPhrase: Array(14).fill('palabra').join(' '),
            wakeWordMatched: false,
            ready: true,
            timingCfg: CFG,
        })
        expect(largo.wordCount).toBe(14)
        expect(largo.dictationExtraMs).toBe(800 + 4 * 120)
        expect(largo.delayMs).toBe(1400 + largo.dictationExtraMs)
    })

    it('la gracia de dictado no se aplica a una frase de comando normal', () => {
        const r = resolvePreLaunchDelay({ turnPhrase: 'borra la clase de historia del jueves', wakeWordMatched: false, ready: true, timingCfg: CFG })
        expect(r.dictationExtraMs).toBe(0)
        expect(r.delayMs).toBe(1400)
    })

    it('sin config no revienta (ni inventa literales)', () => {
        const r = resolvePreLaunchDelay({ turnPhrase: 'hola', wakeWordMatched: true, ready: true })
        expect(r.delayMs).toBe(0)
        expect(r.origin).toBe('wake')
    })
})

describe('coste real de la espera con la config de FLU (medición, no juicio)', () => {
    it('el umbral de dictado marca desde cuántas palabras se paga el margen extra', () => {
        const cfg = FLU_CONFIG.timing
        // Coste REAL de un comando hablado con wake (el caso "Okay Flow …"):
        // base wake + gracia de dictado desde `dictationGraceWords` palabras.
        const frase = 'Okay Flow borra la clase de historia del dia jueves'
        const r = resolvePreLaunchDelay({ turnPhrase: frase, wakeWordMatched: true, ready: true, timingCfg: cfg })
        expect(r.wordCount).toBe(10)
        expect(r.baseMs).toBe(cfg.wakeWordCommandDelayMs)
        expect(r.delayMs).toBeGreaterThanOrEqual(cfg.wakeWordCommandDelayMs)
        // El número concretó que paga el usuario queda en el reporte del test.
        console.log(
            `[espera] "${frase}" -> ${r.delayMs}ms (base=${r.baseMs} + dictado=${r.dictationExtraMs}, umbral=${cfg.dictationGraceWords} palabras)`,
        )
        // Contrato: con el umbral en 2 la gracia entra en frases de comando normal.
        const comandoCorto = resolvePreLaunchDelay({ turnPhrase: 'borra clase', wakeWordMatched: false, ready: true, timingCfg: cfg })
        expect(comandoCorto.dictationExtraMs).toBe(cfg.dictationGraceBaseMs)
        const comandoMedio = resolvePreLaunchDelay({ turnPhrase: 'borra la clase', wakeWordMatched: false, ready: true, timingCfg: cfg })
        expect(comandoMedio.dictationExtraMs).toBe(cfg.dictationGraceBaseMs + cfg.dictationGracePerWordMs)
    })
})
