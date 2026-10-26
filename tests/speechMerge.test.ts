// ============================================================
// speechMerge — transcripción 100% sin pérdidas (colapsos de
// eco ASR, stutter, prefijos huérfanos, filas cortas tras pausa).
// Fixtures trazados 1:1 contra src/voice/lib/speechMerge.js.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
    collapseRepeatedSpeech,
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
    fraseDelEventoAsr,
    mergeIntoOpenLine,
} from '../src/voice/lib/speechMerge.js';

describe('speechMerge — collapseRepeatedSpeech', () => {
    it('colapsa bloque contiguo repetido', () => {
        expect(collapseRepeatedSpeech('a b a b c')).toBe('a b c');
    });

    it('texto corto sin repetición se conserva', () => {
        expect(collapseRepeatedSpeech('hola como estas')).toBe('hola como estas');
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
    it('largo: colapsa stutter ASR sin perder el resto', () => {
        expect(
            normalizeMicText('hoy vamos a la escuela hoy vamos a la escuela y luego jugamos'),
        ).toBe('hoy vamos a la escuela y luego jugamos');
    });
});

describe('speechMerge — invariante: no eliminar una palabra cuya repetición no es contigua', () => {
    it('conserva la primera palabra legítima («hola ya hola»)', () => {
        expect(normalizeMicText('hola ya hola')).toBe('hola ya hola');
    });

    it('conserva el arranque aunque la frase sea más larga', () => {
        expect(normalizeMicText('hola ya estamos listos hola')).toBe('hola ya estamos listos hola');
    });

    it('no recorta nada cuando no hay duplicado contiguo', () => {
        expect(normalizeMicText('ahí estás ahí')).toBe('ahí estás ahí');
    });
});

describe('speechMerge — prefijo huérfano se descarta en el empalme (no en el texto)', () => {
    it('un fragmento de una palabra que reaparece al final de la frase completa se descarta', () => {
        expect(mergeMicChunks(['ahí', 'estás ahí'])).toBe('estás ahí');
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
    it('detecta prefijo huérfano «ahí estás ahí» vs mic «estás ahí» (ya no se enmascara)', () => {
        expect(micPublishedParityOk('ahí estás ahí', 'estás ahí')).toBe(false);
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

describe('fraseDelEventoAsr  trozo del evento con los resultados NUEVOS', () => {
    it('respeta resultIndex: el final retenido delante no entra', () => {
        const evento = {
            resultIndex: 1,
            results: {
                length: 2,
                0: { isFinal: true, 0: { transcript: 'frase del enunciado anterior', confidence: 0.9 }, length: 1 },
                1: { isFinal: false, 0: { transcript: 'frase nueva', confidence: 0.9 }, length: 1 },
            },
        };
        expect(fraseDelEventoAsr(evento.results, evento.resultIndex)).toBe('frase nueva');
    });

    it('une los finales hermanos del MISMO evento sin perder palabras', () => {
        const evento = {
            resultIndex: 0,
            results: [
                { isFinal: true, 0: { transcript: 'pon la musica esto', confidence: 0.9 }, length: 1 },
                { isFinal: true, 0: { transcript: 'pon la musica escucha', confidence: 0.9 }, length: 1 },
            ],
        };
        const trozo = fraseDelEventoAsr(evento.results, evento.resultIndex);
        expect(trozo).toContain('pon la musica');
        expect(trozo).toContain('esto');
        expect(trozo).toContain('escucha');
    });

    it('evento vacio o sin texto: sin trozo (no abre fila vacia)', () => {
        expect(fraseDelEventoAsr(undefined, 0)).toBe('');
        expect(fraseDelEventoAsr({ length: 0 }, 0)).toBe('');
    });
});

describe('mergeIntoOpenLine  una hipotesis por hueco (libro)', () => {
    it('acumula el tramo real: prefijo + cola que crece, la revision no duplica', () => {
        let fusion = mergeIntoOpenLine('', null, 'bien');
        expect(fusion.linea).toBe('bien');
        fusion = mergeIntoOpenLine(fusion.linea, fusion.libro, 'bien Vamos');
        expect(fusion.linea).toBe('bien Vamos');
        fusion = mergeIntoOpenLine(fusion.linea, fusion.libro, 'a hacer');
        expect(fusion.linea).toBe('bien Vamos a hacer');
        const antes = fusion.linea;
        fusion = mergeIntoOpenLine(antes, fusion.libro, 'a hacer algo');
        expect(fusion.linea).toBe('bien Vamos a hacer algo');
        expect(fusion.linea).not.toContain('a hacer a hacer');
    });

    it('un trozo ajeno se ANADE y abre hueco nuevo', () => {
        const fusion = mergeIntoOpenLine('hola mundo', null, 'esto es una prueba');
        expect(fusion.linea).toBe('hola mundo esto es una prueba');
        expect(fusion.libro?.base).toBe('hola mundo');
        expect(fusion.libro?.chunk).toBe('esto es una prueba');
    });

    it('el libro caduco se ignora: la linea la reescribio otro camino', () => {
        const libro = { base: '', chunk: 'hola', line: 'hola' };
        const fusion = mergeIntoOpenLine('otra cosa distinta', libro, 'nueva');
        expect(fusion.linea).toBe('otra cosa distinta nueva');
        expect(fusion.linea).not.toBe('hola nueva');
    });
});
