// @vitest-environment node
// ============================================================
// registerParticipantVoiceEcoGuard - no re-anclar una identidad con un vector ajeno
// ------------------------------------------------------------
// El eco del TTS reescribia el ancla verificada de Luis con la voz del eco.
// La base solo se re-ancla si el vector nuevo es de la MISMA voz.
// ============================================================
import { describe, expect, it, vi } from 'vitest'
import { registerParticipantVoice } from '../src/app/registerParticipantVoice'

const V = (i: number) => {
    const v = new Array(16).fill(0)
    v[i] = 1
    return v
}

function service(existingVector: number[]) {
    return {
        register: vi.fn(async () => ({ ok: false, reason: 'duplicate' })),
        list: vi.fn(async () => [
            { id: 'p-luis', name: 'Luis', voiceVector: existingVector, voiceAnchorVerified: true },
        ]),
        upsert: vi.fn(async () => ({ ok: true })),
    }
}

describe('registerParticipantVoice: guardia anti-eco', () => {
    it('rechaza un vector de otra voz y no pisa el ancla verificada', async () => {
        const fake = service(V(0))
        const ok = await registerParticipantVoice(fake as never, 'Luis', V(1))
        expect(ok).toBe(false)
        expect(fake.upsert).not.toHaveBeenCalled()
    })

    it('permite re-anclar con un vector de la misma voz', async () => {
        const fake = service(V(0))
        const ok = await registerParticipantVoice(fake as never, 'Luis', V(0))
        expect(ok).toBe(true)
        expect(fake.upsert).toHaveBeenCalledTimes(1)
    })
})
