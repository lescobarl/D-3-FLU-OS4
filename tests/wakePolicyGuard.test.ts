// ============================================================
// P8.68 (por voz) — LA BANDERA DE WAKE SE ESCRIBE DONDE LA LEE EL DUENO
// ------------------------------------------------------------
// Pedido del dueno: "una bandera ... que se pueda prender o apagar por voz".
// El DUENO UNICO de la decision sigue siendo `requiresWakeWord`
// (tests/decisionSingleOwnerGuard.test.ts); aqui se comprueba que la orden por
// voz llega a ESE valor y que la confirmacion sale de la config (sin literales).
// ============================================================
import { describe, it, expect } from 'vitest'
import {
    WAKE_POLICY_ORDER,
    applyWakePolicyOrder,
    resolveWakePolicyOrder,
    wakePolicySpeech,
} from '../src/voice/lib/wakePolicy.js'
import { requiresWakeWord } from '../src/voice/lib/wakeTurnCommit.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const PHRASES = FLU_CONFIG.voiceCommands.wakePolicyPhrases

/** Marca de infraccion: la orden por voz no deja el valor en el dueno. */
export function wakePolicyOffenders(order: string, text: string): string[] {
    const esperado = order === WAKE_POLICY_ORDER.ON
    return resolveWakePolicyOrder(text) === order && FLU_CONFIG.voiceCommands.requireWakeAlways !== esperado
        ? [`la orden "${text}" no llego a requireWakeAlways (quedo ${FLU_CONFIG.voiceCommands.requireWakeAlways})`]
        : []
}

describe('P8.68 — la bandera de wake por voz escribe el valor del dueno', () => {
    it('reconoce la orden por las frases de CONFIG (on y off)', () => {
        for (const text of PHRASES.on) {
            expect(resolveWakePolicyOrder(text), text).toBe(WAKE_POLICY_ORDER.ON)
        }
        for (const text of PHRASES.off) {
            expect(resolveWakePolicyOrder(text), text).toBe(WAKE_POLICY_ORDER.OFF)
        }
    })

    it('no se dispara con una frase que no es la orden', () => {
        for (const text of ['pon musica', 'platícame de los barcos', 'okay flow hola', '']) {
            expect(resolveWakePolicyOrder(text), text).toBeNull()
        }
    })

    it('reconoce la orden CON la wake delante (el splitter unico la pela)', () => {
        for (const text of PHRASES.on) {
            expect(resolveWakePolicyOrder(`okay flow ${text}`), text).toBe(WAKE_POLICY_ORDER.ON)
        }
        for (const text of PHRASES.off) {
            expect(resolveWakePolicyOrder(`ok flu ${text}`), text).toBe(WAKE_POLICY_ORDER.OFF)
        }
    })

    it('la orden OFF abre el piso (no exige wake) y la ON lo cierra', () => {
        const original = FLU_CONFIG.voiceCommands.requireWakeAlways
        try {
            expect(applyWakePolicyOrder(WAKE_POLICY_ORDER.OFF)).toBe(true)
            expect(FLU_CONFIG.voiceCommands.requireWakeAlways).toBe(false)
            expect(requiresWakeWord(true)).toBe(false)
            expect(wakePolicyOffenders(WAKE_POLICY_ORDER.OFF, PHRASES.off[0])).toEqual([])

            expect(applyWakePolicyOrder(WAKE_POLICY_ORDER.ON)).toBe(true)
            expect(FLU_CONFIG.voiceCommands.requireWakeAlways).toBe(true)
            expect(requiresWakeWord(true)).toBe(true)
            expect(wakePolicyOffenders(WAKE_POLICY_ORDER.ON, PHRASES.on[0])).toEqual([])
        } finally {
            FLU_CONFIG.voiceCommands.requireWakeAlways = original
        }
    })

    it('rechaza una orden invalida sin tocar la config', () => {
        const original = FLU_CONFIG.voiceCommands.requireWakeAlways
        expect(applyWakePolicyOrder('quizas')).toBe(false)
        expect(FLU_CONFIG.voiceCommands.requireWakeAlways).toBe(original)
    })

    it('la confirmacion sale de la config y esta en los dos idiomas', () => {
        expect(wakePolicySpeech(WAKE_POLICY_ORDER.ON, 'es')).toBe(PHRASES.speechOn.es)
        expect(wakePolicySpeech(WAKE_POLICY_ORDER.ON, 'en')).toBe(PHRASES.speechOn.en)
        expect(wakePolicySpeech(WAKE_POLICY_ORDER.OFF, 'es')).toBe(PHRASES.speechOff.es)
        expect(wakePolicySpeech(WAKE_POLICY_ORDER.OFF, 'en')).toBe(PHRASES.speechOff.en)
    })
})

// Prueba de detector (P2.4): el MISMO criterio marca la orden que no llego al
// dueno y no marca la que si.
describe('P8.68 — el detector no es decorativo', () => {
    it('marca la incoherencia y no marca la coherente', () => {
        const original = FLU_CONFIG.voiceCommands.requireWakeAlways
        try {
            FLU_CONFIG.voiceCommands.requireWakeAlways = true
            expect(wakePolicyOffenders(WAKE_POLICY_ORDER.OFF, PHRASES.off[0])).toHaveLength(1)
            FLU_CONFIG.voiceCommands.requireWakeAlways = false
            expect(wakePolicyOffenders(WAKE_POLICY_ORDER.OFF, PHRASES.off[0])).toEqual([])
        } finally {
            FLU_CONFIG.voiceCommands.requireWakeAlways = original
        }
    })
})
