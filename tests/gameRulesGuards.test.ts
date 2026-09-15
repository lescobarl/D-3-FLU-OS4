// ============================================================
// Guards de REGLAS de juegos (comportamiento, sin tocar el azar real).
// Cubren las causas raíz corregidas que no tenían barrera propia:
//   - números hablados 0-100 y compuestos ("treinta y cinco");
//   - repiteTraduce: solo la traducción al inglés acredita;
//   - memoriaSecuencias: nombres hablados de letras ("be", "hache");
//   - palabrasEncadenadas: elige la palabra que ENLAZA, no la primera;
//   - adivinaCancion: alias del título mostrado ("sueño").
// ============================================================
import { describe, test, expect } from 'vitest';
import { resolveNumericAnswer } from '../src/core/games/gameUtils';
import { createRepiteTraduceEngine } from '../src/core/games/repiteTraduce';
import { createMemoriaSecuenciasEngine } from '../src/core/games/memoriaSecuencias';
import { createPalabrasEncadenadasEngine, WORD_BANK } from '../src/core/games/palabrasEncadenadas';
import { SONG_BANK } from '../src/core/games/adivinaCancion';
import type { GameSession } from '../src/core/games/types';

const firstLetter = (word: string): string =>
    word.normalize('NFD').replace(/[\u0300-\u036f]/g, '')[0].toLowerCase();

const SPOKEN_LETTER: Record<string, string> = {
    A: 'a', B: 'be', C: 'ce', D: 'de', E: 'e', F: 'efe', G: 'ge', H: 'hache',
};

describe('gameUtils — números hablados (0-100 y compuestos)', () => {
    test('palabras, decenas compuestas y último número de la frase', () => {
        expect(resolveNumericAnswer('veinticinco')).toBe(25);
        expect(resolveNumericAnswer('cien')).toBe(100);
        expect(resolveNumericAnswer('treinta y cinco')).toBe(35);
        expect(resolveNumericAnswer('después del 2 viene el 3')).toBe(3);
    });
});

describe('repite_traduce — solo la traducción al inglés acredita', () => {
    function fresh() {
        const engine = createRepiteTraduceEngine({ random: () => 0.9999 });
        const session = engine.createSession({ rounds: 3 });
        engine.start(session, { rounds: 3 });
        return { engine, session };
    }

    test('repetir la palabra en español NO gana', () => {
        const { engine, session } = fresh();
        const result = engine.turn(session, 'perro');
        expect(result.valid).toBe(false);
        expect(session.score).toBe(0);
    });

    test('la traducción en inglés SÍ gana', () => {
        const { engine, session } = fresh();
        const result = engine.turn(session, 'dog');
        expect(result.valid).toBe(true);
        expect(session.score).toBe(1);
    });
});

describe('memoria_secuencias — acepta nombres hablados de letras', () => {
    test('decir la secuencia con nombres ("be", "hache") acredita', () => {
        const engine = createMemoriaSecuenciasEngine({ random: () => 0.9999 });
        const session = engine.createSession({ rounds: 3 });
        engine.start(session, { rounds: 3 });
        const sequence = (session.state as { sequence: string[] }).sequence;
        const spoken = sequence.map((letter) => SPOKEN_LETTER[letter]).join(' ');
        const result = engine.turn(session, spoken);
        expect(result.valid).toBe(true);
        expect(session.score).toBe(1);
    });
});

describe('palabras_encadenadas — elige la palabra que enlaza', () => {
    test('con dos palabras del banco en la frase, acepta la que empieza con la letra pedida', () => {
        const engine = createPalabrasEncadenadasEngine({ random: () => 0.9999 });
        const session = engine.createSession({ rounds: 3 });
        engine.start(session, { rounds: 3 });
        const nextLetter = (session.state as { nextLetter: string }).nextLetter;

        const link = WORD_BANK.find((word) => firstLetter(word) === nextLetter);
        const decoy = WORD_BANK.find(
            (word) => word !== link && firstLetter(word) !== nextLetter,
        );
        expect(link).toBeDefined();
        expect(decoy).toBeDefined();

        const result = engine.turn(session, `${decoy} ${link}`);
        expect(result.valid).toBe(true);
        expect(session.score).toBe(1);
    });
});

describe('adivina_cancion — alias del título mostrado', () => {
    test('"sueño" es aceptado para "Sueño de Bunny"', () => {
        const sueno = SONG_BANK.find((song) => song.titulo === 'Sueño de Bunny');
        expect(sueno).toBeDefined();
        expect(sueno!.alias).toContain('sueno');
    });

    test('cada canción acepta su palabra principal (sin acentos)', () => {
        for (const song of SONG_BANK) {
            const main = song.titulo
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .split(/\s+/)[0];
            const accepted = song.alias.some((alias) => alias.split(/\s+/).includes(main));
            expect(accepted, `${song.titulo} no acepta "${main}"`).toBe(true);
        }
    });
});

describe('sesión de juego — serializable', () => {
    test('las sesiones de los motores touched siguen siendo serializables', () => {
        const engine = createPalabrasEncadenadasEngine({ random: () => 0.9999 });
        const session: GameSession = engine.createSession({ rounds: 3 });
        expect(JSON.parse(JSON.stringify(session))).toEqual(session);
    });
});
