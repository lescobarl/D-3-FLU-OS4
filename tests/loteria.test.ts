// ============================================================
// loteria — Motor puro de Lotería (plan-juegos §Fase 3).
//   - createLoteriaEngine({ random }) → GameEngine (RNG inyectable).
//   - Banco local de 16 cartas { id, nombre, copla }.
//   - Reglas REALES: FLU reparte una TABLA fija de `tablaSize`
//     cartas y canta el mazo una por una. El niño MARCA con
//     "la tengo" / "yo la tengo" (solo si la carta está en su tabla).
//     "¡Lotería!" se grita ÚNICAMENTE al final, cuando completa
//     TODA su tabla (= ganar). "no la tengo" / "paso" salta.
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0.9999` → shuffleOrder devuelve el orden
// idéntico [0..15] → tabla = [gallo, dama, catrín] y el mazo
// avanza en ese mismo orden).
// Sin dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createLoteriaEngine, LOTERIA_BANK } from '../src/core/games/loteria';

// random:()=>0.9999 → Fisher-Yates elige siempre el propio índice →
// order = [0,1,...,15] (identidad). Tabla (3 cartas) = [0,1,2] =
// gallo, dama, catrín. El mazo se canta en el orden [0..15].
function freshLoteria(config: Record<string, unknown> = {}) {
    const engine = createLoteriaEngine({ random: () => 0.9999 });
    const session = engine.createSession(config);
    const startResult = engine.start(session, config);
    return { engine, session, startResult };
}

describe('loteria — inicio de partida', () => {
    test('start anuncia la tabla (3 cartas) y la primera carta del mazo (gallo)', () => {
        const { session, startResult } = freshLoteria({ tablaSize: 3 });
        expect(startResult.prompt).toBe(
            '¡Vamos a jugar a la lotería! Tu tabla tiene 3 cartas: El gallo, La dama y El catrín. Primera carta: El que le cantó a San Pedro no le volverá a cantar. ¡Dime "la tengo" si la tienes!'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
    });

    test('el banco tiene 16 cartas con estructura {id, nombre, copla}', () => {
        expect(LOTERIA_BANK).toHaveLength(16);
        for (const card of LOTERIA_BANK) {
            expect(typeof card.id).toBe('string');
            expect(card.id.length).toBeGreaterThan(0);
            expect(typeof card.nombre).toBe('string');
            expect(card.nombre.length).toBeGreaterThan(0);
            expect(typeof card.copla).toBe('string');
            expect(card.copla.length).toBeGreaterThan(0);
        }
    });

    test('createSession devuelve una sesión serializable y plana con tabla', () => {
        const { session } = freshLoteria({ tablaSize: 3 });
        expect(session.id).toBe('loteria');
        expect(session.state.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        expect(session.state.tabla).toEqual([0, 1, 2]);
        expect(session.state.marcadas).toEqual([false, false, false]);
        expect(session.state.cursor).toBe(0);
        expect(session.state.phase).toBe('announce');
        const roundTrip = JSON.parse(JSON.stringify(session));
        expect(roundTrip.state.order).toEqual(session.state.order);
        expect(roundTrip.state.tabla).toEqual(session.state.tabla);
        expect(roundTrip.state.marcadas).toEqual(session.state.marcadas);
    });
});

describe('loteria — marcado de carta ("la tengo")', () => {
    test('"la tengo" marca el gallo → +1 punto y siguiente carta del mazo (dama)', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = engine.turn(session, 'la tengo');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
        expect(result.prompt).toBe(
            '¡El gallo, lo tienes! Siguiente carta: Una dama distinguida, en su trono se quedó. ¡Dime "la tengo" si la tienes!'
        );
        expect(result.animation).toBe('Jump_in_place');
        expect(result.emotion).toBe('happy');
    });

    test('"yo la tengo" también marca la carta', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = engine.turn(session, 'yo la tengo');
        expect(result.valid).toBe(true);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
    });

    test('completa TODA la tabla (3 marcas) → pasa a fase "lista" esperando el grito', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        engine.turn(session, 'la tengo'); // gallo
        engine.turn(session, 'la tengo'); // dama
        const result = engine.turn(session, 'la tengo'); // catrín → tabla llena
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(3);
        expect(session.state.phase).toBe('lista');
        expect(result.prompt).toBe('¡Llenaste tu tabla! Ahora grita "¡Lotería!" para ganar.');
        expect(result.animation).toBe('Jump_in_place');
        expect(result.emotion).toBe('happy');
    });

    test('la carta cantada que NO está en la tabla no se marca y se salta', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        engine.turn(session, 'paso'); // gallo → dama
        engine.turn(session, 'paso'); // dama → catrín
        engine.turn(session, 'paso'); // catrín → diablito (NO está en la tabla)
        const result = engine.turn(session, 'la tengo'); // diablito no está en la tabla
        expect(result.valid).toBe(false);
        expect(result.score).toBe(0);
        expect(session.round).toBe(5);
        expect(result.prompt).toBe(
            '¡Esa carta no está en tu tabla! No la marques. Siguiente carta: La muerte calavera, a todos nos espera. ¡Dime "la tengo" si la tienes!'
        );
        expect(result.emotion).toBe('neutral');
    });
});

describe('loteria — el grito de "¡Lotería!"', () => {
    test('gritar "lotería" ANTES de llenar la tabla no gana (te faltan cartas)', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = engine.turn(session, 'lotería');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(0);
        expect(result.prompt).toBe(
            '¡Todavía no! Te faltan 3 cartas para llenar tu tabla. El que le cantó a San Pedro no le volverá a cantar. ¡Dime "la tengo" si la tienes!'
        );
        expect(result.emotion).toBe('neutral');
    });

    test('al llenar la tabla, gritar "¡Lotería!" = GANAR (Dance, gameOver)', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        engine.turn(session, 'la tengo'); // gallo
        engine.turn(session, 'la tengo'); // dama
        engine.turn(session, 'la tengo'); // catrín → lista
        const result = engine.turn(session, '¡Lotería!');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(3);
        expect(session.state.phase).toBe('done');
        expect(result.prompt).toBe(
            '¡LOTERÍA! ¡Completaste tu tabla con 3 cartas y 3 puntos! ¡Eres muy listo!'
        );
        expect(result.animation).toBe('Dance');
        expect(result.emotion).toBe('happy');
    });

    test('en fase "lista", cualquier otra frase recuerda que debe gritar "¡Lotería!"', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        engine.turn(session, 'la tengo');
        engine.turn(session, 'la tengo');
        engine.turn(session, 'la tengo'); // → lista
        const result = engine.turn(session, 'hola flu');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(3);
        expect(result.prompt).toBe('¡Tu tabla está llena! Grita "¡Lotería!" para ganar.');
        expect(result.emotion).toBe('encouraging');
    });
});

describe('loteria — saltar / pista / no reconocido', () => {
    test('"paso" salta la carta sin puntuar', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = engine.turn(session, 'paso');
        expect(result.valid).toBe(false);
        expect(result.score).toBe(0);
        expect(session.round).toBe(2);
        expect(result.prompt).toBe(
            '¡Claro! Siguiente carta: Una dama distinguida, en su trono se quedó. ¡Dime "la tengo" si la tienes!'
        );
        expect(result.emotion).toBe('neutral');
    });

    test('"no la tengo" salta (antes de que "la tengo" la marque)', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = engine.turn(session, 'no la tengo');
        expect(result.valid).toBe(false);
        expect(result.score).toBe(0);
        expect(session.round).toBe(2);
    });

    test('"pista" repite el nombre y la copla de la carta actual', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = engine.turn(session, 'dame una pista');
        expect(result.valid).toBe(false);
        expect(result.prompt).toBe(
            'La carta es: El gallo. El que le cantó a San Pedro no le volverá a cantar. ¡Dime "la tengo" si la tienes!'
        );
        expect(result.emotion).toBe('thinking');
        expect(session.round).toBe(1);
    });

    test('respuesta no reconocida → reintenta la misma carta', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = engine.turn(session, 'hola flu');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('respuesta no reconocida');
        expect(result.prompt).toBe(
            '¡Casi! Escúchame otra vez. El que le cantó a San Pedro no le volverá a cantar. ¡Dime "la tengo" si la tienes!'
        );
        expect(session.round).toBe(1);
    });
});

describe('loteria — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshLoteria({ tablaSize: 1 });
        engine.turn(session, 'la tengo'); // tabla (1 carta) llena → lista
        engine.turn(session, '¡Lotería!'); // gana
        const result = engine.turn(session, 'hola');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Ya terminamos la lotería. ¿Jugamos otra vez?');
    });

    test('se agotan las cartas del mazo sin llenar la tabla → fin con marcadas', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        engine.turn(session, 'la tengo'); // gallo (cursor 0 → 1)
        engine.turn(session, 'la tengo'); // dama (cursor 1 → 2)
        let result: ReturnType<typeof engine.turn> | undefined;
        // 14 saltos: catrín(2) … corona(15) → cursor llega a 16 = fin del mazo
        for (let i = 0; i < 14; i += 1) {
            result = engine.turn(session, 'no la tengo');
        }
        expect(result?.gameOver).toBe(true);
        expect(result?.score).toBe(2);
        expect(result?.prompt).toBe(
            '¡Se acabaron las cartas y no llenaste tu tabla! Marcaste 2 de 3. ¡Puedes volver a intentarlo!'
        );
        expect(result?.animation).toBe('Idle');
        expect(result?.emotion).toBe('encouraging');
    });

    test('isGameCommand reconoce controles, el grito y frases de salida', () => {
        const engine = createLoteriaEngine({ random: () => 0.9999 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('la tengo')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('lotería')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('loteria — configuración (data-driven, sin hardcode)', () => {
    test('aplica tablaSize y clamps al rango [1,16]', () => {
        const { session } = freshLoteria({ tablaSize: 2 });
        expect(session.state.tabla).toHaveLength(2);

        const low = createLoteriaEngine({ random: () => 0.9999 });
        const lowSession = low.createSession({ tablaSize: -5 });
        expect(lowSession.state.tabla).toHaveLength(1);

        const high = createLoteriaEngine({ random: () => 0.9999 });
        const highSession = high.createSession({ tablaSize: 99 });
        expect(highSession.state.tabla).toHaveLength(16);
    });

    test('retrocompatibilidad: cartasPorRonda y rounds siguen funcionando', () => {
        const compat = createLoteriaEngine({ random: () => 0.9999 });
        const compatSession = compat.createSession({ cartasPorRonda: 2 });
        expect(compatSession.state.tabla).toHaveLength(2);

        const alias = createLoteriaEngine({ random: () => 0.9999 });
        const aliasSession = alias.createSession({ rounds: 4 });
        expect(aliasSession.state.tabla).toHaveLength(4);
    });
});

describe('loteria — escenarios de escucha con ruido ASR', () => {
    // El ASR real entrega repeticiones, tartamudeos y puntuación alrededor de
    // la palabra clave. normalizeForMatch + hasToken deben seguir reconociendo:
    // hasToken exige que la frase inicie en límite de palabra (^ o espacio).
    test('repetición "la tengo la tengo la tengo" marca (la frase sobrevive)', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = engine.turn(session, 'la tengo la tengo la tengo');
        expect(result.valid).toBe(true);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
        expect(result.animation).toBe('Jump_in_place');
        expect(result.emotion).toBe('happy');
    });

    test('tartamudeo "la la tengo" marca (la frase "la tengo" sobrevive)', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = engine.turn(session, 'la la tengo');
        expect(result.valid).toBe(true);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
    });

    test('repetición con puntuación "me toco, me toco" marca', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = engine.turn(session, 'me toco, me toco');
        expect(result.valid).toBe(true);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
    });

    test('repetición de salto "no la tengo no la tengo" salta sin puntuar', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = engine.turn(session, 'no la tengo no la tengo');
        expect(result.valid).toBe(false);
        expect(result.score).toBe(0);
        expect(session.round).toBe(2);
    });

    test('repetición "paso, paso, paso" salta sin puntuar', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = engine.turn(session, 'paso, paso, paso');
        expect(result.valid).toBe(false);
        expect(result.score).toBe(0);
        expect(session.round).toBe(2);
    });

    test('repetición "pista pista pista" repite la misma carta (hint tiene prioridad)', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = engine.turn(session, 'pista pista pista');
        expect(result.valid).toBe(false);
        expect(result.prompt).toBe(
            'La carta es: El gallo. El que le cantó a San Pedro no le volverá a cantar. ¡Dime "la tengo" si la tienes!'
        );
        expect(result.emotion).toBe('thinking');
        expect(session.round).toBe(1);
    });

    test('grito repetido "lotería lotería lotería" antes de llenar no gana (te faltan)', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = engine.turn(session, 'lotería lotería lotería');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(0);
        expect(result.prompt).toBe(
            '¡Todavía no! Te faltan 3 cartas para llenar tu tabla. El que le cantó a San Pedro no le volverá a cantar. ¡Dime "la tengo" si la tienes!'
        );
    });

    test('grito con puntuación "lotería, ¡lotería!" con la tabla llena → gameOver con Dance', () => {
        const { engine, session } = freshLoteria({ tablaSize: 1 });
        engine.turn(session, 'la tengo'); // → lista
        const result = engine.turn(session, 'lotería, ¡lotería!');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(1);
        expect(result.animation).toBe('Dance');
        expect(result.emotion).toBe('happy');
        expect(result.prompt).toBe(
            '¡LOTERÍA! ¡Completaste tu tabla con 1 cartas y 1 puntos! ¡Eres muy listo!'
        );
    });

    test('"¡lotería!" con apertura española se reconoce como grito temprano (borde corregido)', () => {
        // hasToken acepta "¡"/"¿" y puntuación como límite de palabra inicial,
        // de modo que el grito natural "¡Lotería!" se reconoce aunque la tabla
        // aún no esté llena → avisa que todavía faltan cartas.
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = engine.turn(session, '¡lotería!');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(0);
        expect(result.prompt).toBe(
            '¡Todavía no! Te faltan 3 cartas para llenar tu tabla. El que le cantó a San Pedro no le volverá a cantar. ¡Dime "la tengo" si la tienes!'
        );
        expect(session.round).toBe(1);
    });
});
