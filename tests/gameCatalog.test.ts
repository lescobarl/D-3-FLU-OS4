// ============================================================
// tests/gameCatalog.test.ts
// Valida el catálogo data-driven de juegos (plan-juegos §3):
// - GUARDIA TRIPLE de matchGameIntent: marco de intención + alias,
//   con anti-negación. "simón dice que te calles" NO inicia.
// - GAME_CATALOG solo contiene juegos implementados (sin dummies).
// - getGameEngine resuelve SOLO juegos del catálogo activo.
// ============================================================
import { describe, test, expect } from 'vitest';
import { matchGameIntent, getGameEngine, isGameId, GAME_IDS, END_GAME_FRAMES } from '../src/core/games/gameCatalog';

describe('gameCatalog — matchGameIntent (guardia triple)', () => {
    test('"ok flu, vamos a jugar a las adivinanzas" → adivinanzas', () => {
        const intent = matchGameIntent('ok flu, vamos a jugar a las adivinanzas');
        expect(intent).not.toBeNull();
        expect(intent?.id).toBe('adivinanzas');
    });

    test('"vamos a jugar a simon dice" → simon_dice', () => {
        expect(matchGameIntent('vamos a jugar a simon dice')?.id).toBe('simon_dice');
    });

    test('"juguemos a simon dice" → simon_dice', () => {
        expect(matchGameIntent('juguemos a simon dice')?.id).toBe('simon_dice');
    });

    test('"quiero jugar al juego de simon dice" → simon_dice', () => {
        expect(matchGameIntent('quiero jugar al juego de simon dice')?.id).toBe('simon_dice');
    });

    test('"quien quiere jugar a simon dice" → simon_dice', () => {
        expect(matchGameIntent('quien quiere jugar a simon dice')?.id).toBe('simon_dice');
    });

    test('"ok flu juguemos a las adivinanzas" → adivinanzas (sin comas ni wake)', () => {
        expect(matchGameIntent('ok flu juguemos a las adivinanzas')?.id).toBe('adivinanzas');
    });

    test('"simón dice que te calles" → null (falta marco de intención)', () => {
        expect(matchGameIntent('simón dice que te calles')).toBeNull();
    });

    test('negación: "no quiero jugar a las adivinanzas" → null', () => {
        expect(matchGameIntent('no quiero jugar a las adivinanzas')).toBeNull();
    });

    test('negación: "ya no quiero jugar a simon dice" → null', () => {
        expect(matchGameIntent('ya no quiero jugar a simon dice')).toBeNull();
    });

    test('marco sin alias → null ("vamos a jugar")', () => {
        expect(matchGameIntent('vamos a jugar')).toBeNull();
    });

    test('alias sin marco → null ("adivinanzas")', () => {
        expect(matchGameIntent('adivinanzas')).toBeNull();
    });

    test('texto en inglés → null ("let\'s play riddles")', () => {
        expect(matchGameIntent("let's play riddles")).toBeNull();
    });

    test('texto vacío → null', () => {
        expect(matchGameIntent('')).toBeNull();
    });

    test('juego inexistente (fuera de GAME_IDS) → null (sin dummies)', () => {
        // 'piedra_papel' no es un id válido ni está en el catálogo.
        expect(matchGameIntent('juguemos a piedra papel o tijera')).toBeNull();
    });

    test('"juguemos a veo veo" → veo_veo', () => {
        expect(matchGameIntent('juguemos a veo veo')?.id).toBe('veo_veo');
    });

    test('"vamos a jugar a adivinar el número" → adivina_numero', () => {
        expect(matchGameIntent('vamos a jugar a adivinar el número')?.id).toBe('adivina_numero');
    });

    test('"quiero jugar al cálculo mental" → calculo_mental', () => {
        expect(matchGameIntent('quiero jugar al cálculo mental')?.id).toBe('calculo_mental');
    });

    test('"a jugar a palabras encadenadas" → palabras_encadenadas', () => {
        expect(matchGameIntent('a jugar a palabras encadenadas')?.id).toBe('palabras_encadenadas');
    });

    test('"vamos a jugar a quién soy" → quien_soy', () => {
        expect(matchGameIntent('vamos a jugar a quién soy')?.id).toBe('quien_soy');
    });
});

