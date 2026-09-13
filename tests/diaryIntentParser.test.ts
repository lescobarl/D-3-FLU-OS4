// ============================================================
// diaryIntentParser.test.ts — Guard del reconocimiento de diario
// ------------------------------------------------------------
// El diario vuelve a reconocerse por voz: "escribe/anota en el diario ..."
// debe resolver diary.addEntry (y ganarle a la nota genérica).
// ============================================================
import { describe, expect, it } from 'vitest';
import { parseDiaryIntent } from '../src/core/diary/diaryIntentParser';

describe('parseDiaryIntent', () => {
    it('"escribe en el diario que fui al parque" → diary.addEntry', () => {
        const r = parseDiaryIntent('escribe en el diario que fui al parque');
        expect(r.handled).toBe(true);
        expect(r.action).toBe('diary.addEntry');
        expect(r.data?.content).toBe('fui al parque');
    });

    it('"anota en mi diario: hoy llovió" → content limpio', () => {
        const r = parseDiaryIntent('anota en mi diario: hoy llovió');
        expect(r.action).toBe('diary.addEntry');
        expect(r.data?.content).toBe('hoy llovió');
    });

    it('"diario: compré pan" → prefijo directo', () => {
        expect(parseDiaryIntent('diario: compré pan').data?.content).toBe('compré pan');
    });

    it('"write in my diary that I went to the park" (en)', () => {
        const r = parseDiaryIntent('write in my diary that I went to the park');
        expect(r.action).toBe('diary.addEntry');
        expect(r.data?.content).toBe('I went to the park');
    });

    it('no secuestra una nota común', () => {
        expect(parseDiaryIntent('apunta comprar pan').handled).toBe(false);
    });
});
