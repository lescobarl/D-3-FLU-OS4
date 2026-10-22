// @vitest-environment node
// ============================================================
// vozEcoIdentidadGuard - el eco del TTS no registra identidades
// ------------------------------------------------------------
// Defecto medido 2026-10-21: FLU dijo "Registrado Luis"; el ASR oyo la
// cola y el sistema hizo identity-register con "Luis Registrado" y con un
// vector de eco, escribiendo un ancla nueva en la base. Aqui se fija:
//  - el nombre incluye la confirmacion -> se corta a "Luis";
//  - una identidad no se registra dentro de la ventana de eco del TTS.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { detectIntroducedName, detectWakeIntroducedName } from '../src/voice/lib/audioMath.js'
import { useIntegrationStore } from '../src/store/integrationStore'

const estado = vi.hoisted(() => ({ ttsAt: 0 }))

vi.mock('../src/voice/lib/fluSpeech.js', () => ({
    getLastCompletedSpeechAt: () => estado.ttsAt,
    isSpeechSynthesisSpeaking: () => false,
}))
vi.mock('../src/voice/lib/activeListen.js', () => ({
    committedEchoStreakWindowMs: () => 1200,
}))

import { registerSpeakerIdentity } from '../src/voice/lib/speakerIdentityRegister'

const vector = (n: number) => {
    const v = new Array(16).fill(0)
    v[n % 16] = 1
    return v
}

beforeEach(() => {
    estado.ttsAt = 0
    useIntegrationStore.setState({ conversationHistory: [], conversationEpoch: 0, speakerHighWater: 0 })
})

describe('eco del TTS en el nombre', () => {
    it('"soy Luis registrado" se corta a Luis', () => {
        expect(detectIntroducedName('soy Luis registrado')).toBe('Luis')
        expect(detectWakeIntroducedName('okay flu soy Luis registrado', ['okay flu'])).toBe('Luis')
    })

    it('no registra identidad dentro de la ventana de eco', () => {
        estado.ttsAt = Date.now() - 100
        const registerParticipant = vi.fn()
        const result = registerSpeakerIdentity({
            name: 'Luis',
            clusters: [],
            previousLabel: 'Hablante 1',
            signatureVector: vector(1),
            refs: { registerParticipant },
        })
        expect(result.registered).toBe(false)
        expect(registerParticipant).not.toHaveBeenCalled()
    })

    it('si registra fuera de la ventana de eco', () => {
        estado.ttsAt = Date.now() - 5000
        const registerParticipant = vi.fn()
        const result = registerSpeakerIdentity({
            name: 'Luis',
            clusters: [],
            previousLabel: 'Hablante 1',
            signatureVector: vector(1),
            refs: { registerParticipant },
        })
        expect(result.registered).toBe(true)
        expect(registerParticipant).toHaveBeenCalledTimes(1)
    })
})