describe('gameCatalog — getGameEngine (solo catálogo activo)', () => {
    test('simon_dice → motor disponible', () => {
        const engine = getGameEngine('simon_dice');
        expect(engine).not.toBeNull();
        expect(typeof engine?.createSession).toBe('function');
        expect(typeof engine?.start).toBe('function');
    });

    test('adivinanzas → motor disponible', () => {
        const engine = getGameEngine('adivinanzas');
        expect(engine).not.toBeNull();
        expect(typeof engine?.createSession).toBe('function');
        expect(typeof engine?.turn).toBe('function');
    });

    test('id no implementado (piedra_papel) → null', () => {
        expect(getGameEngine('piedra_papel' as never)).toBeNull();
    });

    test('id inexistente → null', () => {
        expect(getGameEngine('piedra_papel' as never)).toBeNull();
    });

    test('veo_veo → motor disponible', () => {
        const engine = getGameEngine('veo_veo');
        expect(engine).not.toBeNull();
        expect(typeof engine?.createSession).toBe('function');
        expect(typeof engine?.start).toBe('function');
    });

    test('adivina_numero → motor disponible', () => {
        const engine = getGameEngine('adivina_numero');
        expect(engine).not.toBeNull();
        expect(typeof engine?.createSession).toBe('function');
        expect(typeof engine?.turn).toBe('function');
    });

    test('calculo_mental → motor disponible', () => {
        const engine = getGameEngine('calculo_mental');
        expect(engine).not.toBeNull();
        expect(typeof engine?.createSession).toBe('function');
        expect(typeof engine?.turn).toBe('function');
    });

    test('palabras_encadenadas → motor disponible', () => {
        const engine = getGameEngine('palabras_encadenadas');
        expect(engine).not.toBeNull();
        expect(typeof engine?.createSession).toBe('function');
        expect(typeof engine?.turn).toBe('function');
    });

    test('quien_soy → motor disponible', () => {
        const engine = getGameEngine('quien_soy');
        expect(engine).not.toBeNull();
        expect(typeof engine?.createSession).toBe('function');
        expect(typeof engine?.turn).toBe('function');
    });
});

describe('gameCatalog — isGameId / GAME_IDS', () => {
    test('ids de Fase 2 → true', () => {
        expect(isGameId('simon_dice')).toBe(true);
        expect(isGameId('adivinanzas')).toBe(true);
        expect(isGameId('veo_veo')).toBe(true);
        expect(isGameId('adivina_numero')).toBe(true);
        expect(isGameId('calculo_mental')).toBe(true);
        expect(isGameId('palabras_encadenadas')).toBe(true);
        expect(isGameId('quien_soy')).toBe(true);
    });

    test('id de catálogo completo (respiracion) → true', () => {
        expect(isGameId('respiracion')).toBe(true);
    });

    test('id inexistente → false', () => {
        expect(isGameId('piedra_papel')).toBe(false);
        expect(isGameId('juego inventado')).toBe(false);
    });

    test('no string → false', () => {
        expect(isGameId(42)).toBe(false);
        expect(isGameId(null)).toBe(false);
        expect(isGameId(undefined)).toBe(false);
    });

    test('GAME_IDS está congelado y no vacío', () => {
        expect(Object.isFrozen(GAME_IDS)).toBe(true);
        expect(GAME_IDS.length).toBeGreaterThan(0);
        expect(GAME_IDS).toContain('simon_dice');
        expect(GAME_IDS).toContain('adivinanzas');
    });
});

describe('gameCatalog — END_GAME_FRAMES (control data-driven de partida activa)', () => {
    test('catálogo congelado y no vacío, todas las frases son texto no vacío', () => {
        expect(Object.isFrozen(END_GAME_FRAMES)).toBe(true);
        expect(END_GAME_FRAMES.length).toBeGreaterThan(0);
        for (const frame of END_GAME_FRAMES) {
            expect(typeof frame).toBe('string');
            expect(frame.trim().length).toBeGreaterThan(0);
        }
    });

    test('incluye las frases de salida documentadas del fast-path de voz', () => {
        expect(END_GAME_FRAMES).toEqual(expect.arrayContaining([
            'salir del juego',
            'terminar el juego',
            'dejar de jugar',
            'ya no quiero jugar',
            'cerrar el juego',
            'terminemos',
            'ya basta',
            'se acabo',
        ]));
    });

    test('frases ya normalizadas: sin diacríticos, minúsculas, sin dobles espacios', () => {
        for (const frame of END_GAME_FRAMES) {
            const normalized = frame
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .replace(/\s+/g, ' ')
                .trim();
            expect(normalized).toBe(frame);
        }
    });

    test('sin frases duplicadas', () => {
        expect(new Set(END_GAME_FRAMES).size).toBe(END_GAME_FRAMES.length);
    });
});
