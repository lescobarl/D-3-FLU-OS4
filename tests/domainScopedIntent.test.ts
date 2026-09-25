import { describe, it, expect } from 'vitest'
import { resolveAgendaDomainIntent, askMissingInstant } from '../src/core/agenda/domainScopedIntent'
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

    it('SIN hora el parser NO inventa instante, pero PROPAGA la pista para preguntar (P7.30b)', () => {
        const r = resolveAgendaDomainIntent('reminder', 'tomar el medicamento', { now: Date.now() })
        // Antes era null: el turno se caia sin decir nada. Ahora se pregunta la
        // hora (nada se crea: el action NO lleva trigger).
        expect(r?.matched).toBe(true)
        expect(r?.needsInstant).toBe(true)
        const action = r?.action as Record<string, unknown> | undefined
        expect(action?.action).toBe('agenda.create')
        expect(action?.kind).toBe('recordatorio')
        expect(action?.trigger).toBeUndefined()
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

describe('askMissingInstant - preguntar la hora en vez de descartar el turno (P7.30b)', () => {
    it('devuelve una pregunta en el idioma pedido (y no crea nada)', () => {
        expect(askMissingInstant('es')).toMatch(/\?/)
        expect(askMissingInstant('en')).toMatch(/\?/)
        expect(askMissingInstant('es')).not.toBe(askMissingInstant('en'))
    })

    it('el parser conserva kind+label aunque no haya instante (la pista no se pierde)', () => {
        const cmd = parseAgendaCommand('recuérdame comprar el pan', { kindHint: 'recordatorio' })
        expect(cmd.handled).toBe(false)
        expect(cmd.action).toBe('agenda.create')
        expect(cmd.kind).toBe('recordatorio')
        expect(String(cmd.label || '')).toContain('pan')
    })

    it('recuérdame sin hora llega al manejador con la etiqueta del texto', () => {
        const r = resolveAgendaDomainIntent('reminder', 'recuérdame comprar el pan')
        const action = r?.action as Record<string, unknown> | undefined
        expect(r?.needsInstant).toBe(true)
        expect(String(action?.label || '')).toContain('pan')
    })

    it('la frase de un dominio NO agenda sigue sin matchear', () => {
        expect(resolveAgendaDomainIntent('note', 'recuérdame comprar el pan')).toBeNull()
    })
})

