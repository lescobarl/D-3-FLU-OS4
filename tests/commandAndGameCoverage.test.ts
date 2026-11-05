// ============================================================
// tests/commandAndGameCoverage.test.ts
// Cobertura de comandos y juegos: guard GENERICO, sin listas de
// excepciones, derivado de las fuentes unicas del repo.
//
// Responde a tres preguntas de auditoria:
//   1. ¿Todo dominio del arbitro dispara?      (ARBITER_DOMAINS)
//   2. ¿Todo juego del catalogo arranca?       (GAME_CATALOG)
//   3. ¿Todo motor respeta el contrato y arranca? (GameEngine)
//   4. ¿Toda capacidad declarada esta en el prompt? (CAPABILITY_IDS)
//
// Si alguien añade un juego/dominio/capacidad y olvida el resto de la
// tuberia, estos casos fallan y dicen exactamente cual.
// ============================================================
import { describe, it, expect } from 'vitest';
import { GAME_CATALOG, GAME_IDS, getGameEngine } from '../src/core/games/gameCatalog';
import { resolveGameCommandFromText } from '../src/voice/lib/gameCommands.js';
import {
    resolveDeterministicCommand,
    ARBITER_DOMAINS,
} from '../src/voice/lib/deterministicArbiter.js';
import { CAPABILITY_IDS, buildCapabilitiesPrompt } from '../src/services/capabilities';
import {
    DISPATCHER_DOMAINS,
    DISPATCHER_HANDLERS,
    NAVIGATION_DOMAINS,
    STATE_FAST_PATH_DOMAINS,
    arbiterDomainRoute,
} from '../src/app/arbiterDomainRoutes';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeJuego } from '../src/voice/lib/configCommands.js';

// Frases de referencia tomadas de deterministicArbiter.test.ts (la especificacion).
const DOMAIN_PHRASES: Record<string, string> = {
    config: 'desactiva la temporada',
    game: 'juguemos a las adivinanzas',
    environment: 'actua como chef',
    agendaCommand: 'pon una alarma a las 7',
    shopping: 'agrega leche a la lista de compras',
    diary: 'escribe en el diario que fui al parque',
    note: 'apunta comprar pan',
    navigation: 'iniciar conversacion',
};

describe('cobertura - todo dominio del arbitro dispara', () => {
    // Cubre tambien el caso inverso: una frase de dominio no puede caer a otro.
    for (const domain of ARBITER_DOMAINS) {
        it(`${domain} resuelve su frase de referencia`, () => {
            const phrase = DOMAIN_PHRASES[domain];
            expect(phrase, `falta frase de referencia para ${domain}`).toBeTruthy();
            const result = resolveDeterministicCommand(phrase) as { domain: string | null };
            expect(result.domain).toBe(domain);
        });
    }
});

describe('cobertura - todo juego del catalogo arranca por sus alias', () => {
    it('el catalogo y los ids concuerdan', () => {
        expect(GAME_CATALOG.map((g) => g.id)).toEqual([...GAME_IDS]);
    });

    it('ningun juego se queda sin poder arrancar', () => {
        const sinArranque = GAME_CATALOG.filter((game) =>
            !game.aliases.some((alias) => {
                const cmd = resolveGameCommandFromText(`juguemos a ${alias}`) as {
                    gameId?: string;
                    action?: string;
                } | null;
                return cmd?.gameId === game.id && cmd?.action === 'start';
            }),
        ).map((g) => g.id);
        expect(sinArranque).toEqual([]);
    });
});

describe('cobertura - todo motor respeta el contrato GameEngine', () => {
    for (const game of GAME_CATALOG) {
        it(`${game.id} crea sesion y arranca`, () => {
            const engine = getGameEngine(game.id) as unknown as {
                createSession: () => { round?: number };
                start: (s: unknown) => { prompt?: string };
                turn: (...args: unknown[]) => unknown;
                isGameCommand: (t: string) => boolean;
            };
            expect(engine).toBeTruthy();
            const required = ['createSession', 'start', 'turn', 'isGameCommand'] as const;
            for (const fn of required) {
                expect(typeof engine[fn], `falta ${fn} en ${game.id}`).toBe('function');
            }
            const session = engine.createSession();
            const turn = engine.start(session);
            expect(typeof turn.prompt).toBe('string');
            expect(turn.prompt!.length).toBeGreaterThan(0);
        });
    }
});

describe('cobertura - toda capacidad declarada esta en el prompt', () => {
    for (const capability of CAPABILITY_IDS) {
        it(`${capability} declarada en es y en`, () => {
            expect(buildCapabilitiesPrompt('es')).toContain(capability);
            expect(buildCapabilitiesPrompt('en')).toContain(capability);
        });
    }
});

