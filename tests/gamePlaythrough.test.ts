// ============================================================
// gamePlaythrough - PARTIDA COMPLETA hasta victoria en TODOS los juegos.
//
// El jugador es GENERICO: no hay listas por juego. En cada turno se construye
// un repertorio de jugadas a partir de (a) los valores que el propio motor
// expone en su estado, (b) los bancos de datos exportados por su modulo y
// (c) las palabras del prompt. Se prueban sobre una copia de la sesion y solo
// se acepta una jugada que AVANCE (valida o ganadora); las que no avanzan se
// descartan restaurando la copia. Asi el jugador "entiende" el juego leyendo el
// propio motor, no una tabla escrita a mano.
//
// Invariantes (por juego del catalogo):
//   P1 - la partida LLEGA al final (gameOver) sin quedarse atascada.
//   P2 - el desenlace esta DECLARADO: `won` es booleano, nunca undefined.
//        (resolveGameSpeechOptions grita victoria si `won` es undefined, asi que
//        un final de derrota sin `won` se anunciaba como triunfo).
//   P3 - la VICTORIA es alcanzable: existe una partida que termina con won=true.
//   P4 - el final cierra la sesion en la ruta REAL de integracion
//        (applyGameAction + gameSessionStore).
// ============================================================
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { GAME_CATALOG } from '../src/core/games/gameCatalog';
import { applyGameAction } from '../src/app/gameActions';
import { clearActiveGameSession, getActiveGameSession } from '../src/core/games/gameSessionStore';
import type { GameEngine } from '../src/core/games/gameEngine';
import type { GameSession, GameTurnResult } from '../src/core/games/types';

// ------------------------------------------------------------
// Descubrimiento de motores y sus datos (sin listas por juego)
// ------------------------------------------------------------
const modules = (import.meta as unknown as {
    glob: (p: string, o: { eager: true }) => Record<string, Record<string, unknown>>;
}).glob('../src/core/games/*.ts', { eager: true });

interface EngineModule {
    engine: GameEngine<unknown>;
    data: string[];
}

function collectStrings(value: unknown, out: Set<string>, depth = 0): void {
    if (depth > 6 || value === null || value === undefined) return;
    if (typeof value === 'string') {
        const s = value.trim();
        if (s) out.add(s);
        return;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        out.add(String(value));
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectStrings(item, out, depth + 1);
        // Formas compuestas utiles (una secuencia se canta entera o elemento a elemento).
        if (value.every((v) => typeof v === 'string') && value.length > 1) {
            out.add((value as string[]).join(' '));
            out.add((value as string[]).join(''));
        }
        return;
    }
    if (typeof value === 'object') {
        for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, out, depth + 1);
    }
}

function buildEngines(): Map<string, EngineModule> {
    const found = new Map<string, EngineModule>();
    for (const mod of Object.values(modules)) {
        const factory = Object.entries(mod).find(
            ([k, v]) => /^create[A-Za-z]+Engine$/.test(k) && typeof v === 'function',
        )?.[1] as (() => GameEngine<unknown>) | undefined;
        if (!factory) continue;
        const engine = factory();
        const data = new Set<string>();
        for (const [key, value] of Object.entries(mod)) {
            if (key === 'default' || typeof value === 'function') continue;
            // Se incluyen los marcos de comando declarados por el motor: son
            // jugadas legitimas publicadas por su superficie (p.ej. el grito de
            // victoria de la loteria o el "listo" de respiracion).
            collectStrings(value, data);
        }
        found.set(engine.id, { engine, data: [...data] });
    }
    return found;
}

const ENGINES = buildEngines();

