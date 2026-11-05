// ============================================================
// cuentoColaborativo — Motor puro de Cuento colaborativo (§Fase 3).
//   - createCuentoColaborativoEngine({ random }) → GameEngine (RNG inyectable).
//   - FLU abre con un inicio del banco local; el niño agrega sus
//     propias oraciones o pide "sigue"/"paso" para que FLU continúe.
//     El banco local SIEMPRE permite avanzar de forma determinista
//     (Riesgo 4: el juego no depende de Gemini).
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0` → escoge CUENTO_BANK[0] = Tito y siempre
// la continuaciones[0] = 'Tito encontró una zanahoria gigante...').
// Sin dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createCuentoColaborativoEngine, CUENTO_BANK } from '../src/core/games/cuentoColaborativo';

// random:()=>0 → Math.floor(0*2)=0 → CUENTO_BANK[0] (Tito).
// continuaciones[0] = 'Tito encontró una zanahoria gigante que brillaba con luz propia.'
const CONTINUACION = 'Tito encontró una zanahoria gigante que brillaba con luz propia.';

function freshCuento(config: Record<string, unknown> = {}) {
    const engine = createCuentoColaborativoEngine({ random: () => 0 });
    const session = engine.createSession(config);
    const startResult = engine.start(session, config);
    return { engine, session, startResult };
}

describe('cuento_colaborativo — inicio de partida', () => {
    test('start abre el cuento con el inicio del banco (Tito)', () => {
        const { session, startResult } = freshCuento();
        expect(startResult.prompt).toBe(
            '¡Vamos a inventar un cuento juntos! Yo empiezo: "Había una vez un conejito llamado Tito que vivía en un bosque mágico." ¿Qué pasa después?'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
    });

    test('el banco tiene 2 cuentos con estructura {inicio, continuaciones, cierre}', () => {
        expect(CUENTO_BANK).toHaveLength(2);
        for (const item of CUENTO_BANK) {
            expect(typeof item.inicio).toBe('string');
            expect(item.inicio.length).toBeGreaterThan(0);
            expect(Array.isArray(item.continuaciones)).toBe(true);
            expect(item.continuaciones.length).toBeGreaterThan(0);
            expect(typeof item.cierre).toBe('string');
            expect(item.cierre.length).toBeGreaterThan(0);
        }
    });

    test('createSession devuelve una sesión serializable y plana', () => {
        const { session } = freshCuento();
        expect(session.id).toBe('cuento_colaborativo');
        expect(session.state.cuento).toEqual([
            'Había una vez un conejito llamado Tito que vivía en un bosque mágico.',
        ]);
        expect(session.state.maxTurnos).toBe(4);
        expect(session.state.phase).toBe('announce');
        const roundTrip = JSON.parse(JSON.stringify(session));
        expect(roundTrip.state.cuento).toEqual(session.state.cuento);
        expect(roundTrip.state.maxTurnos).toBe(4);
    });
});

describe('cuento_colaborativo — aportación del jugador', () => {
    test('una frase propia → se agrega al cuento (+1) y se pide otra', () => {
        const { engine, session } = freshCuento();
        const result = engine.turn(session, 'el conejo encontró un tesoro');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
        expect(result.animation).toBe('Jump_in_place');
        expect(result.emotion).toBe('happy');
        expect(result.prompt).toBe(
            '¡Qué bonita frase! La agrego a nuestro cuento: "el conejo encontró un tesoro" ¿Y luego qué pasa?'
        );
    });

    test('la aportación que completa los turnos cierra el cuento', () => {
        const { engine, session } = freshCuento({ turnos: 2 });
        const result = engine.turn(session, 'el conejo encontró un tesoro');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(1);
        expect(result.animation).toBe('Dance');
        expect(result.prompt).toBe(
            '¡Nuestro cuento está completo! Había una vez un conejito llamado Tito que vivía en un bosque mágico. el conejo encontró un tesoro Y colorín colorado, este cuento se ha acabado. Fin de nuestro cuento. ¿Te gustó cómo quedó?'
        );
    });
});

describe('cuento_colaborativo — texto vacío', () => {
    test('aporte vacío → error amigable repitiendo el último fragmento', () => {
        const { engine, session } = freshCuento();
        const result = engine.turn(session, '   ');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('texto vacío');
        expect(result.prompt).toBe(
            'Cuéntame qué pasa en nuestra historia. Había una vez un conejito llamado Tito que vivía en un bosque mágico. ¿Y luego?'
        );
        expect(result.emotion).toBe('encouraging');
    });
});

describe('cuento_colaborativo — controles del jugador (pista / saltar)', () => {
    test('"sigue" hace que FLU continúe la historia', () => {
        const { engine, session } = freshCuento();
        const result = engine.turn(session, 'sigue');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.prompt).toBe(
            `Yo continúo: "${CONTINUACION}" ¿Y luego qué pasa?`
        );
        expect(result.emotion).toBe('thinking');
    });

    test('"paso" también hace que FLU continúe (mismo efecto que pista)', () => {
        const { engine, session } = freshCuento();
        const result = engine.turn(session, 'paso');
        expect(result.valid).toBe(false);
        expect(result.prompt).toBe(
            `Yo continúo: "${CONTINUACION}" ¿Y luego qué pasa?`
        );
        expect(session.state.cuento).toHaveLength(2);
    });

    test('FLU continúa hasta completar los turnos y cierra el cuento', () => {
        const { engine, session } = freshCuento();
        engine.turn(session, 'sigue');
        engine.turn(session, 'sigue');
        const result = engine.turn(session, 'sigue');
        expect(result.gameOver).toBe(true);
        expect(result.animation).toBe('Dance');
        expect(result.prompt).toBe(
            `¡Nuestro cuento está completo! Había una vez un conejito llamado Tito que vivía en un bosque mágico. ${CONTINUACION} ${CONTINUACION} ${CONTINUACION} Y colorín colorado, este cuento se ha acabado. Fin de nuestro cuento. ¿Te gustó cómo quedó?`
        );
    });
});

describe('cuento_colaborativo — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshCuento({ turnos: 2 });
        engine.turn(session, 'el conejo encontró un tesoro');
        const result = engine.turn(session, 'hola');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Ya terminamos nuestro cuento. ¿Inventamos otro?');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createCuentoColaborativoEngine({ random: () => 0 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('sigue')).toBe(true);
        expect(engine.isGameCommand('terminemos')).toBe(true);
        expect(engine.isGameCommand('fin del cuento')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('cuento_colaborativo — configuración (data-driven, sin hardcode)', () => {
    test('aplica turnos y clamps al rango [2,8]', () => {
        const { session } = freshCuento({ turnos: 3 });
        expect(session.state.maxTurnos).toBe(3);

        const low = createCuentoColaborativoEngine({ random: () => 0 });
        const lowSession = low.createSession({ turnos: -5 });
        expect(lowSession.state.maxTurnos).toBe(2);

        const high = createCuentoColaborativoEngine({ random: () => 0 });
        const highSession = high.createSession({ turnos: 99 });
        expect(highSession.state.maxTurnos).toBe(8);

        const alias = createCuentoColaborativoEngine({ random: () => 0 });
        const aliasSession = alias.createSession({ defaultTurnos: 5 });
        expect(aliasSession.state.maxTurnos).toBe(5);
    });
});
