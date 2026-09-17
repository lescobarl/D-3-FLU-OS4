// ============================================================
// voiceTurnRefireDedup — el ÚNICO escritor no re-commitea el mismo turno
// cerrado cuando no llegó habla nueva (doble `onend` / doble dispatch).
// ------------------------------------------------------------
// Discriminador determinista: si hubo un resultado de reconocimiento nuevo
// DESPUÉS del último commit, es una fila nueva (pausa ⇒ turno nuevo); si no,
// es la misma línea cerrada re-emitida ⇒ se descarta.
// ============================================================
import { describe, it, expect } from 'vitest';
import { isDuplicateTurnCommit } from '../src/voice/lib/turnStream.js';

describe('isDuplicateTurnCommit — re-emisión del mismo turno', () => {
    it('misma frase sin habla nueva desde el commit → duplicado (se descarta)', () => {
        expect(
            isDuplicateTurnCommit('okay flow crea una cita', {
                lastEmitted: 'okay flow crea una cita',
                lastCommitted: 'okay flow crea una cita',
                lastResultAt: 1000,
                lastCommitAt: 1200,
            }),
        ).toBe(true);
    });

    it('misma frase CON habla nueva posterior al commit → NO es duplicado (pausa ⇒ fila nueva)', () => {
        expect(
            isDuplicateTurnCommit('okay flow crea una cita', {
                lastEmitted: 'okay flow crea una cita',
                lastCommitted: 'okay flow crea una cita',
                lastResultAt: 2000,
                lastCommitAt: 1200,
            }),
        ).toBe(false);
    });

    it('frase distinta → NO es duplicado', () => {
        expect(
            isDuplicateTurnCommit('otra frase distinta', {
                lastEmitted: 'okay flow crea una cita',
                lastCommitted: 'okay flow crea una cita',
                lastResultAt: 1000,
                lastCommitAt: 1200,
            }),
        ).toBe(false);
    });

    it('extensión con cola numérica NO es duplicado (contenido real)', () => {
        expect(
            isDuplicateTurnCommit('intervención 2', {
                lastEmitted: 'intervención',
                lastCommitted: 'intervención',
                lastResultAt: 1000,
                lastCommitAt: 1200,
            }),
        ).toBe(false);
    });

    it('sin commit previo → NO es duplicado', () => {
        expect(
            isDuplicateTurnCommit('hola', {
                lastEmitted: '',
                lastCommitted: '',
                lastResultAt: 0,
                lastCommitAt: 0,
            }),
        ).toBe(false);
    });
});