// ------------------------------------------------------------
// Auto-jugador generico
// ------------------------------------------------------------
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function plays(state: unknown, prompt: string, data: readonly string[]): string[] {
    const out = new Set<string>();
    collectStrings(state, out);
    for (const item of data) out.add(item);
    // El prompt es lo que el jugador "OYE": se anaden sus palabras y tambien los
    // n-gramas (2..4), porque el motor puede esperar la frase ENTERA que el mismo
    // acaba de enunciar (p.ej. "salta y baila" en Simon dice).
    const words = prompt.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    for (const word of words) out.add(word);
    // Todas las rebanadas (hasta 10 palabras): los juegos de repetir secuencia
    // (Simon dice hasta 5, memoria hasta 6) exigen la secuencia ENTERA.
    for (let n = 2; n <= Math.min(words.length, 10); n += 1) {
        for (let i = 0; i + n <= words.length; i += 1) {
            out.add(words.slice(i, i + n).join(' '));
        }
    }
    return [...out].filter((s) => s.length > 0 && s.length <= 60);
}

interface Final {
    outcome: 'win' | 'loss' | 'stuck';
    turns: number;
    result: GameTurnResult | null;
    trace: string[];
}

function playToEnd(engine: GameEngine<unknown>, data: readonly string[], seed = 0.5, maxTurns = 80): Final {
    // Semilla fija: los motores barajan bancos con Math.random, y una partida
    // completa no puede depender de la suerte.
    const session = engine.createSession({ random: () => seed }) as GameSession<unknown>;
    let result = engine.start(session, {});
    const trace: string[] = [result.prompt];
    // El sondeo de candidatos muta la sesion ENTERA (state + score + round). Si
    // solo se restaura `state`, la ronda se acumula y el motor cierra en derrota.
    const capturar = () => clone({ state: session.state, score: session.score, round: session.round });
    const restaurar = (s: { state: unknown; score: number; round: number }) => {
        session.state = clone(s.state);
        session.score = s.score;
        session.round = s.round;
    };
    for (let turn = 0; turn < maxTurns; turn += 1) {
        if (result.gameOver) {
            return { outcome: result.won === true ? 'win' : 'loss', turns: turn, result, trace };
        }
        const candidates = plays(session.state, result.prompt, data);
        const before = JSON.stringify(session.state);
        let advanced: GameTurnResult | null = null;
        const cierre = (trial: GameTurnResult, play: string): Final => ({
            outcome: trial.won === true ? 'win' : 'loss',
            turns: turn + 1,
            result: trial,
            trace: [...trace, play, trial.prompt],
        });
        // Pasada 1: buscar DIRECTAMENTE la victoria. Sin esto, una jugada de
        // relleno que "avanza" (p.ej. ir pasando cartas en la loteria) tapa la
        // jugada ganadora (el grito de la loteria).
        for (const play of candidates) {
            const snapshot = capturar();
            const trial = engine.turn(session, play);
            if (trial.gameOver && trial.won === true) return cierre(trial, play);
            restaurar(snapshot);
        }
        // Pasada 2: AVANCE real (turno VALIDO, o cambio de estado SIN error: los
        // ack/control del motor). Se descartan las jugadas con error (respuesta
        // equivocada) y cualquier final en derrota.
        for (const play of candidates) {
            const snapshot = capturar();
            const trial = engine.turn(session, play);
            const changed = JSON.stringify(session.state) !== before;
            const mistake = typeof trial.error === 'string' && trial.error.length > 0;
            if (!trial.gameOver && !mistake && (trial.valid === true || changed)) {
                advanced = trial;
                trace.push(play);
                break;
            }
            restaurar(snapshot);
        }
        // Pasada 3: no hay avance posible, pero el motor SI declara un final:
        // se cierra la partida. El desenlace declarado manda; la jugada NO se
        // convierte en victoria.
        if (!advanced) {
            for (const play of candidates) {
                const snapshot = capturar();
                const trial = engine.turn(session, play);
                if (trial.gameOver) return cierre(trial, play);
                restaurar(snapshot);
            }
            return { outcome: 'stuck', turns: turn, result, trace };
        }
        result = advanced;
    }
    return { outcome: 'stuck', turns: maxTurns, result, trace };
}

