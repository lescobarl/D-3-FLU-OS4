// ============================================================
// pronunciacion.test.ts - GUARD del motor de PRONUNCIACION (P8.65).
// El tutor dice una palabra y el alumno la repite; el motor acredita la
// repeticion (tolerante a un caracter del ASR) y cierra en victoria.
// ============================================================
import { describe, expect, it } from 'vitest'
import { createPronunciacionEngine, PRONUNCIACION_BANK } from '../src/core/games/pronunciacion'

const engine = createPronunciacionEngine({ random: () => 0 })

function currentWord(session: { state: unknown }): string {
    const state = session.state as { order: number[]; cursor: number }
    return PRONUNCIACION_BANK[state.order[state.cursor]].word
}

describe('pronunciacion: el tutor dice una palabra y acredita la repeticion', () => {
    it('arranca pidiendo repetir una palabra', () => {
        const s = engine.createSession({ rounds: 2 })
        const r = engine.start(s)
        expect(r.prompt.toLowerCase()).toContain('repite')
        expect(s.round).toBe(1)
        expect(s.score).toBe(0)
    })

    it('acredita la repeticion EXACTA y avanza con un siguiente', () => {
        const s = engine.createSession({ rounds: 2 })
        engine.start(s)
        const r = engine.turn(s, currentWord(s))
        expect(r.valid).toBe(true)
        expect(s.score).toBe(1)
        expect(r.gameOver).toBe(false)
    })

    it('tolera UN caracter del ASR (la pronunciacion no es exacta)', () => {
        const s = engine.createSession({ rounds: 2 })
        engine.start(s)
        const word = currentWord(s)
        const typo = word.slice(0, -1) + 'x' // un caracter cambiado al final
        const r = engine.turn(s, typo)
        expect(r.valid).toBe(true)
    })

    it('da la pista y NO acredita', () => {
        const s = engine.createSession({ rounds: 2 })
        engine.start(s)
        const r = engine.turn(s, 'pista')
        expect(r.valid).toBe(false)
        expect(s.score).toBe(0)
        expect(r.prompt.length).toBeGreaterThan(0)
    })

    it('cierra en VICTORIA al completar las rondas', () => {
        const s = engine.createSession({ rounds: 2 })
        engine.start(s, { rounds: 2 })
        engine.turn(s, currentWord(s))
        const last = engine.turn(s, currentWord(s))
        expect(last.gameOver).toBe(true)
        expect(last.won).toBe(true)
        expect(s.score).toBe(2)
    })

    it('una palabra fallada NO acredita y pide intentarlo otra vez', () => {
        const s = engine.createSession({ rounds: 2 })
        engine.start(s)
        const r = engine.turn(s, 'zzzzz')
        expect(r.valid).toBe(false)
        expect(s.score).toBe(0)
        expect(r.gameOver).toBe(false)
    })

    it('reconoce sus comandos (pista / otra / salir)', () => {
        expect(engine.isGameCommand('pista')).toBe(true)
        expect(engine.isGameCommand('otra')).toBe(true)
        expect(engine.isGameCommand('salir del juego')).toBe(true)
        expect(engine.isGameCommand('hola que tal')).toBe(false)
    })
})
