// ============================================================
// MATRIZ DE SISTEMA --- derivada de los REGISTROS reales, no de listas a mano.
//
// Espacio generado (no enumerado):
//   G1 Juegos      x conductas : GAME_CATALOG x {arrancar, orden-de-arranque,
//                               ciclo entrar/salir/re-entrar, cambiar, menu,
//                               frames de fin, colision motor}
//   G2 Objetos     x acciones  : AGENDA_KINDS x {crear, borrar-con-etiqueta,
//                               borrar-CONJUNTO, conservadurismo singular, listar,
//                               modificar, vaciar} sobre servicio REAL + DB memoria
//   G3 Comandos de voz x frames: END_GAME_FRAMES, GAME_MENU_FRAMES, wake words (config)
//   G4 Diferencial de puertas  : arbitro vs resolutor de juego -> UN solo veredicto
//   G5 Guardia anti-deriva     : todo elemento de todo registro debe quedar cubierto
//
// Sin listas de juegos/objetos/comandos: se iteran las fuentes unicas.
// ============================================================
import { describe, it, expect, afterEach } from 'vitest';
import {
    GAME_CATALOG,
    END_GAME_FRAMES,
    GAME_MENU_FRAMES,
    getGameEngine,
} from '../src/core/games/gameCatalog';
import { resolveGameCommandFromText } from '../src/voice/lib/gameCommands';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter.js';
import { setActiveGameSession, clearActiveGameSession } from '../src/core/games/gameSessionStore';
import { AGENDA_KINDS, type AgendaKind } from '../src/core/agenda/agendaModel';
import { parseAgendaCommand } from '../src/core/agenda/agendaCommandParser';
import { createAgendaService, type AgendaDb } from '../src/core/agenda/agendaService';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig';
import type { GameSession } from '../src/core/games/types';
import type { AgendaItem } from '../src/core/agenda/agendaModel';
const AT = new Date('2026-09-23T11:00:00').getTime();
// Cobertura observada (guardia anti-deriva, G5).
const covered = { games: new Set<string>(), kinds: new Set<string>(), endFrames: new Set<string>(), menuFrames: new Set<string>(), wakes: new Set<string>() };
function sessionOf(id: string): GameSession {
    return { id, state: {}, score: 0, round: 1 } as unknown as GameSession;
}
function makeDb(): AgendaDb {
    const map = new Map<string, AgendaItem>();
    return {
        async add(item) { map.set(item.id, { ...item, sync: { ...item.sync } }) },
        async put(item) { map.set(item.id, { ...item, sync: { ...item.sync } }) },
        async bulkPut(items) { for (const i of items) map.set(i.id, { ...i, sync: { ...i.sync } }) },
        async delete(id) { map.delete(id) },
        async get(id) { return map.get(id) },
        async toArray() { return Array.from(map.values()).map((i) => ({ ...i, sync: { ...i.sync } })) },
    };
}
let seq = 0;
function makeService() {
    return createAgendaService({ db: makeDb(), now: () => AT, newId: () => `m-${++seq}` });
}
// ------------------------------------------------------------
// G1 --- JUEGOS x CONDUCTAS (derivado de GAME_CATALOG)
// ------------------------------------------------------------
describe('G1 juegos x conductas (derivado del catalogo)', () => {
    afterEach(() => clearActiveGameSession());
    for (const entry of GAME_CATALOG) {
        const order = `vamos a jugar ${entry.aliases[0]}`;
        it(`[${entry.id}] arranca con prompt y sin fin de partida`, () => {
            covered.games.add(entry.id);
            const engine = getGameEngine(entry.id);
            expect(engine).toBeTruthy();
            const r = engine!.start(engine!.createSession(), {});
            expect(typeof r.prompt).toBe('string');
            expect(r.prompt.length).toBeGreaterThan(0);
            expect(r.gameOver).toBeFalsy();
        });
        it(`[${entry.id}] su ORDEN DE ARRANQUE no la consume como accion de partida`, () => {
            // Muro de la clase "loteria": el nombre del juego puede colisionar con
            // un frame interno del motor y terminar la partida al arrancar.
            const engine = getGameEngine(entry.id)!;
            const session = engine.createSession();
            engine.start(session, {});
            const r = engine.turn(session, order);
            expect({ won: r.won === true, gameOver: r.gameOver === true }).toEqual({ won: false, gameOver: false });
        });
        it(`[${entry.id}] el router no enruta su arranque como turno`, () => {
            setActiveGameSession(sessionOf(entry.id));
            expect(resolveGameCommandFromText(order)?.action).not.toBe('turn');
        });
        it(`[${entry.id}] ciclo entrar -> salir -> re-entrar`, () => {
            clearActiveGameSession();
            expect(resolveGameCommandFromText(order)).toEqual({ gameId: entry.id, action: 'start' });
            setActiveGameSession(sessionOf(entry.id));
            expect(resolveGameCommandFromText('salir del juego')).toEqual({ gameId: entry.id, action: 'end' });
            clearActiveGameSession();
            expect(resolveGameCommandFromText(order)).toEqual({ gameId: entry.id, action: 'start' });
        });
    }
    it('cambiar de juego activo a otro: switch al pedido', () => {
        for (const entry of GAME_CATALOG) {
            const other = GAME_CATALOG.find((g) => g.id !== entry.id);
            if (!other) continue;
            setActiveGameSession(sessionOf(entry.id));
            expect(resolveGameCommandFromText(`vamos a jugar ${other.aliases[0]}`)).toEqual({
                gameId: other.id,
                action: 'switch',
            });
        }
        clearActiveGameSession();
    });
    it('G3 salir del juego: TODO frame de fin resuelve end con partida activa', () => {
        setActiveGameSession(sessionOf('loteria'));
        for (const frame of END_GAME_FRAMES) {
            covered.endFrames.add(frame);
            expect({ frame, r: resolveGameCommandFromText(frame) }).toEqual({
                frame,
                r: { gameId: 'loteria', action: 'end' },
            });
        }
    });
    it('G3 menu de juegos: TODO frame de menu resuelve menu', () => {
        setActiveGameSession(sessionOf('loteria'));
        for (const frame of GAME_MENU_FRAMES) {
            covered.menuFrames.add(frame);
            expect(resolveGameCommandFromText(frame)?.action).toBe('menu');
        }
    });
    it('G4 diferencial de puertas: arbitro y resolutor de juego coinciden', () => {
        const mismatches: string[] = [];
        for (const entry of GAME_CATALOG) {
            const order = `vamos a jugar ${entry.aliases[0]}`;
            clearActiveGameSession();
            const viaResolver = resolveGameCommandFromText(order);
            const viaArbiter = resolveDeterministicCommand(order, { now: AT });
            if (viaArbiter?.domain === 'game' && JSON.stringify(viaArbiter.action) !== JSON.stringify(viaResolver)) {
                mismatches.push(`${entry.id}: arbiter=${JSON.stringify(viaArbiter.action)} resolver=${JSON.stringify(viaResolver)}`);
            }
        }
        expect(mismatches).toEqual([]);
        clearActiveGameSession();
    });
});
// ------------------------------------------------------------
// G2 --- OBJETOS x ACCIONES (derivado de AGENDA_KINDS) sobre servicio real
// ------------------------------------------------------------
describe('G2 agenda: objetos x acciones (derivado de AGENDA_KINDS)', () => {
    const plural = (k: AgendaKind) => `${k}s`; // regla: el plural de las 5 kinds es +s
    for (const kind of AGENDA_KINDS) {
        it(`[${kind}] crear -> existe en el servicio`, async () => {
            covered.kinds.add(kind);
            const svc = makeService();
            const created = await svc.create({ kind, label: 'X', trigger: { type: 'absolute', at: AT }, personId: 'p1' });
            expect(created.ok).toBe(true);
            expect(await svc.list({ personId: 'p1', status: 'pending' })).toHaveLength(1);
        });
        it(`[${kind}] borrar con ETIQUETA cae solo el nombrado`, async () => {
            const svc = makeService();
            await svc.create({ kind, label: 'Historia', trigger: { type: 'absolute', at: AT }, personId: 'p1' });
            await svc.create({ kind, label: 'Mate', trigger: { type: 'absolute', at: AT }, personId: 'p1' });
            const cmd = parseAgendaCommand(`borra la ${kind} de historia`, { now: () => AT });
            expect(cmd.action).toBe('agenda.cancel');
            expect(cmd.kind).toBe(kind);
            const n = await svc.cancelByTarget({ personId: 'p1', kind, target: cmd.label || '' });
            expect(n).toBe(1);
            const left = await svc.list({ personId: 'p1', status: 'pending' });
            expect(left).toHaveLength(1);
            expect(left[0].label).toBe('Mate');
        });
        it(`[${kind}] CONJUNTO: cuantificador y plural caen todo el tipo, aislado por usuario`, async () => {
            const svc = makeService();
            await svc.create({ kind, label: 'A', trigger: { type: 'absolute', at: AT }, personId: 'p1' });
            await svc.create({ kind, label: 'B', trigger: { type: 'absolute', at: AT }, personId: 'p1' });
            await svc.create({ kind, label: 'C', trigger: { type: 'absolute', at: AT }, personId: 'p2' });
            for (const phrase of [`borra todas las ${plural(kind)}`, `borra los ${plural(kind)}`]) {
                const cmd = parseAgendaCommand(phrase, { now: () => AT });
                expect({ phrase, action: cmd.action, kind: cmd.kind, label: cmd.label }).toEqual({
                    phrase, action: 'agenda.cancel', kind, label: '',
                });
            }
            const n = await svc.cancelByTarget({ personId: 'p1', kind, target: '' });
            expect(n).toBe(2);
            expect(await svc.list({ personId: 'p1', status: 'pending' })).toHaveLength(0);
            expect(await svc.list({ personId: 'p2', status: 'pending' })).toHaveLength(1);
        });
        it(`[${kind}] conservadurismo: el singular desnudo NO arrastra el conjunto`, () => {
            const cmd = parseAgendaCommand(`borra el ${kind}`, { now: () => AT });
            expect(cmd.action).toBe('agenda.cancel');
            expect(cmd.kind).toBe(kind);
            expect(cmd.label).not.toBe('');
        });
    }
    it('vaciado total: "borra toda la agenda" es clear, no cancel', () => {
        expect(parseAgendaCommand('borra toda la agenda', { now: () => AT }).action).toBe('agenda.clear');
    });
});
// ------------------------------------------------------------
// G3 --- COMANDOS DE VOZ x VARIANTES DE WAKE (derivado de la config)
// ------------------------------------------------------------
describe('G3 wake words: la variante no cambia la decision', () => {
    const base = 'borra todas las clases';
    const reference = parseAgendaCommand(base, { now: () => AT });
    it('toda wake word de la config produce la MISMA decision', () => {
        const wakes: string[] = FLU_CONFIG.voiceCommands?.wakeWords || [];
        expect(wakes.length).toBeGreaterThan(0);
        const mismatches: string[] = [];
        for (const wake of wakes) {
            covered.wakes.add(wake);
            const variant = `${wake} ${base}`;
            const got = parseAgendaCommand(variant, { now: () => AT });
            if (JSON.stringify(got) !== JSON.stringify(reference)) {
                mismatches.push(`${variant} -> ${JSON.stringify(got)}`);
            }
        }
        expect(mismatches).toEqual([]);
    });
});
// ------------------------------------------------------------
// G5 --- GUARDIA ANTI-DERIVA: ningun elemento de ningun registro sin cubrir
// ------------------------------------------------------------
describe('G5 cobertura completa de los registros (anti-deriva)', () => {
    it('todo juego, objeto, frame y wake de las fuentes unicas quedo ejercitado', () => {
        const missing = {
            games: GAME_CATALOG.map((g) => g.id).filter((id) => !covered.games.has(id)),
            kinds: [...AGENDA_KINDS].filter((k) => !covered.kinds.has(k)),
            endFrames: END_GAME_FRAMES.filter((f) => !covered.endFrames.has(f)),
            menuFrames: GAME_MENU_FRAMES.filter((f) => !covered.menuFrames.has(f)),
            wakes: (FLU_CONFIG.voiceCommands?.wakeWords || []).filter((w) => !covered.wakes.has(w)),
        };
        expect(missing).toEqual({ games: [], kinds: [], endFrames: [], menuFrames: [], wakes: [] });
    });
});
