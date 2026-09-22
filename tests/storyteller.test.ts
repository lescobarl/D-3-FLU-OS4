// ============================================================
// storyteller — Motor puro de Cuentacuentos (plan-juegos §Fase 4).
//   - createCuentacuentosEngine({ random }) → GameEngine (RNG inyectable).
//   - Banco local de 6 cuentos × 4 escenas; `turn` avanza con "sigue".
//   - `narrate` ingiere escenas externas (contrato Gemini) y las
//     sanitiza con sanitizeScenes (acota a escenasMax).
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0` → pickRandom devuelve STORY_BANK[0] =
// "El conejito que perdió sus orejas"). Sin dummies: cada prompt
// es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import {
    createCuentacuentosEngine,
    personalizeStory,
    STORY_BANK,
    DEFAULT_ESCENAS_MAX,
    sanitizeScenes,
    type Story,
} from '../src/core/games/storyteller';
import type { GameEngine } from '../src/core/games/gameEngine';

// random:()=>0 → pickRandom(items) = items[floor(0*len)] = items[0] →
// primer cuento: STORY_BANK[0] = "El conejito que perdió sus orejas".
function freshCuentacuentos(config: Record<string, unknown> = {}) {
    const engine = createCuentacuentosEngine({ random: () => 0 });
    const session = engine.createSession(config);
    const startResult = engine.start(session, config);
    return { engine, session, startResult };
}

describe('cuentacuentos — inicio de partida', () => {
    test('start anuncia el título y la primera escena (conejito Bunny)', () => {
        const { session, startResult } = freshCuentacuentos();
        expect(startResult.prompt).toBe(
            '¡Vamos a contar un cuento! Se llama "El conejito que perdió sus orejas". Había una vez un conejito llamado Bunny que una mañana despertó sin sus orejas.'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('curious');
        expect(session.round).toBe(1);
    });

    test('el banco tiene 6 cuentos únicos con estructura {titulo, escenas} de 4 escenas', () => {
        expect(STORY_BANK).toHaveLength(6);
        const titulos = new Set(STORY_BANK.map((s) => s.titulo));
        expect(titulos.size).toBe(6);
        for (const story of STORY_BANK) {
            expect(typeof story.titulo).toBe('string');
            expect(story.titulo.length).toBeGreaterThan(0);
            expect(Array.isArray(story.escenas)).toBe(true);
            expect(story.escenas).toHaveLength(4);
            for (const scene of story.escenas) {
                expect(typeof scene.texto).toBe('string');
                expect(scene.texto.length).toBeGreaterThan(0);
            }
        }
        // F2: los cuentos personalizables llevan el token {nombre} en las escenas.
        const robot = STORY_BANK.find((s) => s.titulo === 'El robot que quería aprender')!;
        const tesoro = STORY_BANK.find((s) => s.titulo === 'El tesoro del jardín')!;
        expect(JSON.stringify(robot.escenas)).toContain('{nombre}');
        expect(JSON.stringify(tesoro.escenas)).toContain('{nombre}');
        expect(robot.titulo).not.toContain('{nombre}');
        expect(tesoro.titulo).not.toContain('{nombre}');
    });

    test('createSession devuelve una sesión serializable y plana', () => {
        const engine = createCuentacuentosEngine({ random: () => 0 });
        const session = engine.createSession({});
        const state = session.state;
        expect(state.escenas).toHaveLength(4);
        expect(state.cursor).toBe(0);
        expect(state.maxEscenas).toBe(DEFAULT_ESCENAS_MAX);
        expect(state.phase).toBe('announce');
        expect(state.titulo).toBe('El conejito que perdió sus orejas');
        expect(state.source).toBe('local');
        // Serializable: JSON round-trip mantiene el estado completo.
        expect(JSON.parse(JSON.stringify(session))).toEqual(session);
    });
});

describe('cuentacuentos — avance de escenas con "sigue"', () => {
    test('"sigue" avanza a la segunda escena (búsqueda en casa)', () => {
        const { engine, session } = freshCuentacuentos();
        const result = engine.turn(session, 'sigue');
        expect(result.prompt).toBe(
            'Bunny buscó por toda la casa: debajo de la cama, en el cajón de los calcetines y hasta en la taza de zanahorias.'
        );
        expect(result.gameOver).toBe(false);
        expect(result.animation).toBe('Walk');
        expect(result.emotion).toBe('thinking');
        expect((session.state as { cursor: number }).cursor).toBe(1);
    });

    test('segundo "sigue" avanza a la tercera escena (la ardilla)', () => {
        const { engine, session } = freshCuentacuentos();
        engine.turn(session, 'sigue');
        const result = engine.turn(session, 'sigue');
        expect(result.prompt).toBe(
            'De pronto vio a su amiga la ardilla saltando muy feliz... ¡con las orejas de Bunny puestas como si fueran alas!'
        );
        expect(result.gameOver).toBe(false);
        expect(result.animation).toBe('Jump_in_place');
        expect(result.emotion).toBe('happy');
    });

    test('tercer "sigue" narra la última escena → gameOver', () => {
        const { engine, session } = freshCuentacuentos();
        engine.turn(session, 'sigue');
        engine.turn(session, 'sigue');
        const result = engine.turn(session, 'sigue');
        expect(result.prompt).toBe(
            'La ardilla se las devolvió con una sonrisa y desde entonces Bunny guarda sus orejas en una caja muy especial. Colorín colorado, este cuento se ha acabado.'
        );
        expect(result.gameOver).toBe(true);
        expect(result.animation).toBe('Dance');
        expect(result.emotion).toBe('happy');
    });

    test('cuarto "sigue" tras la última escena repite el cierre', () => {
        const { engine, session } = freshCuentacuentos();
        for (let index = 0; index < 4; index += 1) {
            engine.turn(session, 'sigue');
        }
        const result = engine.turn(session, 'sigue');
        expect(result.prompt).toBe('Ya terminamos el cuento. ¿Jugamos otra cosa?');
        expect(result.gameOver).toBe(true);
        expect(result.animation).toBe('Idle');
        expect(result.emotion).toBe('happy');
        expect((session.state as { phase: string }).phase).toBe('done');
    });
});

describe('cuentacuentos — pista y respuesta no reconocida', () => {
    test('"no sé" entrega la instrucción (pista)', () => {
        const { engine, session } = freshCuentacuentos();
        const result = engine.turn(session, 'no sé');
        expect(result.prompt).toBe(
            'Solo dime "sigue" para que continúe el cuento, o "terminar el juego" si quieres parar.'
        );
        expect(result.gameOver).toBe(false);
        expect(result.emotion).toBe('thinking');
    });

    test('respuesta no reconocida → invita a seguir con "sigue"', () => {
        const { engine, session } = freshCuentacuentos();
        const result = engine.turn(session, 'hola flu');
        expect(result.prompt).toBe('¿Quieres que siga el cuento? Dime "sigue".');
        expect(result.gameOver).toBe(false);
        expect(result.emotion).toBe('encouraging');
        expect(result.error).toBe('respuesta no reconocida');
        expect((session.state as { cursor: number }).cursor).toBe(0);
    });
});

describe('cuentacuentos — narrate (contrato de escenas externas)', () => {
    test('narrate sustituye el cuento por escenas externas', () => {
        const engine = createCuentacuentosEngine({ random: () => 0 });
        expect(engine.narrate).toBeTypeOf('function');
        const narrate = engine.narrate as NonNullable<GameEngine['narrate']>;
        const session = engine.createSession({});
        const scenes = [
            { texto: 'Una tortuga decidió que hoy era un gran día para caminar.', animacion: 'Dance', emocion: 'happy' },
            { texto: 'Y se fue a la playa a contar estrellas.', animacion: 'Walk', emocion: 'excited' },
        ];
        const result = narrate(session, scenes, {});
        expect(result.prompt).toBe(
            'Vamos a contar un cuento especial. Una tortuga decidió que hoy era un gran día para caminar.'
        );
        expect(result.gameOver).toBe(false);
        expect(result.animation).toBe('Dance');
        expect(result.emotion).toBe('happy');
        expect((session.state as { source: string }).source).toBe('external');
        expect((session.state as { escenas: unknown[] }).escenas).toHaveLength(2);
    });

    test('narrate con escenas vacías → error "cuento vacío"', () => {
        const engine = createCuentacuentosEngine({ random: () => 0 });
        expect(engine.narrate).toBeTypeOf('function');
        const narrate = engine.narrate as NonNullable<GameEngine['narrate']>;
        const session = engine.createSession({});
        const result = narrate(session, [], {});
        expect(result.prompt).toBe(
            'No recibí las escenas del cuento. Prueba de nuevo o pídeme un cuento de mi libro.'
        );
        expect(result.gameOver).toBe(true);
        expect(result.error).toBe('cuento vacío');
        expect((session.state as { phase: string }).phase).toBe('done');
    });

    test('sanitizeScenes filtra, normaliza y acota a escenasMax', () => {
        expect(sanitizeScenes(undefined, 4)).toEqual([]);
        expect(sanitizeScenes([] as never, 4)).toEqual([]);
        const scenes = [
            { texto: '  Primer escena  ', animacion: 'Walk', emocion: 'happy' },
            { texto: '   ' }, // sin texto → se descarta
            { texto: 'Segunda escena', animacion: 'NoExiste', emocion: '   ' },
            { texto: 'Cuarta escena' },
            { texto: 'Quinta escena' }, // exceden escenasMax=3 → quedan fuera del límite
        ];
        const clean = sanitizeScenes(scenes, 3);
        // El límite se aplica primero (solo las 3 primeras escenas); la
        // animación desconocida 'NoExiste' se conserva y la emoción vacía se omite.
        expect(clean).toEqual([
            { texto: 'Primer escena', animacion: 'Walk', emocion: 'happy' },
            { texto: 'Segunda escena', animacion: 'NoExiste' },
        ]);
    });
});

describe('cuentacuentos — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshCuentacuentos();
        for (let index = 0; index < 5; index += 1) {
            engine.turn(session, 'sigue');
        }
        const result = engine.turn(session, 'hola flu');
        expect(result.prompt).toBe('Ya terminamos el cuento. ¿Jugamos otra cosa?');
        expect(result.gameOver).toBe(true);
        expect(result.animation).toBe('Idle');
        expect(result.emotion).toBe('happy');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createCuentacuentosEngine({ random: () => 0 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('fin del cuento')).toBe(true);
        expect(engine.isGameCommand('sigue')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('cuentacuentos — configuración (data-driven, sin hardcode)', () => {
    test('aplica escenasMax y clamps al rango [1,12]', () => {
        expect(freshCuentacuentos({ escenasMax: -5 }).session.state.escenas).toHaveLength(1);
        expect(freshCuentacuentos({ escenasMax: 99 }).session.state.escenas).toHaveLength(4);
        expect(freshCuentacuentos({ maxEscenas: 2 }).session.state.escenas).toHaveLength(2);
    });
});

describe('cuentacuentos — personalización por participante (F2)', () => {
    test('personalizeStory sustituye {nombre} y no muta el cuento original', () => {
        const robot = STORY_BANK.find((s) => s.titulo === 'El robot que quería aprender')!;
        const personal = personalizeStory(robot, '  Luis  ');
        expect(personal.titulo).toBe('Un cuento para Luis: El robot que quería aprender');
        expect(personal.escenas[0].texto).toContain('Luis encontró en el desván');
        expect(personal.escenas[1].texto).toContain('Robi no sabía sumar ni leer, pero Luis le enseñó');
        expect(robot.escenas[0].texto).toContain('{nombre}');
        expect(robot.escenas[0].texto).not.toContain('Luis');
    });
    test('personalizeStory SIN nombre usa un nombre neutro (nunca narra "{nombre}")', () => {
        const robot = STORY_BANK.find((s) => s.titulo === 'El robot que quería aprender')!;
        for (const input of ['   ', undefined]) {
            const personal = personalizeStory(robot, input);
            const serialized = JSON.stringify(personal);
            expect(serialized).not.toContain('{nombre}');
            expect(personal.escenas[0].texto).toContain('Nuestro amigo encontró');
            expect(personal.escenas[1].texto).toContain('pero nuestro amigo le enseñó');
        }
    });
    test('personalizeStory personaliza un cuento cuyo título lleva token', () => {
        const custom: Story = {
            titulo: '{nombre} y la aventura del faro',
            escenas: [{ texto: '{nombre} llegó al faro al anochecer.' }],
        };
        const personal = personalizeStory(custom, 'Ana');
        expect(personal.titulo).toBe('Ana y la aventura del faro');
        expect(personal.escenas[0].texto).toBe('Ana llegó al faro al anochecer.');
    });
    test('el motor personaliza el cuento en createSession y start (F2)', () => {
        const engine = createCuentacuentosEngine({ random: () => 0 });
        const session = engine.createSession({ participantName: 'Luis' });
        expect((session.state as { titulo: string }).titulo).toBe(
            'Un cuento para Luis: El conejito que perdió sus orejas'
        );
        const startResult = engine.start(session, { participantName: 'Luis' });
        expect(startResult.prompt).toContain(
            'Se llama "Un cuento para Luis: El conejito que perdió sus orejas"'
        );
    });
});
