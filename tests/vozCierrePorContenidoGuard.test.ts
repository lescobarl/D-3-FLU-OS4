// ============================================================
// vozCierrePorContenidoGuard — P9.75
// ------------------------------------------------------------
// MEDIDO (auditoria 2026-10-12, desk audit-hallazgos.test.ts): con el estado COHERENTE
// (silencio >= srGapCommitMs => el reloj de CONTENIDO tambien vencido) la rama de contenido de
// `evaluateSrGapSegmentCommit` devuelve flush=true y los portones finos posteriores
// (conversationStream.js:472-499) quedan INALCANZABLES. Lo que SI sigue vivo es el freno por
// texto EXACTO (:454-456, comprobado ANTES de la rama) y el arranque sin gap (:445-447).
// Este guard fija la CONDUCTA (funciones reales, no literales) y trae su discriminador:
// si alguien retira la rama de contenido, el primer caso cae (verificado revirtiendo
// conversationStream.js + fluTranscriptPause.js a e61e464~1: 1 failed).
// ============================================================
import { describe, expect, it } from 'vitest'
import { evaluateSrGapSegmentCommit } from '../src/voice/lib/conversationStream.js'

const NOW = 1_000_000
const VIEJO = NOW - 4000
const state = (over: Record<string, unknown> = {}) => ({
    openLine: 'hola mundo que tal hoy',
    pendingInterim: '',
    openLineStartedAtMs: VIEJO,
    openLineLastTouchMs: VIEJO,
    ...over,
})
const opts = (over: Record<string, unknown> = {}) => ({
    nowMs: NOW,
    sinceLastResultMs: 4000,
    lastCommitted: 'hola mundo que tal',
    lastCommitAtMs: 0,
    ...over,
})

describe('P9.75 - el cierre REAL por gap es el de CONTENIDO estancado', () => {
    it('extension corta (4 chars) + reloj de contenido vencido => VUELCA', () => {
        const r = evaluateSrGapSegmentCommit(state(), opts())
        console.log(`  flush=${r.flush} reason=${r.reason} capture="${r.capture}"`)
        expect(r.flush, 'la locucion estancada se vuelca (si no, el turno queda abierto)').toBe(true)
        expect(r.capture).toContain('hoy')
    })

    it('freno CONSERVADO: texto identico al ya commiteado NO vuelca (already-committed)', () => {
        const r = evaluateSrGapSegmentCommit(
            state({ openLine: 'hola mundo que tal' }),
            opts({ lastCommitted: 'hola mundo que tal' }),
        )
        console.log(`  flush=${r.flush} reason=${r.reason}`)
        expect(r.flush).toBe(false)
        expect(r.reason).toBe('already-committed')
    })

    it('PRUEBA DE DETECTOR (el detector no es decorativo): sin gap no se cierra', () => {
        const conGap = evaluateSrGapSegmentCommit(state(), opts())
        const sinGap = evaluateSrGapSegmentCommit(
            state({ openLineStartedAtMs: NOW, openLineLastTouchMs: NOW }),
            opts({ sinceLastResultMs: 0, lastCommitAtMs: 0 }),
        )
        console.log(`  conGap=${conGap.flush}/${conGap.reason} · sinGap=${sinGap.flush}/${sinGap.reason}`)
        expect(conGap.flush).toBe(true)
        expect(sinGap.flush, 'sin gap el turno NO se cierra').toBe(false)
    })
})
