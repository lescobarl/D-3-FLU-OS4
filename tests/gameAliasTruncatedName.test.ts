// ============================================================
// gameAliasTruncatedName — DEFECTO DE CLASE (defecto del dueno:
// "¿Quien soy? se corta/truncado").
//
// MEDIDO ANTES (sonda sobre el catalogo real, 2026-09-22): el ASR pierde el
// final de la ULTIMA palabra del nombre y el nombre deja de existir.
//   resolveGameCommandFromText("quien soy") -> {quien_soy, start}
//   resolveGameCommandFromText("quien so")  -> null           <-- cae al LLM
//   resolveGameCommandFromText("vamos a jugar quien so") -> {action:'unavailable'}
//       <-- el dueno dice "ese juego no lo tengo" de un juego que SI tiene
//   "loteri" -> null, "trivi" -> null: 97 cortes (de 1 y 2 letras) rompian la
//   decision en los 21 juegos del catalogo.
//
// Este guard NO comprueba un juego suelto: recorre el CATALOGO entero y exige,
// para cada juego, que su nombre cortado por el ASR tome la MISMA decision que
// el nombre entero. El dueno unico del match es `matchGameAliasOnly` /
// `matchGameIntent` (gameCatalog), que es lo que aqui se ejercita a traves del
// resolutor real.
// ============================================================
import { describe, test, expect } from 'vitest';
import { resolveGameCommandFromText } from '../src/voice/lib/gameCommands';
import { GAME_CATALOG, matchGameAliasOnly } from '../src/core/games/gameCatalog';

/** Cortes del ASR que este guard cubre: el final de la ultima palabra. */
const CORTES = [1, 2];

/** El nombre con sus ultimas `quita` letras perdidas. */
const cortado = (nombre: string, quita: number) => nombre.slice(0, Math.max(1, nombre.length - quita));

const decision = (texto: string) => JSON.stringify(resolveGameCommandFromText(texto) ?? null);

describe('nombre del juego CORTADO por el ASR: mismo dueno, misma decision', () => {
    test('los 21 juegos: el nombre cortado arranca la MISMA partida que el nombre entero', () => {
        const roto: string[] = [];
        for (const entrada of GAME_CATALOG) {
            const nombre = entrada.aliases[0];
            const esperado = decision(nombre);
            for (const quita of CORTES) {
                const dicho = cortado(nombre, quita);
                const got = decision(dicho);
                if (got !== esperado) roto.push(`"${dicho}" -> ${got} (el nombre entero da ${esperado})`);
            }
        }
        expect(roto).toEqual([]);
    });

    test('los 21 juegos: con marco de orden, el nombre cortado arranca y NO responde "unavailable"', () => {
        const roto: string[] = [];
        for (const entrada of GAME_CATALOG) {
            const nombre = entrada.aliases[0];
            const esperado = decision(`vamos a jugar ${nombre}`);
            for (const quita of CORTES) {
                const dicho = `vamos a jugar ${cortado(nombre, quita)}`;
                const got = decision(dicho);
                if (got !== esperado) roto.push(`"${dicho}" -> ${got} (el nombre entero da ${esperado})`);
            }
        }
        expect(roto).toEqual([]);
    });

    test('caso medido del dueno: "quien so" y "quien s" son ¿Quien soy?, no charla del LLM', () => {
        expect(resolveGameCommandFromText('quien so')).toEqual({ gameId: 'quien_soy', action: 'start' });
        expect(resolveGameCommandFromText('quien s')).toEqual({ gameId: 'quien_soy', action: 'start' });
        expect(resolveGameCommandFromText('vamos a jugar quien so')).toEqual({ gameId: 'quien_soy', action: 'start' });
        // El nombre pelado cortado tambien casa por el dueno del match exacto.
        expect(matchGameAliasOnly('quien so')?.id).toBe('quien_soy');
    });

    test('LIMITE: un corte NO puede comerse palabras enteras ("quien" no arranca el juego)', () => {
        // P7.58 sigue en pie: "quien" es arranque interrogativo y no es un nombre.
        expect(resolveGameCommandFromText('quien')).toBeNull();
        expect(resolveGameCommandFromText('vamos a jugar quien')).not.toEqual({ gameId: 'quien_soy', action: 'start' });
        expect(matchGameAliasOnly('quien')).toBeNull();
        // Y el "casi-nombre" de otra frase no arranca nada.
        expect(resolveGameCommandFromText('vamos a jugar veo')).not.toEqual({ gameId: 'veo_veo', action: 'start' });
    });

    test('LIMITE: con una sola palabra se exige dos tercios; "cuenta" y "adivina" no arrancan nada', () => {
        expect(resolveGameCommandFromText('vamos a jugar cuenta')).not.toEqual({ gameId: 'cuenta_conmigo', action: 'start' });
        expect(resolveGameCommandFromText('vamos a jugar adivina')).not.toEqual({ gameId: 'adivinanzas', action: 'start' });
    });

    test('un nombre que NO existe sigue sin inventor: "futbol" y el "adivina quien" del dueno', () => {
        // El dueño del "no lo tengo" sigue siendo el mismo (P7.53): aqui solo se
        // vigila que la tolerancia al corte NO invente un juego.
        expect(resolveGameCommandFromText('vamos a jugar al futbol')).toEqual({ action: 'unavailable' });
        expect(resolveGameCommandFromText('vamos a jugar Adivina quien')).toEqual({ action: 'unavailable' });
    });
});
