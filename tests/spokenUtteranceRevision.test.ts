import { describe, expect, it } from 'vitest';
import { spokenUtteranceRevision } from '../src/voice/lib/audioMath.js';

const WAKE_WORDS = ['ok flu', 'okay flu', 'ok flow', 'okay flow', 'oye flu', 'hey flu'];

describe('spokenUtteranceRevision — revisión ASR de la MISMA emisión', () => {
    it('reconoce el crecimiento de la misma frase (3 revisiones) como una sola emisión', () => {
        const r1 = spokenUtteranceRevision('Okay flu Busca en la web Cómo', 'Okay flu Busca en la web Cómo es que saltan los jugadores de', WAKE_WORDS);
        const r2 = spokenUtteranceRevision('Okay flu Busca en la web Cómo es que saltan los jugadores de', 'Okay flu Busca en la web Cómo es que saltan los jugadores de tenis', WAKE_WORDS);
        expect(r1).toBe('grow');
        expect(r2).toBe('grow');
    });

    it('trata como iguales variantes con/sin wake y con acentos/casing distintos', () => {
        expect(spokenUtteranceRevision('Okay flu Busca en la web Cómo', 'ok flu busca en la web como', WAKE_WORDS)).toBe('equal');
        expect(spokenUtteranceRevision('busca en la web como saltan los peces', 'busca en la web cómo saltan los peces', WAKE_WORDS)).toBe('equal');
    });

    it('crece aunque el final llegue SIN wake (una revisión anterior la tenía)', () => {
        expect(spokenUtteranceRevision('Okay Flow Busca en la web Cómo', 'busca en la web como saltan los peces', WAKE_WORDS)).toBe('grow');
    });

    it('NO confunde dos emisiones distintas', () => {
        expect(spokenUtteranceRevision('estás ahí', 'busca en la web como saltan los canguros', WAKE_WORDS)).toBe(false);
        expect(spokenUtteranceRevision('pon una alarma a las 7', 'busca en la web como saltan los ratones', WAKE_WORDS)).toBe(false);
    });
});