// ------------------------------------------------------------
// P1-P3 sobre TODOS los juegos del catalogo
// ------------------------------------------------------------
describe('partida completa: todos los juegos del catalogo', () => {
    const ids: readonly string[] = GAME_CATALOG.map((entry) => entry.id);

    it('el descubrimiento cubre TODO el catalogo (sin motores sueltos)', () => {
        const faltan = ids.filter((id) => !ENGINES.has(id));
        const sobran = [...ENGINES.keys()].filter((id) => !ids.includes(id));
        expect({ faltan, sobran }).toEqual({ faltan: [], sobran: [] });
    });

    it('P1/P2 - cada partida llega al final con desenlace DECLARADO (won booleano)', () => {
        const fallos: string[] = [];
        for (const id of ids) {
            const { engine, data } = ENGINES.get(id)!;
            const final = playToEnd(engine, data, 0.5);
            if (final.outcome === 'stuck') {
                fallos.push(`${id}: no llega al final (atascado en el turno ${final.turns})`);
                continue;
            }
            if (typeof final.result?.won !== 'boolean') {
                fallos.push(`${id}: termina con won=${JSON.stringify(final.result?.won)} (debe ser booleano)`);
            }
        }
        expect(fallos).toEqual([]);
    });

    it('P3 - la VICTORIA es alcanzable en cada juego', () => {
        const noGanables: string[] = [];
        for (const id of ids) {
            const { engine, data } = ENGINES.get(id)!;
            // Se busca una partida ganadora sobre varias semillas de barajado:
            // los motores barajan bancos, y ganar no puede depender de la suerte.
            // Los motores barajan bancos: ganar no puede depender de la suerte,
            // asi que se admiten varios intentos (barajados distintos) y basta
            // con que la victoria sea ALCANZABLE.
            let ganada: Final | null = null;
            for (const seed of [0.1, 0.3, 0.5, 0.7, 0.9]) {
                const run = playToEnd(engine, data, seed);
                if (run.outcome === 'win') {
                    ganada = run;
                    break;
                }
            }
            if (!ganada) {
                const diag = playToEnd(engine, data);
                noGanables.push(`${id}: no se pudo ganar (${diag.outcome} en el turno ${diag.turns})`);
            }
        }
        expect(noGanables).toEqual([]);
    });
});

// ------------------------------------------------------------
// P4 - ruta REAL de integracion: applyGameAction + gameSessionStore
// ------------------------------------------------------------
function fakeCtx() {
    const spoken: string[] = [];
    return {
        spoken,
        ctx: {
            languageRef: { current: 'es' },
            conversationActiveRef: { current: true },
            speakFluRef: { current: async (text: string) => { spoken.push(text); } },
            scheduleResumeListening: () => {},
            participantIdRef: { current: 'p1' },
        },
    };
}

