// ============================================================
// injectedValues — batería de entradas para DETECTAR DESVIACIONES
// ------------------------------------------------------------
// Tabla data-driven sobre la RUTA REAL (árbitro determinista + motor de juego).
// No busca un texto exacto frágil: valida PROPIEDADES (kind/acción, día/hora y
// que la etiqueta NO arrastre andamiaje y SÍ contenga el contenido). Cualquier
// desviación falla con la frase exacta en el mensaje.
// ============================================================
import { describe, it, expect, afterEach } from 'vitest';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';
import { resolveGameCommandFromText } from '../src/voice/lib/gameCommands';
import { setActiveGameSession, clearActiveGameSession } from '../src/core/games/gameSessionStore';
import { createLoteriaEngine } from '../src/core/games/loteria';

// Jueves 2026-09-17 10:00 local.
const NOW = new Date(2026, 8, 17, 10, 0, 0, 0).getTime();

const tokens = (v: unknown) =>
    String(v || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean);

const dayDiff = (from: number, to: number) => {
    const a = new Date(from);
    const b = new Date(to);
    const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
    const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
    return Math.round((db - da) / 86_400_000);
};

type AgendaCase = {
    phrase: string;
    kind?: string;
    action?: string;
    must?: string[];   // tokens que la etiqueta DEBE contener
    forbid?: string[]; // tokens de andamiaje que NO deben quedar
    day?: number;
    hour?: number;
};

const AGENDA: AgendaCase[] = [
    { phrase: 'crea una cita con el dentista mañana a las 4 de la tarde', kind: 'cita', must: ['dentista'], forbid: ['cita', 'manana', 'crea'], day: 1, hour: 16 },
    { phrase: 'hazme una junta para hoy a las 10:00 de la noche liberación de procesos', kind: 'junta', must: ['liberacion', 'procesos'], forbid: ['junta', 'hoy', 'hazme'], day: 0, hour: 22 },
    { phrase: 'recuérdame regar las plantas mañana a las 7', kind: 'recordatorio', must: ['regar', 'plantas'], forbid: ['manana', 'recuerdame'], day: 1, hour: 7 },
    { phrase: 'crea un recordatorio para mañana que me recuerde tomar la medicina a las 9:00 a.m', kind: 'recordatorio', must: ['tomar', 'medicina'], forbid: ['recuerde', 'recordatorio', 'manana'], day: 1, hour: 9 },
    { phrase: 'pon una alarma para las 6 de la mañana', kind: 'alarma', must: ['alarma'], day: 1, hour: 6 },
    { phrase: 'despiértame mañana a las 5:30', kind: 'alarma', must: ['alarma'], forbid: ['manana'], day: 1, hour: 5 },
    { phrase: 'Okay flow crea una cita para mañana a las 3 de la tarde con el homeópata', kind: 'cita', must: ['homeopata'], forbid: ['cita', 'con', 'flow'], day: 1, hour: 15 },
    { phrase: 'crea una cita para con el doctor a las 3 de la tarde es el homeópata', kind: 'cita', must: ['doctor', 'homeopata'], forbid: ['cita', 'con', 'es'], hour: 15 },
    { phrase: 'pon un recordatorio para el sábado a las 8 para sacar la basura', kind: 'recordatorio', must: ['sacar', 'basura'], forbid: ['sabado', 'para', 'recordatorio'], day: 2, hour: 8 },
    { phrase: 'ponme un despertador a las 6', kind: 'alarma', must: ['alarma'], forbid: ['ponme'], day: 1, hour: 6 },
    { phrase: 'borra la cita con el dentista', action: 'agenda.cancel', kind: 'cita', must: ['dentista'] },
    { phrase: 'cancela la alarma de las 7', action: 'agenda.cancel', kind: 'alarma' },
    { phrase: 'quita matemáticas del viernes', action: 'agenda.cancel', kind: 'clase', must: ['matematicas'] },
    { phrase: 'borra toda la agenda', action: 'agenda.clear' },
];

