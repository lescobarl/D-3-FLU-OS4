// ============================================================
// resolvedActionIdentity — dedup por ACCIÓN resuelta, no por texto
// ------------------------------------------------------------
// Bug real: turno + fragmento del LLM resolvían al MISMO evento con textos
// distintos → se despachaba dos veces → el segundo respondía "Ese evento ya
// existe." Invariante: misma acción ⇒ misma identidad (se despacha una vez);
// disparo distinto ⇒ identidad distinta (se conservan ambos).
// ============================================================
import { describe, it, expect } from 'vitest';
import { resolvedActionIdentity } from '../src/voice/lib/resolvedActionIdentity';

const agenda = (label: string, at: number) => ({
    domain: 'agendaCommand',
    action: { action: 'agenda.create', kind: 'junta', label, trigger: { type: 'absolute', at } },
});

const nota = (label: string) => ({ domain: 'note', action: { action: 'notes.add', data: { label } } });

describe('resolvedActionIdentity', () => {
    it('agenda: mismo evento desde textos distintos → MISMA identidad', () => {
        expect(resolvedActionIdentity(agenda('Junta de comité', 1000))).toBe(
            resolvedActionIdentity(agenda('junta de  comite', 1000)),
        );
    });

    it('agenda: mismo label con OTRO disparo → identidad distinta', () => {
        expect(resolvedActionIdentity(agenda('Junta', 1000))).not.toBe(resolvedActionIdentity(agenda('Junta', 2000)));
    });

    it('nota: misma etiqueta desde textos distintos → MISMA identidad', () => {
        expect(resolvedActionIdentity(nota('Super'))).toBe(resolvedActionIdentity(nota('  super ')));
    });

    it('dominios/acciones distintas no colisionan', () => {
        expect(resolvedActionIdentity(nota('super'))).not.toBe(resolvedActionIdentity(agenda('super', 1000)));
    });
});