describe('partida completa por la ruta REAL (applyGameAction)', () => {
    it('P4 - arrancar, jugar hasta el final y cerrar la partida activa', async () => {
        const fallos: string[] = [];
        for (const entry of GAME_CATALOG) {
            const id = entry.id;
            const { engine, data } = ENGINES.get(id)!;
            clearActiveGameSession();
            const { ctx, spoken } = fakeCtx();
            await applyGameAction({ gameId: id, action: 'start' }, ctx as never);
            if (!getActiveGameSession()) {
                fallos.push(`${id}: arrancar no deja partida activa`);
                continue;
            }

            let cerrada = false;
            for (let turn = 0; turn < 80 && !cerrada; turn += 1) {
                const session = getActiveGameSession()!;
                // La jugada la propone el motor (leyendo su estado), y se ejecuta
                // por la ruta real de integracion.
                // El prompt es lo ULTIMO que FLU dijo por la ruta real: es lo que
                // el jugador "oye" y lo que el motor espera de vuelta.
                const candidatas = plays(session.state, spoken[spoken.length - 1] ?? '', data);
                const snapshot = clone({ state: session.state, score: session.score, round: session.round });
                const sondea = (play: string) => {
                    const before = JSON.stringify(session.state);
                    const trial = engine.turn(session, play);
                    const changed = JSON.stringify(session.state) !== before;
                    session.state = clone(snapshot.state);
                    session.score = snapshot.score;
                    session.round = snapshot.round;
                    const mistake = typeof trial.error === 'string' && trial.error.length > 0;
                    return { trial, changed, mistake };
                };
                // Misma preferencia que el jugador de motor: victoria > avance >
                // cierre de la partida (para no dejar la sesion activa abierta).
                let jugada: string | null = null;
                for (const play of candidatas) {
                    const { trial } = sondea(play);
                    if (trial.gameOver && trial.won === true) { jugada = play; break; }
                }
                if (!jugada) {
                    for (const play of candidatas) {
                        const { trial, changed, mistake } = sondea(play);
                        if (!trial.gameOver && !mistake && (trial.valid === true || changed)) { jugada = play; break; }
                    }
                }
                if (!jugada) {
                    for (const play of candidatas) {
                        const { trial } = sondea(play);
                        if (trial.gameOver) { jugada = play; break; }
                    }
                }
                if (!jugada) break;
                await applyGameAction({ gameId: id, action: 'turn', playerText: jugada }, ctx as never);
                if (!getActiveGameSession()) cerrada = true;
            }
            if (!cerrada) fallos.push(`${id}: la partida no cierra la sesion activa al terminar`);
        }
        expect(fallos).toEqual([]);
    }, 60000);
});

// ------------------------------------------------------------
// Guardia estructural: todo final de motor DEBE declarar `won`
// ------------------------------------------------------------
describe('invariante de desenlace declarado', () => {
    it('ningun final de motor (gameOver: true) omite won', () => {
        const dir = join(process.cwd(), 'src/core/games');
        const faltan: string[] = [];
        for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
            faltan.push(...endsWithoutWon(file, readFileSync(join(dir, file), 'utf8').split(/\r?\n/)));
        }
        expect(faltan).toEqual([]);
    });
});

/**
 * Finales de motor (`gameOver: true`) que omiten declarar `won` en su propio
 * objeto. Detector extraido para poder falsificarlo con lineas sinteticas sin
 * tocar los fuentes reales.
 */
export function endsWithoutWon(file: string, lines: string[]): string[] {
    const faltan: string[] = [];
    lines.forEach((line, i) => {
        if (!/gameOver:\s*true/.test(line)) return;
        // Propiedades del PROPIO objeto del return (sin cruzar a vecinos).
        let a = i;
        while (a > 0 && /^\s+[A-Za-z_'"[`]/.test(lines[a - 1]) && !/return|=>/.test(lines[a - 1])) a -= 1;
        let b = i;
        while (b + 1 < lines.length && /^\s+[A-Za-z_'"[`]/.test(lines[b + 1])) b += 1;
        const body = lines.slice(a, b + 1).join('\n');
        if (!/\bwon\b/.test(body)) faltan.push(`${file}:${i + 1}`);
    });
    return faltan;
}

describe('invariante de desenlace declarado - prueba de detector', () => {
    // Prueba de detector: el detector debe marcar el final sintetico SIN won y no
    // el que SI lo declara. Si no discriminara, P2 seria decorativo.
    it('el detector marca el final sin won y no el que lo declara', () => {
        const sinWon = [
            '        return {',
            '            prompt: "x",',
            '            gameOver: true,',
            '        };',
        ];
        expect(endsWithoutWon('malo.ts', sinWon)).toEqual(['malo.ts:3']);
        const conWon = ['        return gameOverResult("x", 0, { won: true });'];
        expect(endsWithoutWon('bueno.ts', conWon)).toEqual([]);
    });
});
