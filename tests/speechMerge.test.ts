// ============================================================
// speechMerge — transcripción 100% sin pérdidas (colapsos de
// eco ASR, stutter, prefijos huérfanos, filas cortas tras pausa).
// Fixtures trazados 1:1 contra src/voice/lib/speechMerge.js.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
    collapseRepeatedSpeech,
    collapseMisorderedMicMerge,
    collapseEchoPhrase,
    collapseAsrStutter,
    normalizeMicText,
    mergeMicChunks,
    pickBestMicInterim,
    mergeSpeechText,
    shouldPreferShortFinalRow,
    wouldShrinkLog,
    micPublishedParityOk,
    hasSpeechAnchor,
} from '../src/voice/lib/speechMerge.js';
import { collectRecognitionResultChunks } from '../src/voice/lib/transcriptIngress.js';

describe('speechMerge — collapseRepeatedSpeech', () => {
    it('colapsa bloque contiguo repetido', () => {
        expect(collapseRepeatedSpeech('a b a b c')).toBe('a b c');
    });

    it('texto corto sin repetición se conserva', () => {
        expect(collapseRepeatedSpeech('hola como estas')).toBe('hola como estas');
    });
});

describe('speechMerge — collapseMisorderedMicMerge', () => {
    it('quita el prefijo huérfano inicial «ahí» y conserva el sufijo «estás ahí»', () => {
        expect(collapseMisorderedMicMerge('ahí estás ahí')).toBe('estás ahí');
    });
});

describe('speechMerge — collapseEchoPhrase', () => {
    it('quita eco de frase repetida al cierre', () => {
        expect(collapseEchoPhrase('el niño juega el niño juega')).toBe('el niño juega');
    });
});

describe('speechMerge — collapseAsrStutter', () => {
    it('colapsa bloque repetido en medio del turno', () => {
        expect(
            collapseAsrStutter('hoy vamos a la escuela hoy vamos a la escuela y luego jugamos'),
        ).toBe('hoy vamos a la escuela y luego jugamos');
    });
});

describe('speechMerge — normalizeMicText', () => {
    it('corto: pipeline quita el prefijo huérfano inicial y conserva el sufijo', () => {
        expect(normalizeMicText('ahí estás ahí')).toBe('estás ahí');
    });

    it('largo: colapsa stutter ASR sin perder el resto', () => {
        expect(
            normalizeMicText('hoy vamos a la escuela hoy vamos a la escuela y luego jugamos'),
        ).toBe('hoy vamos a la escuela y luego jugamos');
    });
});

describe('speechMerge — mergeMicChunks / pickBestMicInterim', () => {
    it('mergeMicChunks fusiona fragmentos acumulativos del mismo onresult', () => {
        expect(mergeMicChunks(['hola como', 'hola como estas'])).toBe('hola como estas');
    });

    it('pickBestMicInterim elige el interino más completo', () => {
        expect(pickBestMicInterim(['hola', 'hola como', 'hola como estas'])).toBe(
            'hola como estas',
        );
    });
});

describe('speechMerge — mergeSpeechText', () => {
    it('fusión progresiva conserva el texto más largo', () => {
        expect(mergeSpeechText('hola como estas', 'hola como estas hoy')).toBe(
            'hola como estas hoy',
        );
    });

    it('es idempotente con el mismo texto', () => {
        expect(mergeSpeechText('hola como estas', 'hola como estas')).toBe('hola como estas');
    });
});

describe('speechMerge — shouldPreferShortFinalRow', () => {
    it('«hola» tras pausa larga y confianza alta → fila nueva', () => {
        const prior = 'que buen día para caminar por el parque con amigos';
        expect(
            shouldPreferShortFinalRow('hola', prior, { pauseBeforeMs: 5000, confidence: 0.9 }),
        ).toBe(true);
    });

    it('pausa corta no habilita fila nueva', () => {
        const prior = 'que buen día para caminar por el parque con amigos';
        expect(
            shouldPreferShortFinalRow('hola', prior, { pauseBeforeMs: 100, confidence: 0.9 }),
        ).toBe(false);
    });
});

