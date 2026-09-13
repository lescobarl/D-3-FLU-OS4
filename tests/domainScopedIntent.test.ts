// ============================================================
// domainScopedIntent.test.ts — Guard de despacho por dominio LLM
// ------------------------------------------------------------
// Invariantes:
//  1. `parseReminderIntent` con `assumedDomain:'reminder'` produce la
//     intención estructurada AUNQUE el texto no traiga el trigger verbal
//     ("recuérdame"). Es lo que evita "respondió bien pero no hizo nada".
//  2. La ruta con trigger verbal sigue funcionando (regresión).
//  3. `parseNoteIntentText` reconoce "incluye ... en la nota del súper ..."
//     como nota Super (destino "nota", verbo "incluye").
//  4. Regresiones de notas Super existentes.
// ============================================================
import { describe, expect, it } from 'vitest';
import { parseReminderIntent } from '../src/core/reminders/reminderIntentParser';
import { parseNoteIntentText } from '../src/voice/lib/noteIntentParser';

const NOW = 1_700_000_000_000;

describe('despacho por dominio (accion.dominio del LLM)', () => {
    it('reminder sin trigger verbal: assumedDomain produce reminder.add', () => {
        const intent = parseReminderIntent('tomar el medicamento a las 12:00', {
            now: () => NOW,
            assumedDomain: 'reminder',
            language: 'es',
        });
        expect(intent.handled).toBe(true);
        expect(intent.action).toBe('reminder.add');
        expect(intent.data?.text || '').toContain('tomar el medicamento');
        expect(typeof intent.data?.dueAt).toBe('number');
    });

    it('reminder con trigger verbal sigue funcionando (regresión)', () => {
        const intent = parseReminderIntent('recuérdame tomar el medicamento a las 12:00', {
            now: () => NOW,
            language: 'es',
        });
        expect(intent.handled).toBe(true);
        expect(intent.action).toBe('reminder.add');
        expect(typeof intent.data?.dueAt).toBe('number');
    });
});

describe('nota del súper (destino "nota")', () => {
    it('reconoce "incluye ... en la nota del súper que también traiga X"', () => {
        const parsed = parseNoteIntentText(
            'incluye en la nota del súper que también traiga una computadora',
        );
        expect(parsed?.label).toBe('Super: una computadora');
    });

    it('regresión: "apunta en la lista super comprar conejos"', () => {
        const parsed = parseNoteIntentText('apunta en la lista super comprar conejos');
        expect(parsed?.label).toBe('Super: conejos');
    });

    it('regresión: "agrega papel de baño a la lista del super"', () => {
        const parsed = parseNoteIntentText('agrega papel de baño a la lista del super');
        expect(parsed?.label).toBe('Super: papel de bano');
    });
});
