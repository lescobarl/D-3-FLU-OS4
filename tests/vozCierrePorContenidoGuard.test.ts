// ============================================================
// vozCierrePorContenidoGuard — P9.75, releido con el mandato P11.12
// ------------------------------------------------------------
// P9.75 nacio cuando el cierre tambien disparaba por CONTENIDO estancado. El mandato del
// dueno 2026-10-13 (P11.12) RETIRA esa rama: la ultima frase se vacia SOLO por silencio (o
// cambio de hablante). Los casos de este guard SIGUEN VIVOS con la regla nueva —todos
// alcanzan silencio real (>= srGapCommitMs)— y fijan sobre las funciones REALES:
//   (a) silencio + cola corta (4 chars) => VUELCA la locucion completa;
//   (b) freno CONSERVADO: texto EXACTO ya commiteado => no vuelca;
//   (c) sin gap => no vuelca.
// Discriminador: si el cierre deja de mirar el reloj de SILENCIO (o el freno exacto
// desaparece), los casos caen.
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

describe('P9.75/P11.12 - el cierre por gap: silencio vuelca la cola y el freno exacto se conserva', () => {
    it('silencio real + cola corta (4 chars) => VUELCA la locucion completa', () => {
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
