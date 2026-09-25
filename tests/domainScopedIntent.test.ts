import { describe, it, expect } from 'vitest'
import { resolveAgendaDomainIntent } from '../src/core/agenda/domainScopedIntent'
import { parseAgendaCommand } from '../src/core/agenda/agendaCommandParser'

describe('resolveAgendaDomainIntent - el dominio del LLM cubre el sustantivo ausente', () => {
    it('reminder con hora pero SIN sustantivo ni verbo usa la clasificacion del LLM', () => {
        const r = resolveAgendaDomainIntent('reminder', 'tomar el medicamento a las 12:00', {
            now: Date.UTC(2026, 0, 5, 9, 0, 0),
        })
        const action = r?.action as Record<string, unknown> | undefined
        expect(r?.matched).toBe(true)
        expect(r?.domain).toBe('agendaCommand')
        expect(action?.handled).toBe(true)
        expect(action?.action).toBe('agenda.create')
        expect(action?.kind).toBe('recordatorio')
        expect(typeof (action?.trigger as { at?: unknown } | undefined)?.at).toBe('number')
    })

    it('SIN hora el parser NO inventa instante: no hay match (no se crea)', () => {
        const r = resolveAgendaDomainIntent('reminder', 'tomar el medicamento', { now: Date.now() })
        expect(r).toBeNull()
    })

    it('sin la pista del LLM el mismo texto sigue sin matchear (camino determinista intacto)', () => {
        expect(parseAgendaCommand('tomar el medicamento a las 12:00').handled).toBe(false)
    })

    it('temporal NO se cablea: su tipo es ambiguo y no se adivina', () => {
        const r = resolveAgendaDomainIntent('temporal', 'tomar el medicamento a las 12:00', {
            now: Date.now(),
        })
        expect(r).toBeNull()
    })
})
