// ============================================================
// noteRescue.test.ts — GUARD (una nota determinista nunca se pierde)
// ------------------------------------------------------------
// Invariante: si el turno es una nota determinista y las acciones
// efectivas del turno NO incluían ninguna de dominio 'note', se
// agrega UNA acción de nota por el MISMO pipeline (árbitro). Si ya
// había nota (o el turno resuelve otro dominio), no se agrega nada:
// no hay ruta doble ni doble creación.
//
// Nace ROJO: `noteRescue.js` aún no existe.
// ============================================================
import { describe, it, expect } from 'vitest';
import { resolveNoteRescue } from '../src/voice/lib/noteRescue';

describe('resolveNoteRescue — garantía de nota sin ruta doble', () => {
    it('agrega la nota cuando ninguna acción efectiva la cubre', () => {
        const rescue = resolveNoteRescue({
            transcript: 'ok flu apunta comprar pan',
            resolvedDomains: [],
        });
        const action = rescue?.action as
            | { action?: string; data?: { label?: string } }
            | null
            | undefined;
        expect(rescue?.domain).toBe('note');
        expect(action?.action).toBe('notes.add');
        expect(String(action?.data?.label || '').toLowerCase()).toContain('pan');
    });

    it('no agrega nada si ya hay una acción de nota (no duplica)', () => {
        expect(
            resolveNoteRescue({ transcript: 'apunta comprar pan', resolvedDomains: ['note'] }),
        ).toBeNull();
    });

    it('no inventa nota para un recordatorio (el árbitro resuelve reminder)', () => {
        expect(
            resolveNoteRescue({
                transcript: 'recuérdame comprar pan a las 7',
                resolvedDomains: [],
            }),
        ).toBeNull();
    });

    it('devuelve null sin transcript', () => {
        expect(resolveNoteRescue({ transcript: '', resolvedDomains: [] })).toBeNull();
    });
});
