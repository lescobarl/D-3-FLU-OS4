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