describe('INYECCIÓN — agenda (ruta real del árbitro)', () => {
    it.each(AGENDA.map((c) => [c.phrase, c] as const))('%s', (_label, c) => {
        const r = resolveDeterministicCommand(c.phrase, { now: NOW } as never);
        expect(r?.domain, `dominio de "${c.phrase}"`).toBe('agendaCommand');
        const a = r?.action as {
            handled?: boolean; action?: string; kind?: string; label?: string;
            trigger?: { type: string; at?: number; timeOfDay?: string };
        };
        if (c.action) expect(a?.action, `acción de "${c.phrase}"`).toBe(c.action);
        if (c.kind) expect(a?.kind, `kind de "${c.phrase}"`).toBe(c.kind);

        if (c.must || c.forbid) {
            const t = new Set(tokens(a?.label));
            for (const w of c.must || []) expect(t.has(w), `etiqueta "${a?.label}" debe contener "${w}" (${c.phrase})`).toBe(true);
            for (const w of c.forbid || []) expect(t.has(w), `etiqueta "${a?.label}" NO debe contener "${w}" (${c.phrase})`).toBe(false);
        }
        if (c.day !== undefined || c.hour !== undefined) {
            expect(a?.trigger?.type, `trigger de "${c.phrase}"`).toBe('absolute');
            const at = a?.trigger?.at as number;
            if (c.day !== undefined) expect(dayDiff(NOW, at), `día de "${c.phrase}"`).toBe(c.day);
            if (c.hour !== undefined) expect(new Date(at).getHours(), `hora de "${c.phrase}"`).toBe(c.hour);
        }
    });
});

// ------------------------------------------------------------
type NoteCase = { phrase: string; must?: string[]; forbid?: string[] };
const NOTAS: NoteCase[] = [
    { phrase: 'apunta comprar pan', must: ['comprar', 'pan'], forbid: ['apunta'] },
    { phrase: 'nota para el super', must: ['super'], forbid: ['nota'] },
    { phrase: 'nota del super', must: ['super'] },
    { phrase: 'crea una lista para el súper en las notas que traiga jabón pan huevo y queso', must: ['jabon', 'queso'], forbid: ['notas', 'crea', 'traiga'] },
    { phrase: 'una nota del super con pan y huevo', must: ['pan'] },
];

describe('INYECCIÓN — notas (ruta real del árbitro)', () => {
    it.each(NOTAS.map((c) => [c.phrase, c] as const))('%s', (_label, c) => {
        const r = resolveDeterministicCommand(c.phrase, { now: NOW } as never);
        expect(r?.domain, `dominio de "${c.phrase}"`).toBe('note');
        const data = (r?.action as { data?: { label?: string; body?: string } } | null)?.data;
        const t = new Set([...tokens(data?.label), ...tokens(data?.body)]);
        for (const w of c.must || []) expect(t.has(w), `nota "${data?.label ?? ''}|${data?.body ?? ''}" debe contener "${w}" (${c.phrase})`).toBe(true);
        for (const w of c.forbid || []) expect(t.has(w), `nota "${data?.label ?? ''}|${data?.body ?? ''}" NO debe contener "${w}" (${c.phrase})`).toBe(false);
    });
});

// ------------------------------------------------------------
const LOTERIA_SESSION = { id: 'loteria', state: { order: [0, 1, 2, 3], cursor: 0, winner: null, phase: 'announce' }, score: 0, round: 1 };
const JUEGO_ACTIVO: Array<[string, 'turn' | 'end' | null]> = [
    ['siguiente', 'turn'],
    ['sí', 'turn'],
    ['continúa', 'turn'],
    ['otra', 'turn'],
    ['dale', 'turn'],
    ['repite', 'turn'],
    ['lotería', 'turn'],
    ['crea una alarma hoy a las 5:59', null], // NO secuestra agenda
    ['apunta comprar pan', null],             // NO secuestra notas
    ['que hora es', null],                    // la responde la IA
    ['salir', 'end'],
    ['basta', 'end'],
    ['terminar', 'end'],
];

describe('INYECCIÓN — juego activo (no secuestra; salir; avanzar)', () => {
    afterEach(() => clearActiveGameSession());

    it.each(JUEGO_ACTIVO)('%s → %s', (phrase, expected) => {
        setActiveGameSession(LOTERIA_SESSION as never);
        const r = resolveGameCommandFromText(phrase);
        if (expected === null) expect(r, `"${phrase}" no debe ser turno de juego`).toBeNull();
        else expect(r?.action, `acción de "${phrase}"`).toBe(expected);
    });

    it('sin partida: intención de empezar → start; comando ajeno → null', () => {
        clearActiveGameSession();
        expect(resolveGameCommandFromText('juguemos a la lotería')?.action).toBe('start');
        expect(resolveGameCommandFromText('crea una alarma hoy a las 5:59')).toBeNull();
    });

    it('el mazo avanza sin repetir carta al decir "sí" repetido', () => {
        const engine = createLoteriaEngine({ random: (() => { let s = 5; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; })() });
        const session = engine.createSession({});
        const start = engine.start(session, {});
        setActiveGameSession(session as never);
        const cantadas = [start.prompt, engine.turn(session, 'sí').prompt, engine.turn(session, 'sí').prompt, engine.turn(session, 'sí').prompt];
        expect(new Set(cantadas).size).toBe(cantadas.length);
    });
});
