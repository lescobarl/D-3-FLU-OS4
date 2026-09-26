// ============================================================
// noteSuperDestFirst.test.ts — Guard de COMPORTAMIENTO (caso 11)
// ------------------------------------------------------------
// "en la nota del súper incluye X" (destino PRIMERO, verbo después)
// ⇒ 1 nota 'Super' cuyo CONTENIDO suma X (y 0 llamadas a IA).
// El parser antes solo cubría el verbo PRIMERO ("incluye ... en la
// nota del súper ..."), así que la frase real caía a Gemini y alucinaba.
//
// Forma canónica de la lista del súper (superNoteTarget): la nota se llama
// 'Super' y los ÍTEMS viven en el body, uno por línea. Antes el ítem se emitía
// dentro de la ETIQUETA ("Super: cloro"), así que el nombre de la nota se comía
// la lista: el usuario veía "Super: el cloro" como título.
// ============================================================
import { describe, expect, it } from 'vitest';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';
import { parseNoteIntentText } from '../src/voice/lib/noteIntentParser';

type NoteIntent = { label?: string; body?: string } | null;

/** El ítem puede venir en el cuerpo (forma canónica); aquí se lee de dónde sea. */
const itemOf = (parsed: NoteIntent): string => (parsed?.body || '').replace(/\n/g, ', ').trim();

describe('caso 11 — "en la {destino} {verbo} {ítem}" (destino primero)', () => {
    it('reconoce "en la nota del súper incluye cloro" ⇒ nota Super con cloro dentro', () => {
        const parsed = parseNoteIntentText('en la nota del súper incluye cloro');
        expect(parsed?.label).toBe('Super');
        expect(itemOf(parsed)).toBe('cloro');
    });

    it('el ítem NUNCA va en el nombre de la nota', () => {
        expect(parseNoteIntentText('en la nota del súper incluye cloro')?.label).not.toContain('cloro');
        expect(parseNoteIntentText('agrega cloro a la nota del super')?.label).not.toContain('cloro');
    });

    it('reconoce variantes de verbo y destino (agrega/suma, compras/mercado)', () => {
        // El parser trabaja sobre el texto sin acentos (normalización de ASR),
        // así que el ítem queda "jabon": el CONTENIDO se guarda tal cual se dictó.
        const jabon = parseNoteIntentText('en la nota del super agrega jabón');
        expect([jabon?.label, itemOf(jabon)]).toEqual(['Super', 'jabon']);
        const leche = parseNoteIntentText('a la nota de compras suma leche');
        expect([leche?.label, itemOf(leche)]).toEqual(['Super', 'leche']);
    });

    it('limpia conectores del ítem ("que también traiga …")', () => {
        expect(itemOf(parseNoteIntentText('en la nota del súper incluye que también traiga cloro'))).toBe(
            'cloro',
        );
    });

    it('el Árbitro lo resuelve como notes.add determinista (0 IA)', () => {
        const result = resolveDeterministicCommand('en la nota del súper incluye cloro', {
            language: 'es',
        });
        expect(result.matched).toBe(true);
        expect(result.domain).toBe('note');
        expect(result.channel).toBe('flu');
        const action = result.action as {
            handled?: boolean;
            action?: string;
            data?: { label?: string; body?: string };
        };
        expect(action.handled).toBe(true);
        expect(action.action).toBe('notes.add');
        expect(action.data?.label).toBe('Super');
        expect(action.data?.body).toBe('cloro');
    });

    it('paridad con el orden verbo-primero: mismo destino y mismo ítem', () => {
        const destFirst = parseNoteIntentText('en la nota del súper incluye cloro');
        const verbFirst = parseNoteIntentText('incluye en la nota del súper cloro');
        expect(destFirst?.label).toBe(verbFirst?.label);
        expect(itemOf(destFirst)).toBe(itemOf(verbFirst));
    });
});

// Mismo defecto que el caso 11, en el orden ÍTEM PRIMERO + destino "nota":
// "agrega cloro a la nota del super". El destino solo aceptaba "lista", así
// que la frase real no matcheaba, caía a la IA y la IA confirmaba la nota sin
// crearla (éxito falso).
describe('ítem ANTES con destino "nota" ("agrega cloro a la nota del super")', () => {
    it('reconoce el ítem antes del destino "nota"', () => {
        const parsed = parseNoteIntentText('agrega cloro a la nota del super');
        expect([parsed?.label, itemOf(parsed)]).toEqual(['Super', 'cloro']);
    });

    it('vale para otras variantes de verbo y destino', () => {
        const jabon = parseNoteIntentText('añade jabón a la nota del super');
        expect([jabon?.label, itemOf(jabon)]).toEqual(['Super', 'jabon']);
        const leche = parseNoteIntentText('pon leche en la nota de compras');
        expect([leche?.label, itemOf(leche)]).toEqual(['Super', 'leche']);
    });

    it('el árbitro lo resuelve como notes.add determinista (0 IA)', () => {
        const result = resolveDeterministicCommand('agrega cloro a la nota del super', {
            language: 'es',
        });
        expect(result.matched).toBe(true);
        expect(result.domain).toBe('note');
        const action = result.action as { action?: string; data?: { label?: string; body?: string } };
        expect(action.action).toBe('notes.add');
        expect(action.data?.label).toBe('Super');
        expect(action.data?.body).toBe('cloro');
    });
});
