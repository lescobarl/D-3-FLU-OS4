// @vitest-environment jsdom
// ============================================================
// noteItemRemovalLiteral - el escenario REAL reportado, al pie de la letra:
//
//   "Okay Flow borra de la nota del s\u00faper el cloro"      (con la loter\u00eda activa)
//   "Okay Flow borra de las notas del s\u00faper el cloro"
//
// Defecto medido: el \u00e1rbitro resolv\u00eda la frase como JUGADA (el catch-all
// "cualquier otra cosa -> turn" de gameCommands), as\u00ed que FLU segu\u00eda el juego
// ("La carta es: El mel\u00f3n") y NUNCA quitaba el ítem. Adem\u00e1s la capacidad de
// quitar un ítem de una nota NO exist\u00eda en ninguna capa (solo alta y borrado
// de la nota completa).
//
// Este test usa las frases LITERALES del log, con wake word y acentos, no
// variantes curadas.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    isNoteCommand,
    parseNoteItemRemoveIntentText,
} from '../src/voice/lib/noteIntentParser';
import { resolveGameCommandFromText } from '../src/voice/lib/gameCommands';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';
import { removeSuperNoteItems } from '../src/core/notes/superNoteTarget';
import { removeSuperNoteItem } from '../src/app/superNoteActions';
import { setActiveGameSession, clearActiveGameSession } from '../src/core/games/gameSessionStore';

const SUPER_ACCENT = 's\u00faper';

// Frases LITERALES del log del due\u00f1o (20:35:57 - 20:36:15).
const LITERAL_ITEM_REMOVALS = [
    `Okay Flow borra de la nota del ${SUPER_ACCENT} el cloro`,
    `Okay Flow borra de las notas del ${SUPER_ACCENT} el cloro`,
    `borra de la nota del ${SUPER_ACCENT} el cloro`,
];

const LOTERIA_SESSION = {
    id: 'loteria',
    state: { order: [0, 1, 2], cursor: 0, winner: null, phase: 'announce' },
    score: 0,
    round: 1,
};

beforeEach(() => setActiveGameSession(LOTERIA_SESSION as never));
afterEach(() => clearActiveGameSession());

describe('parseNoteItemRemoveIntentText - entiende la orden, con wake y acentos', () => {
    for (const frase of LITERAL_ITEM_REMOVALS) {
        it(`"${frase}"`, () => {
            const parsed = parseNoteItemRemoveIntentText(frase);
            expect(parsed).toMatchObject({ label: 'Super', item: 'cloro' });
        });
    }

    it('tambi\u00e9n el orden ítem-primero', () => {
        expect(parseNoteItemRemoveIntentText(`quita el cloro de la lista del ${SUPER_ACCENT}`)).toMatchObject({
            label: 'Super',
            item: 'cloro',
        });
    });

    it('NO secuestra el borrado de la nota completa', () => {
        expect(parseNoteItemRemoveIntentText(`borra la nota del ${SUPER_ACCENT}`)).toBeNull();
        expect(parseNoteItemRemoveIntentText('borra todas las notas')).toBeNull();
    });
});

describe('con la loter\u00eda activa, la orden NO se convierte en jugada', () => {
    for (const frase of LITERAL_ITEM_REMOVALS) {
        it(`"${frase}" -> note / notes.removeItem (no game)`, () => {
            // 1) El juego NO la reclama como turno (antes: {action:'turn'} -> cantaba carta).
            expect(resolveGameCommandFromText(frase)).toBeNull();
            // 2) El \u00e1rbitro la resuelve a su dominio real con la acci\u00f3n precisa.
            const arb = resolveDeterministicCommand(frase, { language: 'es' });
            expect(arb.matched).toBe(true);
            expect(arb.domain).toBe('note');
            expect(arb.action).toMatchObject({
                action: 'notes.removeItem',
                data: { label: 'Super', item: 'cloro' },
            });
        });
    }

    it('isNoteCommand reconoce la orden (fuente del passthrough)', () => {
        expect(isNoteCommand(LITERAL_ITEM_REMOVALS[0])).toBe(true);
    });

    it('el juego sigue vivo: "siguiente" y una respuesta abierta son turno', () => {
        expect(resolveGameCommandFromText('siguiente')).toMatchObject({ action: 'turn' });
        expect(resolveGameCommandFromText('el sol')).toMatchObject({ action: 'turn' });
    });
});

describe('la escritura quita SOLO el ítem, no la nota', () => {
    it('removeSuperNoteItems quita la l\u00ednea pedida y conserva el resto', () => {
        const body = 'cloro\npan\nfocos\ninsecticida';
        expect(removeSuperNoteItems(body, ['el cloro'])).toBe('pan\nfocos\ninsecticida');
        expect(removeSuperNoteItems(body, ['cloro'])).toBe('pan\nfocos\ninsecticida');
    });

    it('es tolerante a acentos y may\u00fasculas', () => {
        expect(removeSuperNoteItems('Jab\u00f3n\nCloro', ['cloro'])).toBe('Jab\u00f3n');
    });

    it('removeSuperNoteItem persiste el body sin el ítem y reporta removed:true', async () => {
        const store = {
            add: vi.fn().mockResolvedValue({ ok: true }),
            rename: vi.fn().mockResolvedValue({}),
            setBody: vi.fn().mockResolvedValue({}),
            softRemove: vi.fn().mockResolvedValue({}),
        };
        const rows = [{ id: 'n1', label: 'Super', body: 'cloro\npan\nfocos' }];

        const result = await removeSuperNoteItem(store, rows, 'cloro');

        expect(result).toMatchObject({ ok: true, removed: true, body: 'pan\nfocos' });
        expect(store.setBody).toHaveBeenCalledWith('n1', 'pan\nfocos');
    });

    it('si el \u00edtem no est\u00e1, NO toca la nota (removed:false, sin escritura)', async () => {
        const store = {
            add: vi.fn().mockResolvedValue({ ok: true }),
            rename: vi.fn().mockResolvedValue({}),
            setBody: vi.fn().mockResolvedValue({}),
            softRemove: vi.fn().mockResolvedValue({}),
        };
        const rows = [{ id: 'n1', label: 'Super', body: 'pan\nfocos' }];

        const result = await removeSuperNoteItem(store, rows, 'cloro');

        expect(result).toMatchObject({ ok: true, removed: false });
        expect(store.setBody).not.toHaveBeenCalled();
    });
});
