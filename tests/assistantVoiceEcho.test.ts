// Corte 2026-10-26: `isAssistantVoiceEcho` (conversationStream.js, isla de la
// tuberia retirada) se sustituye por el dueno vivo del detector de eco:
// `esEcoDeTts` (src/voice/conversation/eco.ts). `deriveAssistantLastText`
// (conversationDialogue.js) sigue vivo y se conserva tal cual.
import { describe, expect, it } from 'vitest';
import { deriveAssistantLastText } from '../src/voice/lib/conversationDialogue.js';
import { esEcoDeTts } from '../src/voice/conversation/eco.ts';
import { VOICE_DIARIZATION_DEFAULTS } from '../src/core/config/sharedConfig';

/** Mismo valor que cablea el puerto de config (adapters.ts): assistantEchoMinWords + 1. */
const MIN_PALABRAS_COLA = VOICE_DIARIZATION_DEFAULTS.assistantEchoMinWords + 1;

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
            esEcoDeTts('vamos a jugar lotería prepárense para la diversión', FLU_TTS, MIN_PALABRAS_COLA),
        ).toBe(true);
    });

    it('una frase del usuario ajena al TTS no se descarta', () => {
        expect(esEcoDeTts('agrega cloro a la nota del super', FLU_TTS, MIN_PALABRAS_COLA)).toBe(false);
    });

    it('una frase corta no se descarta aunque aparezca en el TTS (no es la cola)', () => {
        // El dueño vivo declara eco por cola exacta o por cola que abre el fragmento
        // (minimo 4 palabras); repetir una palabra suelta del medio NO es eco.
        expect(esEcoDeTts('sí', 'Claro que sí, vamos a jugar', MIN_PALABRAS_COLA)).toBe(false);
    });

    it("un fragmento CORTO dentro de una respuesta LARGA de FLU no se descarta", () => {
        // Caso reportado: el usuario retoma palabras de lo que acaba de decir FLU
        // ("...poner esto en orbita...") y su turno se perdia (solo se veia en la
        // ultima frase). La corrida contigua existe, pero NO es la cola: no es eco.
        const fluLargo =
            'Entonces si quieres poner esto en orbita y luego tienes que llevar el uno por ciento de la masa y vivir dentro de una cueva en otro planeta';
        expect(esEcoDeTts('si quieres poner esto en orbita', fluLargo, MIN_PALABRAS_COLA)).toBe(false);
    });

    it("la respuesta COMPLETA re-capturada si es eco (protege el caso original)", () => {
        const fluLargo =
            'Entonces si tu quieres poner esto en orbita y luego tienes que llevar el uno por ciento de la masa';
        expect(esEcoDeTts(fluLargo, fluLargo, MIN_PALABRAS_COLA)).toBe(true);
    });
});

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
    it('marca el eco re-capturado y NO una frase ajena al TTS', () => {
        expect(esEcoDeTts(FLU_TTS, FLU_TTS, MIN_PALABRAS_COLA)).toBe(true);
        expect(esEcoDeTts('compra pan y leche en el super', FLU_TTS, MIN_PALABRAS_COLA)).toBe(false);
    });
});