// ============================================================
// DESPACHO (no clasificacion) - el hueco real que dejo pasar el
// guard anterior: comprobaba que el Arbitro CLASIFICA cada dominio,
// pero no que el despacho lo EJECUTE. "vamos a jugar loteria"
// resolvia domain="game" y el despachador no tenia rama: reply=""
// y el LLM simulaba la partida.
// ============================================================
describe('cobertura - todo dominio del arbitro tiene ruta de DESPACHO', () => {
    it('ningun dominio del arbitro se queda sin ruta declarada', () => {
        const sinRuta = ARBITER_DOMAINS.filter((d) => arbiterDomainRoute(d) === null);
        expect(sinRuta, `dominios sin ruta de despacho: ${sinRuta.join(', ')}`).toEqual([]);
    });

    it('las rutas son exclusivas (un dominio no se ejecuta dos veces)', () => {
        const todas = [
            ...DISPATCHER_DOMAINS,
            ...NAVIGATION_DOMAINS,
            ...STATE_FAST_PATH_DOMAINS,
        ];
        expect(new Set(todas).size).toBe(todas.length);
    });

    it('el despachador sirve exactamente los dominios que declara', () => {
        const app = readFileSync(join(process.cwd(), 'src/app/arbiterDispatch.ts'), 'utf8');
        // El despachador ya NO cablea las ramas a mano: obtiene el manejador de la
        // tabla unica (`dispatcherHandlerFor` -> DISPATCHER_HANDLERS). Se verifica el
        // invariante contra el dueno unico, no contra texto: (a) la tabla sirve
        // exactamente los dominios declarados, (b) cada entrada apunta a un manejador
        // `__fluHandle*` real y (c) el despachador CONSULTA la tabla.
        const servidos = DISPATCHER_HANDLERS.map((entry) => entry.domain);
        expect([...servidos].sort()).toEqual([...DISPATCHER_DOMAINS].sort());
        expect(DISPATCHER_HANDLERS.length).toBeGreaterThan(0);
        const malFormados = DISPATCHER_HANDLERS.filter(
            (entry) => !/^__fluHandle[A-Za-z]+$/.test(entry.handler),
        );
        expect(malFormados, `entradas sin manejador __fluHandle*: ${malFormados.length}`).toEqual([]);
        expect(app).toMatch(/dispatcherHandlerFor\(domain\)/);
    });

    it('todo dominio del arbitro tiene ruta: despacho o ruta propia', () => {
        // El invariante que de verdad protege la cobertura: si el arbitro gana un
        // dominio y nadie lo declara (ni aqui ni en su ruta propia), el turno se
        // perderia en silencio. Se comprueba contra ARBITER_DOMAINS, la fuente real.
        const conRutaPropia = new Set<string>([...NAVIGATION_DOMAINS, ...STATE_FAST_PATH_DOMAINS]);
        const declarados = new Set<string>(DISPATCHER_DOMAINS);
        const sinRuta = ARBITER_DOMAINS.filter(
            (d) => !conRutaPropia.has(d) && !declarados.has(d),
        );
        expect(sinRuta, `dominios del arbitro sin ruta declarada: ${sinRuta.join(', ')}`).toEqual([]);
    });

    it('los dominios de estado y navegacion NO se despachan por el dispatcher', () => {
        const app = readFileSync(join(process.cwd(), 'src/app/arbiterDispatch.ts'), 'utf8');
        const propias = new Set<string>([...STATE_FAST_PATH_DOMAINS, ...NAVIGATION_DOMAINS]);
        const intrusos = DISPATCHER_HANDLERS.map((entry) => entry.domain).filter((d) =>
            propias.has(d),
        );
        expect(intrusos, `dominios con ruta propia despachados a la vez: ${intrusos.join(', ')}`).toEqual([]);
        // Y NO se reintroduce la cadena a mano que este guard retiro: las ramas por
        // dominio con su `__fluHandle*` deben seguir viviendo solo en la tabla.
        const ramas = app
            .split(/\r?\n/)
            .filter((l) => /domain\s*===\s*'/.test(l) && l.includes('__fluHandle'));
        expect(ramas, `ramas cableadas a mano en el despachador: ${ramas.length}`).toEqual([]);
    });

    // PRUEBA DEL DETECTOR (mutacion sintetica): se alimenta la entrada INFRACTORA
    // (una rama a mano de las que el refactor retiro) y debe marcarla; y la correcta
    // (la consulta a la tabla), que no. Un guard sin esto es decorativo.
    it('PRUEBA DEL DETECTOR: las ramas cableadas a mano se marcan', () => {
        const ramasDe = (src: string) =>
            src
                .split(/\r?\n/)
                .filter((l) => /domain\s*===\s*'/.test(l) && l.includes('__fluHandle'));
        expect(ramasDe("if (domain === 'note' && __fluHandleNoteText) {")).toHaveLength(1);
        expect(ramasDe('const entry = dispatcherHandlerFor(domain);')).toHaveLength(0);
    });

    it('PRUEBA DEL DETECTOR: un dominio sin ruta declarada se marca', () => {
        const conRutaPropia = new Set<string>([...NAVIGATION_DOMAINS, ...STATE_FAST_PATH_DOMAINS]);
        const sinRutaDe = (dominios: readonly string[], declarados: ReadonlySet<string>) =>
            dominios.filter((d) => !conRutaPropia.has(d) && !declarados.has(d));
        expect(sinRutaDe([...ARBITER_DOMAINS, 'dominioInventado'], new Set(DISPATCHER_DOMAINS))).toEqual([
            'dominioInventado',
        ]);
    });

    it('el resultado de game del arbitro es un contrato ejecutable por el fast-path', () => {
        // Ata clasificacion -> ejecucion: el fast-path de juegos consume el
        // contrato via normalizeJuego. Si el Arbitro devuelve una forma que
        // normalizeJuego rechaza, el reenvio quedaria en nada (reply="" y el LLM
        // simulando la partida), que es justo el defecto medido.
        const invalidos = GAME_CATALOG.filter((game) => {
            const res = resolveDeterministicCommand(`juguemos a ${game.aliases[0]}`) as {
                domain?: string | null;
                action?: unknown;
            };
            return !(res.domain === 'game' && normalizeJuego(res.action));
        }).map((g) => g.id);
        expect(invalidos, `juegos cuyo contrato no ejecuta el fast-path: ${invalidos.join(', ')}`).toEqual([]);
    });
});
