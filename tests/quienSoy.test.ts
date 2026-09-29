// ============================================================
// quienSoy — Motor puro de ¿Quién soy? (plan-juegos §4).
//   - createQuienSoyEngine({ random }) → GameEngine (RNG inyectable).
//   - FLU piensa un animal y da pistas PROGRESIVAS; el niño adivina
//     tras cada pista. "pista"/"no sé" → siguiente pista; "paso" salta.
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0.9999` → shuffleOrder devuelve el orden
// idéntico [0..11] → el primer animal es QUIEN_SOY_BANK[0] = leon).
// Sin dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createQuienSoyEngine, QUIEN_SOY_BANK, MIN_CANDIDATOS_PRIMERA, quienSoyHints, quienSoyNarrowing } from '../src/core/games/quienSoy';

// random:()=>0.9999 → Fisher-Yates elige siempre el propio índice →
// order = [0,1,...,11] (identidad). Primer animal: QUIEN_SOY_BANK[0] = leon.
function freshQuien(rounds = 3) {
    const engine = createQuienSoyEngine({ random: () => 0.9999 });
    const session = engine.createSession({ rounds });
    const startResult = engine.start(session, { rounds });
    return { engine, session, startResult };
}

describe('quienSoy — inicio de partida', () => {
    test('start anuncia el primer animal con su pista 1 (leon)', () => {
        const { session, startResult } = freshQuien();
        expect(startResult.prompt).toBe(
            '¡Vamos a jugar a ¿Quién soy?! Soy un animal. Pista 1: Soy un mamífero: tengo pelo y de pequeño tomé leche de mi mamá. ¿Quién soy?'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
    });

    test('el banco tiene 12 animales con estructura {nombre, pistas[], revela[], rasgos[]}', () => {
        expect(QUIEN_SOY_BANK).toHaveLength(12);
        for (const item of QUIEN_SOY_BANK) {
            expect(typeof item.nombre).toBe('string');
            expect(item.nombre.length).toBeGreaterThan(0);
            expect(Array.isArray(item.pistas)).toBe(true);
            expect(item.pistas.length).toBeGreaterThan(0);
            expect(Array.isArray(item.revela)).toBe(true);
            expect(Array.isArray(item.rasgos)).toBe(true);
            expect(item.rasgos.length).toBeGreaterThan(0);
        }
    });
});

describe('quienSoy — aciertos', () => {
    test('responde "leon" → +1 y siguiente animal (elefante)', () => {
        const { engine, session } = freshQuien();
        const result = engine.turn(session, 'leon');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
        expect(result.animation).toBe('Jump_in_place');
        expect(result.prompt).toBe(
            '¡Correcto, era leon! Siguiente: Soy un animal. Pista 1: Soy un mamífero muy grande. ¿Quién soy?'
        );
    });

    test('completa la partida en 3 aciertos', () => {
        const { engine, session } = freshQuien(3);
        engine.turn(session, 'leon');      // → elefante
        engine.turn(session, 'elefante');  // → delfin
        const result = engine.turn(session, 'delfin');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(3);
        expect(result.prompt).toBe(
            '¡Correcto, era delfin! Completaste 3 animales con 3 puntos. ¡Eres un gran detective!'
        );
    });

    test('keyword alias: "lechuza" adivina el buho', () => {
        const { engine, session } = freshQuien(5);
        engine.turn(session, 'leon');      // → elefante
        engine.turn(session, 'elefante');  // → delfin
        engine.turn(session, 'delfin');    // → tortuga
        engine.turn(session, 'tortuga');   // → buho
        const result = engine.turn(session, 'lechuza');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe(
            '¡Correcto, era buho! Completaste 5 animales con 5 puntos. ¡Eres un gran detective!'
        );
    });
});

describe('quienSoy — pistas progresivas', () => {
    test('"dame una pista" avanza a la siguiente pista', () => {
        const { engine, session } = freshQuien();
        const result = engine.turn(session, 'dame una pista');
        expect(result.valid).toBe(false);
        expect(result.prompt).toBe('Pista 2: Soy un felino: ando a cuatro patas y tengo garras. ¿Quién soy?');
        expect(result.emotion).toBe('thinking');
        expect(session.round).toBe(1);
    });

    test('"no sé" entrega pista (no salta: hint tiene prioridad)', () => {
        const { engine, session } = freshQuien();
        const result = engine.turn(session, 'no sé');
        expect(result.prompt).toBe('Pista 2: Soy un felino: ando a cuatro patas y tengo garras. ¿Quién soy?');
        expect(session.round).toBe(1);
    });

    test('tras la última pista, avisa que se agotaron', () => {
        const { engine, session } = freshQuien();
        engine.turn(session, 'pista'); // Pista 2
        engine.turn(session, 'pista'); // Pista 3
        engine.turn(session, 'pista'); // Pista 4
        const result = engine.turn(session, 'pista');
        expect(result.prompt).toBe('Ya te di todas las pistas. Pista 4: Rujo fuerte: ¡grrr! ¿Quién soy?');
    });
});

describe('quienSoy — calidad de pistas (invariante)', () => {
    test('ninguna primera pista es una negación (información cero)', () => {
        for (const item of QUIEN_SOY_BANK) {
            const primera = quienSoyHints(item)[0];
            expect(primera).toBeTruthy();
            expect(primera).not.toMatch(/^\s*no\b/i);
        }
    });

    test('el reordenado no pierde ni duplica pistas', () => {
        for (const item of QUIEN_SOY_BANK) {
            const pistas = quienSoyHints(item);
            expect(pistas).toHaveLength(item.pistas.length);
            expect([...pistas].sort()).toEqual([...item.pistas].sort());
        }
    });

    // ------------------------------------------------------------
    // LO QUE FALTABA MEDIR (defecto del dueño: "pistas vagas/inutiles").
    // Hasta ahora la unica invariante era "la primera no es una negacion":
    // nada obligaba a que una pista APORTARA. 15 de las 48 pistas del banco
    // eran relleno ("Soy muy fuerte y valiente.", "Hago algo muy dulce.",
    // "Soy muy ligera."): no descartaban ni un animal. Estas tres medidas son
    // las que cierran la clase de defecto, no un caso suelto.
    // ------------------------------------------------------------
    test('cada pista REVELA un rasgo de verdad del animal (revela alineado con pistas)', () => {
        for (const item of QUIEN_SOY_BANK) {
            expect(item.revela).toHaveLength(item.pistas.length);
            for (const rasgo of item.revela) {
                expect(item.rasgos).toContain(rasgo);
            }
            expect(new Set(item.rasgos).size).toBe(item.rasgos.length);
        }
    });

    test('la primera pista NUNCA resuelve el juego: deja al menos 3 animales posibles', () => {
        for (const item of QUIEN_SOY_BANK) {
            const curva = quienSoyNarrowing(item);
            expect(curva[0]).toBeGreaterThanOrEqual(MIN_CANDIDATOS_PRIMERA);
            expect(curva[0]).toBeLessThan(QUIEN_SOY_BANK.length);
        }
    });

    test('ninguna pista es relleno: mientras el juego sigue abierto, cada pista descarta a alguien', () => {
        const relleno: string[] = [];
        for (const item of QUIEN_SOY_BANK) {
            const curva = quienSoyNarrowing(item);
            let anteriores = QUIEN_SOY_BANK.length;
            curva.forEach((restantes, i) => {
                if (anteriores > 1 && restantes >= anteriores) {
                    relleno.push(`${item.nombre} pista ${i + 1}: ${anteriores} -> ${restantes}`);
                }
                anteriores = restantes;
            });
        }
        expect(relleno).toEqual([]);
    });

    test('la última pista deja EXACTAMENTE un animal posible: la partida siempre se puede cerrar', () => {
        const abiertos: string[] = [];
        for (const item of QUIEN_SOY_BANK) {
            const curva = quienSoyNarrowing(item);
            const restantes = curva[curva.length - 1];
            if (restantes !== 1) abiertos.push(`${item.nombre}: quedan ${restantes}`);
        }
        expect(abiertos).toEqual([]);
    });

    test('caso medido: el pingüino abre con "Soy un ave, pero no puedo volar." (acota a las 3 aves)', () => {
        const pinguino = QUIEN_SOY_BANK.find((item) => item.nombre === 'pinguino');
        expect(pinguino).toBeTruthy();
        const pistas = quienSoyHints(pinguino!);
        expect(pistas[0]).toBe('Soy un ave, pero no puedo volar.');
        // La primera pista sola NO lo delata: quedan las 3 aves del banco.
        expect(quienSoyNarrowing(pinguino!)[0]).toBe(3);
    });

    test('caso medido (partida real): el pingüino es adivinable con lo que FLU dice', () => {
        const { engine, session } = freshQuien(12); // order identidad: el cursor avanza 1 a 1
        for (let i = 0; i < 7; i += 1) engine.turn(session, 'paso'); // cursor 7 → pinguino
        const incorrecto = engine.turn(session, 'un perro');
        // Ni "¡Casi!" falso ni la pista que no acota nada (antes abría con la negación universal).
        expect(incorrecto.prompt).toBe('No, ese no es. Inténtalo otra vez. Pista 2: Nado muy bien y vivo donde hace mucho frío. ¿Quién soy?');
        // Y contra un ave de verdad sí hay "casi": el jugador puede cerrar el juego.
        const casi = engine.turn(session, 'buho');
        expect(casi.prompt).toContain('¡Casi!');
    });
});

describe('quienSoy — turnos incorrectos y saltos', () => {
    test('respuesta incorrecta → reintenta el mismo animal con PISTA NUEVA', () => {
        const { engine, session } = freshQuien();
        const result = engine.turn(session, 'perro');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('respuesta incorrecta');
        // "perro" no está en el banco: no hay "casi" que dar, y la pista avanza.
        expect(result.prompt).toBe('No, ese no es. Inténtalo otra vez. Pista 2: Soy un felino: ando a cuatro patas y tengo garras. ¿Quién soy?');
        expect(session.round).toBe(1); // no avanza de animal
    });

    test('"¡Casi!" solo si el animal nombrado es del banco y de la misma categoría', () => {
        const { engine, session } = freshQuien();
        const result = engine.turn(session, 'gato'); // ambos mamíferos
        expect(result.valid).toBe(false);
        expect(result.prompt).toBe('¡Casi! Inténtalo otra vez. Pista 2: Soy un felino: ando a cuatro patas y tengo garras. ¿Quién soy?');
    });

    test('agotadas las pistas, el fallo REVELA y AVANZA (no repite la ultima para siempre)', () => {
        // Defecto del dueno: "con esas pistas quien va a poder completar el juego".
        // Antes: la pista 1 podia ser una NEGACION y cada fallo repetia la MISMA
        // pista. Ahora hay 4 pistas positivas y distintas, y cuando el jugador
        // vuelve a fallar DESPUES de la ultima, la partida no se queda en bucle:
        // revela el animal y pasa al siguiente (mismo avance que "paso").
        const { engine, session } = freshQuien();
        const pistas = quienSoyHints(QUIEN_SOY_BANK[0]);
        let ultimo = engine.turn(session, 'perro'); // pista 2
        const dichas = [ultimo.prompt];
        for (let i = 2; i < pistas.length; i += 1) {
            ultimo = engine.turn(session, 'perro');
            dichas.push(ultimo.prompt);
        }
        // Todas las pistas dichas son DISTINTAS: cada fallo aporta informacion nueva.
        expect(new Set(dichas).size).toBe(dichas.length);
        expect(ultimo.prompt).toContain(`Pista ${pistas.length}`);
        // Fallo extra con el cupo agotado: revela y avanza (antes repetia "Pista 4").
        const agotado = engine.turn(session, 'perro');
        expect(agotado.valid).toBe(false);
        expect(agotado.score).toBe(0); // no hubo acierto: no puntua
        expect(session.round).toBe(2); // avanza de animal
        expect(agotado.prompt).toContain('Se acabaron las pistas');
        expect(agotado.prompt).toContain(QUIEN_SOY_BANK[0].nombre);
        expect(agotado.prompt).not.toBe(ultimo.prompt);
    });

    test('"paso" salta al siguiente animal sin puntuar', () => {
        const { engine, session } = freshQuien();
        const result = engine.turn(session, 'paso');
        expect(result.valid).toBe(false);
        expect(result.score).toBe(0);
        expect(session.round).toBe(2);
        expect(result.prompt).toBe(
            '¡Claro! Era leon. Siguiente: Soy un animal. Pista 1: Soy un mamífero muy grande. ¿Quién soy?'
        );
    });

    test('saltar el último animal termina la partida', () => {
        const { engine, session } = freshQuien(1);
        const result = engine.turn(session, 'paso');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Terminamos con 0 puntos. ¡Muy bien jugado!');
    });
});

describe('quienSoy — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshQuien(1);
        engine.turn(session, 'leon');
        const result = engine.turn(session, 'hola');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Ya terminamos de jugar ¿Quién soy?. ¿Jugamos otra vez?');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createQuienSoyEngine({ random: () => 0.9999 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('quienSoy — configuración (data-driven, sin hardcode)', () => {
    test('aplica clamps de rounds (1..12)', () => {
        const engine = createQuienSoyEngine({ random: () => 0.9999 });
        const session = engine.createSession({ rounds: 99 });
        const state = session.state as { maxRounds: number };
        expect(state.maxRounds).toBe(12); // MAX_ROUNDS = QUIEN_SOY_BANK.length
    });
});