describe('speechMerge — wouldShrinkLog', () => {
    it('no acorta si el final es prefijo del previo (sufijo nuevo)', () => {
        expect(wouldShrinkLog('hola como estas', 'hola como estas hoy', { pauseBeforeMs: 5000 })).toBe(
            true,
        );
    });

    it('no bloquea cuando el capture no acorta', () => {
        expect(wouldShrinkLog('hola como estas hoy', 'hola como estas')).toBe(false);
    });
});

describe('speechMerge — micPublishedParityOk', () => {
    it('detecta prefijo huérfano «ahí estás ahí» vs mic «estás ahí»', () => {
        expect(micPublishedParityOk('ahí estás ahí', 'estás ahí')).toBe(true);
    });

    it('marca no paridad cuando no hay relación', () => {
        expect(micPublishedParityOk('a b c', 'x y z')).toBe(false);
    });
});

describe('speechMerge — hasSpeechAnchor', () => {
    it('ancla de 3+ palabras de next aparece en prev', () => {
        expect(hasSpeechAnchor('hoy vamos a la escuela', 'hoy vamos a la')).toBe(true);
    });

    it('ancla corta o sin coincidencia → false', () => {
        expect(hasSpeechAnchor('completamente diferente', 'xyz no match')).toBe(false);
    });
});

describe('speechMerge — reempalme por re-escucha del ASR (wake word duplicado)', () => {
    it('3 fragmentos: «okay flu»/«okay flow tradu ce» + «okay flow traduce…» → un solo turno limpio', () => {
        expect(
            mergeMicChunks([
                'nina esta hablando okay flu',
                'okay flow tradu ce',
                'okay flow traduce lo que dijiste en',
            ]),
        ).toBe('nina esta hablando okay flow traduce lo que dijiste en');
    });

    it('2 fragmentos con primeras palabras distintas (nina/okay) → no duplica el wake word', () => {
        expect(
            mergeMicChunks([
                'nina esta hablando okay flu',
                'okay flow traduce lo que dijiste en',
            ]),
        ).toBe('nina esta hablando okay flow traduce lo que dijiste en');
    });

    it('coincidencia parcial en el límite NO dispara el empalme (guarda: TODOS los pares) → fallback', () => {
        expect(
            mergeMicChunks(['vamos a revisar el plan de hoy', 'el clima esta perfecto ahora']),
        ).toBe('vamos a revisar el plan de hoy el clima esta perfecto ahora');
    });
});

describe('transcriptIngress — collectRecognitionResultChunks', () => {
    it('separa interinos y finales respetando resultIndex', () => {
        const event = {
            resultIndex: 0,
            results: {
                length: 2,
                0: { isFinal: false, 0: { transcript: 'hola como', confidence: 0.9 }, length: 1 },
                1: { isFinal: true, 0: { transcript: 'hola como estas', confidence: 0.95 }, length: 1 },
            },
        };
        expect(collectRecognitionResultChunks(event)).toEqual({
            interimChunks: ['hola como'],
            finalChunks: ['hola como estas'],
        });
    });

    it('salta chunks previos a resultIndex', () => {
        const event = {
            resultIndex: 1,
            results: {
                length: 2,
                0: { isFinal: false, 0: { transcript: 'hola como', confidence: 0.9 }, length: 1 },
                1: { isFinal: true, 0: { transcript: 'hola como estas', confidence: 0.95 }, length: 1 },
            },
        };
        expect(collectRecognitionResultChunks(event)).toEqual({
            interimChunks: [],
            finalChunks: ['hola como estas'],
        });
    });

    it('evento vacío → listas vacías sin pérdida de datos', () => {
        expect(collectRecognitionResultChunks({})).toEqual({ interimChunks: [], finalChunks: [] });
        expect(collectRecognitionResultChunks(null)).toEqual({ interimChunks: [], finalChunks: [] });
    });
});
