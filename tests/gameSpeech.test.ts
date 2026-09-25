// ============================================================
// gameSpeech — Mapeo puro entre resultado de motor y overrides de
// voz ("grito" al ganar / celebración puntual). Sin dummies: cada
// caso refleja el comportamiento REAL de resolveGameSpeechOptions.
//
// Regla de oro: el motor es la única fuente de verdad; este módulo
// solo decide CÓMO se pronuncia el prompt, nunca toca el estado.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
    resolveGameSpeechOptions,
    WIN_SHOUT,
    CELEBRATION_BOOST,
} from '../src/core/games/gameSpeech';

describe('gameSpeech — resolveGameSpeechOptions (mapeo a overrides de voz)', () => {
    it('gameOver → WIN_SHOUT (grito) sin importar la animación', () => {
        expect(resolveGameSpeechOptions({ gameOver: true, animation: 'Dance', emotion: 'happy' }))
            .toBe(WIN_SHOUT);
        // Fin por salto o cierre: también grito (es fin de partida).
        expect(resolveGameSpeechOptions({ gameOver: true, animation: 'Idle', emotion: 'neutral' }))
            .toBe(WIN_SHOUT);
        expect(resolveGameSpeechOptions({ gameOver: true })).toBe(WIN_SHOUT);
    });

    it('celebración no final (Dance / Jump_in_place) → CELEBRATION_BOOST', () => {
        expect(resolveGameSpeechOptions({ gameOver: false, animation: 'Dance', emotion: 'happy' }))
            .toBe(CELEBRATION_BOOST);
        expect(resolveGameSpeechOptions({ gameOver: false, animation: 'Jump_in_place', emotion: 'happy' }))
            .toBe(CELEBRATION_BOOST);
    });

    it('sin animación de celebración ni gameOver → sin overrides (perfil activo)', () => {
        expect(resolveGameSpeechOptions({ animation: 'Idle', emotion: 'thinking' })).toEqual({});
        expect(resolveGameSpeechOptions({ animation: 'Wave', emotion: 'neutral' })).toEqual({});
        expect(resolveGameSpeechOptions({ emotion: 'happy' })).toEqual({});
    });

    it('resultado ausente/undefined → {} (defensivo)', () => {
        expect(resolveGameSpeechOptions(undefined as never)).toEqual({});
        expect(resolveGameSpeechOptions(null as never)).toEqual({});
    });

    it('WIN_SHOUT y CELEBRATION_BOOST mantienen volume en el rango W3C [0,1]', () => {
        expect(WIN_SHOUT.volume).toBeGreaterThanOrEqual(0);
        expect(WIN_SHOUT.volume).toBeLessThanOrEqual(1);
        expect(WIN_SHOUT.rate).toBeGreaterThan(1);
        expect(WIN_SHOUT.pitch).toBeGreaterThan(1);
        expect(CELEBRATION_BOOST.volume).toBeGreaterThanOrEqual(0);
        expect(CELEBRATION_BOOST.volume).toBeLessThanOrEqual(1);
    });

    it('la intensidad del grito de victoria supera a la de la celebración puntual', () => {
        expect(WIN_SHOUT.rate!).toBeGreaterThan(CELEBRATION_BOOST.rate!);
        expect(WIN_SHOUT.pitch!).toBeGreaterThan(CELEBRATION_BOOST.pitch!);
    });

    it('las constantes exportadas son inmutables', () => {
        expect(Object.isFrozen(WIN_SHOUT)).toBe(true);
        expect(Object.isFrozen(CELEBRATION_BOOST)).toBe(true);
    });
});
