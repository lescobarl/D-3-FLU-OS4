// ============================================================
// wakeWordDisplay — stripWakeWordForDisplay (audioMath)
// ------------------------------------------------------------
// La transcripción visible en la UI debe mostrar SOLO lo que
// viene después del wake word (p. ej. "Flu, ..."), no el prefijo
// de activación. Este helper se aplica en los puntos de display
// (VoiceControls y conversation-live-phrase).
// ============================================================
import { describe, expect, it } from 'vitest';
import { stripWakeWordForDisplay } from '../src/voice/lib/audioMath';

const WAKE_WORDS = ['flu', 'hey flu', 'oye flu'];

describe('stripWakeWordForDisplay', () => {
    it('quita el wake word al inicio y muestra solo lo que sigue', () => {
        expect(stripWakeWordForDisplay('Flu agrega leche a la lista', WAKE_WORDS)).toBe('agrega leche a la lista');
    });

    it('quita un wake word compuesto al inicio', () => {
        expect(stripWakeWordForDisplay('Hey flu, crea una nota para el super', WAKE_WORDS)).toBe('crea una nota para el super');
    });

    it('quita el wake word en medio y conserva lo que va después', () => {
        expect(stripWakeWordForDisplay('oye flu recuérdame comprar pan', WAKE_WORDS)).toBe('recuérdame comprar pan');
    });

    it('deja intacto el texto sin wake word', () => {
        const text = 'agrega leche a la lista';
        expect(stripWakeWordForDisplay(text, WAKE_WORDS)).toBe(text);
    });

    it('devuelve texto vacío si la entrada está vacía', () => {
        expect(stripWakeWordForDisplay('', WAKE_WORDS)).toBe('');
        expect(stripWakeWordForDisplay('   ', WAKE_WORDS)).toBe('   ');
    });

    it('no rompe con entrada no string', () => {
        expect(stripWakeWordForDisplay(undefined as unknown as string, WAKE_WORDS)).toBe('');
        expect(stripWakeWordForDisplay(null as unknown as string, WAKE_WORDS)).toBe('');
    });
});
