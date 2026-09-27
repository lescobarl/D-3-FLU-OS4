// ============================================================
// speakerPassiveNoNameInheritance - Guard de diarizacion pasiva
// ------------------------------------------------------------
// Regla (fluConfig.voiceIdentity.capture.roomCapture.requireWakeWordForSpeakerName):
// SIN wake + comando, la etiqueta NO puede ser un nombre propio heredado por
// continuidad ("Luis"): el habla pasiva de la sala/TV se etiqueta generica
// (Hablante N). El nombre propio solo entra por wake ("ok flu soy Ana") o por
// diarizacion de AUDIO.
//
// El dueno unico de "resolver la etiqueta a partir del TEXTO + ultimo orador" es
// `activeListen.resolveSpeakerByText`, que consumen las filas pasivas/ambiente
// (emitConversationLog) del motor de voz. Antes devolvia `lastSpeaker` tal cual,
// asi que una sola fila mal etiquetada contagiaba TODAS las siguientes.
// ============================================================
import { describe, expect, it } from 'vitest';
import { resolveSpeakerByText } from '../src/voice/lib/activeListen.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const GENERIC = FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker;
const TV_PHRASE = 'estan dando una pelicula muy buena en la television';

describe('etiqueta por texto en modo pasivo: sin wake no se hereda el nombre propio', () => {
    it('una frase de TV no se etiqueta con el nombre propio del ultimo orador', () => {
        expect(resolveSpeakerByText(TV_PHRASE, 'Luis')).toBe(GENERIC);
    });

    it('el nombre propio solo entra por wake ("ok flu soy Ana")', () => {
        expect(resolveSpeakerByText('ok flu soy Ana', 'Luis')).toBe('Ana');
    });

    it('una etiqueta automatica previa se conserva (no es nombre propio)', () => {
        expect(resolveSpeakerByText(TV_PHRASE, 'Hablante 2')).toBe('Hablante 2');
    });

    it('sin ultimo orador cae al label configurado', () => {
        expect(resolveSpeakerByText(TV_PHRASE, '')).toBe(GENERIC);
    });
});
