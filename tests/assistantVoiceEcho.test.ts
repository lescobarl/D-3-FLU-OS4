import { describe, expect, it } from 'vitest';
import { deriveAssistantLastText } from '../src/voice/lib/conversationDialogue.js';
import { isAssistantVoiceEcho } from '../src/voice/lib/conversationStream.js';

const FLU_TTS = 'Claro que sí, ¡vamos a jugar lotería! Prepárense para la diversión.';

describe('eco de la propia voz de FLU (no debe ser un turno de persona)', () => {
    it('la última frase de FLU se deriva del store', () => {
        expect(
            deriveAssistantLastText([
                { role: 'user', text: 'pon un recordatorio de la medicina' },
                { role: 'flu', text: FLU_TTS },
            ]),
        ).toBe(FLU_TTS);
    });

    it('sin turnos de FLU no hay texto que derive', () => {
        expect(deriveAssistantLastText([{ role: 'user', text: 'hola' }])).toBe('');
    });

    it('el TTS re-capturado por el micrófono se reconoce como eco', () => {
        expect(
            isAssistantVoiceEcho('vamos a jugar lotería prepárense para la diversión', FLU_TTS),
        ).toBe(true);
    });

    it('una frase del usuario ajena al TTS no se descarta', () => {
        expect(isAssistantVoiceEcho('agrega cloro a la nota del super', FLU_TTS)).toBe(false);
    });

    it('una frase corta no se descarta aunque aparezca en el TTS', () => {
        expect(isAssistantVoiceEcho('sí', 'Claro que sí')).toBe(false);
    });
});
