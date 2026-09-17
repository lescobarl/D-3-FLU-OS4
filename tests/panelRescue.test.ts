// ============================================================
// panelRescue.test.ts — GUARD: agenda+notas nunca se pierden y no hay doble
// ------------------------------------------------------------
// Invariante: si el turno resuelve agenda o nota por el árbitro determinista
// (MISMO pipeline que estructura todo el panel) y ese dominio no está entre
// las acciones efectivas del turno, se agrega UNA acción por el mismo
// despacho. Si ya está cubierto, o resuelve otro dominio, devuelve null:
// no hay ruta doble.
// ============================================================
import { describe, it, expect } from 'vitest';
import { resolvePanelRescue } from '../src/voice/lib/panelRescue';

describe('resolvePanelRescue — panel (agenda + notas) sin ruta doble', () => {
    it('agrega la NOTA cuando ninguna acción efectiva la cubre', () => {
        const rescue = resolvePanelRescue({ transcript: 'ok flu apunta comprar pan', resolvedDomains: [] });
        const action = rescue?.action as { action?: string; data?: { label?: string } } | null | undefined;
        expect(rescue?.domain).toBe('note');
        expect(action?.action).toBe('notes.add');
        expect(String(action?.data?.label || '').toLowerCase()).toContain('pan');
    });

    it('agrega la AGENDA cuando ninguna acción efectiva la cubre', () => {
        const rescue = resolvePanelRescue({
            transcript: 'recuérdame comprar pan a las 7',
            resolvedDomains: [],
        });
        expect(rescue?.domain).toBe('agendaCommand');
    });

    it('no agrega nada si ya hay una acción de nota (no duplica)', () => {
        expect(resolvePanelRescue({ transcript: 'apunta comprar pan', resolvedDomains: ['note'] })).toBeNull();
    });

    it('no agrega nada si ya hay una acción de agenda (no duplica)', () => {
        expect(
            resolvePanelRescue({ transcript: 'recuérdame comprar pan a las 7', resolvedDomains: ['agendaCommand'] }),
        ).toBeNull();
    });

    it('no inventa panel para otro dominio (compras)', () => {
        expect(
            resolvePanelRescue({ transcript: 'agrega papel a la lista de compras', resolvedDomains: [] }),
        ).toBeNull();
    });

    it('devuelve null sin transcript', () => {
        expect(resolvePanelRescue({ transcript: '', resolvedDomains: [] })).toBeNull();
    });
});
