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
import type { GameEngine } from '../src/core/games/gameEngine';
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
        it(`[${kind}] modificar -> la etiqueta cambia`, async () => {
            const svc = makeService();
            await svc.create({ kind, label: 'Antes', trigger: { type: 'absolute', at: AT }, personId: 'p1' });
            const [item] = await svc.list({ personId: 'p1' });
            await svc.update(item.id, { label: 'Despues' });
            expect((await svc.list({ personId: 'p1' })).map((i) => i.label)).toEqual(['Despues']);
        });
        it(`[${kind}] completar -> sale de pendientes`, async () => {
            const svc = makeService();
            await svc.create({ kind, label: 'X', trigger: { type: 'absolute', at: AT }, personId: 'p1' });
            const [item] = await svc.list({ personId: 'p1' });
            await svc.complete(item.id);
            expect(await svc.list({ personId: 'p1', status: 'pending' })).toHaveLength(0);
        });
        it(`[${kind}] vaciar -> solo el usuario indicado`, async () => {
            const svc = makeService();
            await svc.create({ kind, label: 'A', trigger: { type: 'absolute', at: AT }, personId: 'p1' });
            await svc.create({ kind, label: 'B', trigger: { type: 'absolute', at: AT }, personId: 'p1' });
            await svc.create({ kind, label: 'C', trigger: { type: 'absolute', at: AT }, personId: 'p2' });
            await svc.clearAll({ personId: 'p1' });
            // Vaciar es baja logica: el invariante es que no quedan PENDIENTES.
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
// ------------------------------------------------------------
// G6 --- SUPERFICIE DE COMANDOS DE CADA MOTOR (auto-descubierta, sin listas).
// Cada modulo publica sus tablas *_FRAMES como dato. Contrato, en dos partes:
//   a) la tabla de FIN la entiende el ENRUTADOR (dueno unico de la salida): cada
//      frame declarado ahi DEBE resolver `end` por la ruta real. Un motor que
//      declare una salida que el enrutador no conoce deja la frase sin efecto:
//      llega al motor como jugada (en el cuento colaborativo, hasta se agregaba
//      a la historia) y el nino no puede salir con sus propias palabras.
//   b) el resto de frames los entiende el MOTOR: ninguno puede ser INDISTINGUIBLE
//      DE LA BASURA en su fase. No basta con que `isGameCommand` lo reclame: eso
//      solo anuncia el frame, no lo atiende.
// Fase de respuesta: los frames de afirmacion/negacion solo aplican cuando el
// jugador piensa y el asistente adivina, fase que se alcanza consumiendo un
// frame de CAMBIO (SWAP). Se deriva de los propios datos del modulo.
// La semilla del RNG es fija: con azar real el prompt cambia entre corridas y el
// contrato "atiende el frame" no se puede medir.
// ------------------------------------------------------------
describe('G6 superficie de comandos de cada motor (auto-descubierta)', () => {
    const modules = import.meta.glob('../src/core/games/*.ts', { eager: true }) as Record<string, Record<string, unknown>>;
    const GIBBERISH = 'zzqx wvvv plof';
    const sign = (r: { error?: string; valid?: boolean; gameOver?: boolean; prompt?: string; animation?: string; emotion?: string }) =>
        JSON.stringify({
            error: r.error ?? null,
            valid: r.valid === true,
            gameOver: r.gameOver === true,
            // El PROMPT entra en la firma: un control que solo repite lo mismo que
            // el camino de la basura es dato muerto aunque cambie la emocion.
            prompt: r.prompt ?? null,
            animation: r.animation ?? null,
            emotion: r.emotion ?? null,
        });
    const run = (engine: GameEngine, warmup: string[], text: string) => {
        const cfg = { random: () => 0.5 };
        const session = engine.createSession(cfg);
        engine.start(session, cfg);
        for (const w of warmup) engine.turn(session, w);
        return sign(engine.turn(session, text));
    };
    it('cada frame declarado se ATIENDE (fin: enrutador; resto: motor)', () => {
        const mismatches: string[] = [];
        const noSurface: string[] = [];
        const discovered = new Set<string>();
        let tables = 0;
        let frames = 0;
        let engines = 0;
        for (const [path, mod] of Object.entries(modules)) {
            const declared: Record<string, string[]> = {};
            for (const [key, value] of Object.entries(mod)) {
                if (!key.endsWith('_COMMAND_FRAMES') || !value || typeof value !== 'object') continue;
                for (const [table, list] of Object.entries(value as Record<string, unknown>)) {
                    if (Array.isArray(list)) {
                        tables += 1;
                        declared[table] = list as string[];
                    }
                }
            }
            const factory = Object.entries(mod).find(
                ([k, v]) => /^create[A-Za-z]+Engine$/.test(k) && typeof v === 'function',
            )?.[1] as (() => GameEngine) | undefined;
            if (!factory) continue;
            if (!Object.keys(declared).length) {
                noSurface.push(path);
                continue;
            }
            engines += 1;
            discovered.add(factory().id);
            const engine = factory();
            const swap = declared.SWAP_FRAMES?.[0];
            for (const [table, list] of Object.entries(declared)) {
                for (const frame of list) {
                    frames += 1;
                    // (a) Tabla de FIN: la atiende el ENRUTADOR (dueno unico de la
                    // salida). Se verifica contra la ruta REAL, no contra lo que el
                    // motor declara: declarar una salida que el enrutador no conoce
                    // deja la frase sin efecto.
                    if (table === 'END_FRAMES') {
                        setActiveGameSession(sessionOf(engine.id));
                        const salida = resolveGameCommandFromText(frame);
                        clearActiveGameSession();
                        if (salida?.action !== 'end') {
                            mismatches.push(`${path} :: ${engine.id} declara "${frame}" (${table}) pero el enrutador no lo resuelve como fin: ${JSON.stringify(salida)}`);
                        }
                        continue;
                    }
                    // (b) El RESTO de frames los atiende el MOTOR. Fase de respuesta
                    // (afirmar/negar) alcanzada por un frame de cambio.
                    const warmup = table === 'AFFIRMATIVE_FRAMES' || table === 'NEGATIVE_FRAMES'
                        ? (swap ? [swap] : [])
                        : [];
                    const deadHere = run(engine, warmup, frame) === run(engine, warmup, GIBBERISH);
                    const deadBase = !warmup.length && run(engine, [], frame) === run(engine, [], GIBBERISH);
                    if (deadHere && deadBase) {
                        mismatches.push(`${path} :: ${engine.id} declara "${frame}" (${table}) pero es indistinguible de la basura (control no atendido por el motor)`);
                    }
                }
            }
        }
        expect({ engines: engines >= 20, tables: tables >= 60, frames: frames >= 200 }).toEqual({
            engines: true, tables: true, frames: true,
        });
        expect(mismatches).toEqual([]);
        // Anti-deriva: ningun motor sin superficie publicada, y la superficie
        // descubierta cubre TODO el catalogo (si se anade un juego sin publicar
        // sus comandos, esto es rojo).
        expect(noSurface).toEqual([]);
        expect(GAME_CATALOG.map((g) => g.id).filter((id) => !discovered.has(id))).toEqual([]);
    });
});
// ------------------------------------------------------------
// G7 --- VARIANTES DE RUIDO DEL ASR (eco, repeticion, ruido, truncado).
// Invariante: una variante NUNCA puede producir una decision DISTINTA a la base;
// solo la misma decision, o ninguna (equivalente a la basura). Cubre la clase de
// defecto del eco de la orden de arranque.
// ------------------------------------------------------------
describe('G7 variantes de ruido ASR: la variante no cambia la decision', () => {
    const GIBBERISH = 'zzqx wvvv plof';
    const noiseVariants = (base: string) => [
        { name: 'eco', text: `${base} ${base}` },
        { name: 'eco-con-wake', text: `ok flow ${base} ${base}` },
        { name: 'ruido-prefijo', text: `eh ${base}` },
        { name: 'truncado', text: base.slice(0, Math.max(1, base.length - 2)) },
    ];
    it('orden de arranque + ruido: nunca accion de partida ni victoria', () => {
        const bad: string[] = [];
        for (const entry of GAME_CATALOG) {
            const order = `vamos a jugar ${entry.aliases[0]}`;
            const engine = getGameEngine(entry.id);
            const s = () => {
                const session = engine!.createSession();
                engine!.start(session, {});
                return session;
            };
            for (const v of noiseVariants(order)) {
                const dec = resolveGameCommandFromText(v.text);
                if (dec && dec.action === 'turn') bad.push(`${entry.id} :: ${v.name} -> turn`);
                const r = engine!.turn(s(), v.text);
                if (r.won === true || r.gameOver === true) bad.push(`${entry.id} :: ${v.name} termina la partida`);
            }
        }
        expect(bad).toEqual([]);
    });
    it('frases de agenda + ruido: accion y objeto intactos; etiqueta intacta sin perdida', () => {
        const noop = JSON.stringify(parseAgendaCommand(GIBBERISH, { now: () => AT }));
        // El recorte del ASR pierde informacion de la etiqueta: se exige accion y
        // objeto, no la etiqueta. El resto de variantes no tienen perdida.
        const lossy = new Set(['truncado']);
        const bad: string[] = [];
        for (const kind of AGENDA_KINDS) {
            for (const base of [`borra todas las ${kind}s`, `borra la ${kind} de historia`]) {
                const ref = parseAgendaCommand(base, { now: () => AT });
                for (const v of noiseVariants(base)) {
                    const got = parseAgendaCommand(v.text, { now: () => AT });
                    const raw = JSON.stringify(got);
                    if (raw === noop) continue;
                    if (lossy.has(v.name)) {
                        if (got.action !== ref.action || got.kind !== ref.kind) {
                            bad.push(`${v.name} "${v.text}" -> ${raw} (base ${JSON.stringify(ref)})`);
                        }
                        continue;
                    }
                    if (raw !== JSON.stringify(ref)) bad.push(`${v.name} "${v.text}" -> ${raw} (base ${JSON.stringify(ref)})`);
                }
            }
        }
        expect(bad).toEqual([]);
    });
});
