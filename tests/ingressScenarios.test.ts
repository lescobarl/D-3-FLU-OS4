// ============================================================
// ingressScenarios — escenarios de validación de la etapa
// INGRESS (escucha → transcripción) para los casos pendientes
// de validar. Cada escenario usa el MISMO camino que el runtime
// (processListenPacket / integrateMicPacket / confirmFinal), no mocks.
//
// Frases para validar en pantalla (el usuario las dice):
//   1) «hola ya hola»                      → no debe perder el arranque.
//   2) «ahí» + «estás ahí»                 → un solo «estás ahí».
//   3) «hoy quiero una receta de pan»      → una frase, sin duplicar.
//   4) «hola» (pausa) «hola»               → turno nuevo, no se traga.
//   5) «habla otra persona»                → Hablante 2.
//   6) «hoy quiero una receta de pan» + final truncado «hoy quiero»
//      → conserva la frase completa (no pierde por final corto).
// ============================================================
import { describe, it, expect } from 'vitest';
import {
    createActiveListenState,
    confirmFinal,
    nextSpeakerLabel,
    detectNextSpeakerPhrase,
    isRedundantFinal,
    pickLongestFinal,
} from '../src/voice/lib/activeListen.js';
import {
    processListenPacket,
    integrateMicPacket,
    readTurnLive,
    readPublishedText,
} from '../src/voice/lib/conversationStream.js';
import { collectRecognitionResultChunks } from '../src/voice/lib/transcriptIngress.js';

describe('ingress — 1. escucha→transcripción NO pierde el arranque', () => {
    it('interino «hola ya hola» se muestra completo (no «ya hola»)', () => {
        const state = createActiveListenState();
        const packet = processListenPacket(state, '', { interim: 'hola ya hola' });
        expect(packet.published).toBe('hola ya hola');
        expect(readTurnLive(state)).toBe('hola ya hola');
    });

    it('onresult real (interino+final) conserva la frase completa', () => {
        const event = {
            resultIndex: 0,
            results: {
                length: 2,
                0: { isFinal: false, 0: { transcript: 'hola ya', confidence: 0.9 }, length: 1 },
                1: { isFinal: true, 0: { transcript: 'hola ya hola', confidence: 0.95 }, length: 1 },
            },
        };
        const { finalChunks } = collectRecognitionResultChunks(event);
        expect(pickLongestFinal(finalChunks)).toBe('hola ya hola');
    });
});

describe('ingress — 2. prefijo huérfano se descarta UNA vez en el empalme', () => {
    it('«ahí» + «estás ahí» → «estás ahí» (sin repetir la palabra)', () => {
        const state = createActiveListenState();
        const first = processListenPacket(state, '', { interim: 'ahí' });
        expect(first.published).toBe('ahí');
        const second = processListenPacket(state, first.published, { interim: 'estás ahí' });
        expect(second.published).toBe('estás ahí');
        expect(readTurnLive(state)).toBe('estás ahí');
    });
});

describe('ingress — 3. interino acumulativo de Chrome no duplica', () => {
    it('interinos crecientes → una sola frase completa', () => {
        const state = createActiveListenState();
        let published = '';
        for (const interim of [
            'hoy quiero',
            'hoy quiero una receta',
            'hoy quiero una receta de pan',
        ]) {
            published = processListenPacket(state, published, { interim }).published;
        }
        expect(published).toBe('hoy quiero una receta de pan');
        expect(published).not.toBe('hoy quiero hoy quiero una receta de pan');
    });
});

describe('ingress — 4. repetición deliberada tras pausa es turno nuevo', () => {
    it('misma frase dicha de nuevo tras pausa NO se descarta', () => {
        expect(
            isRedundantFinal('hola', {
                lastCommitted: 'hola',
                lastEmitted: 'hola',
                msSinceLastCommit: 5000,
            }),
        ).toBe(false);
    });
});

describe('ingress — 5. cambio de hablante (diarización por texto)', () => {
    it('«habla otra persona» avanza a Hablante 2', () => {
        expect(detectNextSpeakerPhrase('habla otra persona')).toBe(true);
        const state = createActiveListenState();
        const result = confirmFinal(state, 'habla otra persona');
        expect(result.speaker).toBe('Hablante 2');
    });

    it('la etiqueta nueva se calcula desde las conocidas', () => {
        expect(nextSpeakerLabel(['Hablante 1'])).toBe('Hablante 2');
    });
});

describe('ingress — 6. final truncado no pisa el interino largo', () => {
    it('final «hoy quiero» tras interino largo conserva la frase completa', () => {
        const state = createActiveListenState();
        const interimPacket = processListenPacket(state, '', {
            interim: 'hoy quiero una receta de pan',
        });
        const finalPacket = processListenPacket(state, interimPacket.published, {
            final: 'hoy quiero',
        });
        expect(finalPacket.published).toBe('hoy quiero una receta de pan');
    });
});

describe('ingress — 7. una sola frase canónica (display = fila)', () => {
    it('display y published coinciden para el mismo enunciado', () => {
        const state = createActiveListenState();
        const packet = processListenPacket(state, '', {
            interim: 'quiero una receta de pan',
        });
        expect(packet.display).toBe(packet.published);
        expect(readPublishedText(state)).toBe('quiero una receta de pan');
    });

    it('el mismo texto entra por integrateMicPacket sin cambiar', () => {
        const state = createActiveListenState();
        integrateMicPacket(state, { interim: 'quiero una receta de pan' });
        expect(readTurnLive(state)).toBe('quiero una receta de pan');
        expect(readPublishedText(state)).toBe('quiero una receta de pan');
    });
});
