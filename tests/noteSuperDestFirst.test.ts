// ============================================================
// noteSuperDestFirst.test.ts — Guard de COMPORTAMIENTO (caso 11)
// ------------------------------------------------------------
// "en la nota del súper incluye X" (destino PRIMERO, verbo después)
// ⇒ 1 nota Super renombrada con X (append) y 0 llamadas a IA.
// El parser antes solo cubría el verbo PRIMERO ("incluye ... en la
// nota del súper ..."), así que la frase real caía a Gemini y alucinaba.
// ============================================================
import { describe, expect, it } from 'vitest';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';
import { parseNoteIntentText } from '../src/voice/lib/noteIntentParser';

describe('caso 11 — "en la {destino} {verbo} {ítem}" (destino primero)', () => {
  it('reconoce "en la nota del súper incluye cloro" → Super: cloro', () => {
    expect(parseNoteIntentText('en la nota del súper incluye cloro')).toEqual({
      label: 'Super: cloro',
    });
  });

  it('reconoce variantes de verbo y destino (agrega/suma, compras/mercado)', () => {
    expect(parseNoteIntentText('en la nota del super agrega jabón')?.label).toBe('Super: jabon');
    expect(parseNoteIntentText('a la nota de compras suma leche')?.label).toBe('Super: leche');
  });

  it('limpia conectores del ítem ("que también traiga …")', () => {
    expect(
      parseNoteIntentText('en la nota del súper incluye que también traiga cloro')?.label,
    ).toBe('Super: cloro');
  });

  it('el árbitro lo resuelve como notes.add determinista (0 IA)', () => {
    const result = resolveDeterministicCommand('en la nota del súper incluye cloro', {
      language: 'es',
    });
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('note');
    expect(result.channel).toBe('flu');
    const action = result.action as { handled?: boolean; action?: string; data?: { label?: string } };
    expect(action.handled).toBe(true);
    expect(action.action).toBe('notes.add');
    expect(action.data?.label).toBe('Super: cloro');
  });

  it('paridad con el orden verbo-primero: misma etiqueta canónica', () => {
    // El append vive en el handler de App.tsx (mismo label "Super: X" para
    // ambos órdenes), por lo que el flujo produce UNA nota renombrada.
    const destFirst = parseNoteIntentText('en la nota del súper incluye cloro')?.label;
    const verbFirst = parseNoteIntentText('incluye en la nota del súper cloro')?.label;
    expect(destFirst).toBe('Super: cloro');
    expect(destFirst).toBe(verbFirst);
  });
});
