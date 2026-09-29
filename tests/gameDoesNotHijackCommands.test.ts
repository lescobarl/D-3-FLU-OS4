// @vitest-environment jsdom
// ============================================================
// gameDoesNotHijackCommands - con una partida ACTIVA, el juego NO secuestra
// comandos de otros dominios.
//
// Defecto medido: `resolveGameCommandFromText` solo dejaba pasar el ALTA de nota
// (parseNoteIntentText) y no el borrado, y la lista de reconocimiento era una
// copia parcial de la del arbitro -> se desviaba. Un comando real de notas o
// agenda con la loteria activa caia al paso "cualquier otra cosa -> turn": el
// motor lo consumia como jugada (FLU "seguia el juego", respondia algo del juego
// y NUNCA ejecutaba el comando).
//
// Invariante: si un comando es accionable de otro dominio (notas/agenda), el
// arbitro lo resuelve a SU dominio y el juego lo deja pasar. El juego sigue vivo.
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveGameCommandFromText, isClaimedByOtherDomain } from '../src/voice/lib/gameCommands';
import { resolveDeterministicCommand, resolveStatefulDomains } from '../src/voice/lib/deterministicArbiter';
import { isNoteCommand } from '../src/voice/lib/noteIntentParser';
import { applyGameAction } from '../src/app/gameActions';
import { GAME_IDS, getGameEngine } from '../src/core/games/gameCatalog';
import {
    setActiveGameSession,
    clearActiveGameSession,
    getActiveGameSession,
    isGameSuspended,
    noteGameTurn,
} from '../src/core/games/gameSessionStore';

const LOTERIA_SESSION = {
    id: 'loteria',
    state: { order: [0, 1, 2], cursor: 0, winner: null, phase: 'announce' },
    score: 0,
    round: 1,
};

beforeEach(() => setActiveGameSession(LOTERIA_SESSION as never));
afterEach(() => clearActiveGameSession());

// Frases REALES de la sesion (log del dueno), no variantes curadas.
const NOTE_COMMANDS = [
    'Okay Flow incluye la nota del súper un poco de pan',
    'Okay Flow incluye en la nota del súper insecticida',
    'Okay Flow adiciona en la nota del súper focos',
    'apunta comprar pan',
    'borra la nota del súper',
    'quita la nota de compras',
    'borra todas las notas',
];

describe('con partida activa, un comando de NOTAS se ejecuta (no es jugada)', () => {
    for (const frase of NOTE_COMMANDS) {
        it(`"${frase}" -> dominio note`, () => {
            expect(resolveGameCommandFromText(frase)).toBeNull();
            const arb = resolveDeterministicCommand(frase, { language: 'es' });
            expect(arb.matched).toBe(true);
            expect(arb.domain).toBe('note');
        });
    }
});

const AGENDA_COMMANDS = [
    'Okay Flow borra la junta de comité del jueves',
    'borra la clase de historia del jueves',
    'crea una alarma hoy a las 5:59',
];

describe('con partida activa, un comando de AGENDA se ejecuta (no es jugada)', () => {
    for (const frase of AGENDA_COMMANDS) {
        it(`"${frase}" NO cae en el juego`, () => {
            expect(resolveGameCommandFromText(frase)).toBeNull();
            const arb = resolveDeterministicCommand(frase, { language: 'es' });
            expect(arb.domain).not.toBe('game');
        });
    }
});

describe('el juego sigue funcionando (no se rompio lo validado)', () => {
    it('"siguiente" sigue siendo turno', () => {
        expect(resolveGameCommandFromText('siguiente')).toMatchObject({ action: 'turn' });
    });
    it('una respuesta abierta sigue siendo turno', () => {
        expect(resolveGameCommandFromText('el sol')).toMatchObject({ action: 'turn' });
    });
    it('"salir" termina la partida', () => {
        expect(resolveGameCommandFromText('salir')).toMatchObject({ action: 'end' });
    });
});

// ------------------------------------------------------------
// EL TURNO AJENO, TAMBIEN POR LA RUTA DE LA IA (log del dueño, 16:20 y 16:24)
// ------------------------------------------------------------
// (A) 16:24:36 "Okay flu Crea una cita para mañana a las 3 de la tarde con el doctor"
//     -> 16:24:42 FLU "La carta es: La muerte. La muerte siriqui siaca."
//     La cita SE creaba (su dueño la escribia) y el motor cantaba su carta igual. Con
//     el passthrough del resolutor (arriba) la señal determinista ya no lo hacia: esta
//     orden la pidio la IA en `contract.juego`, y ESA ruta entraba al motor sin
//     preguntar de quien era el turno.
// (B) 16:20:29/16:20:33 "Okay Flow genera una imagen" (la fila de la instruccion
//     duplicada): el fast-path del juego despachaba el turno del mismo texto -> el
//     escritor de filas lo tomaba por otra frase y escribia la SEGUNDA fila
//     (useFluVoiceAssistant: "los fast-paths de estado son EFECTOS del turno; reenviar
//     una re-derivacion haria que el escritor de filas duplicara la fila").
// (C) Lo que pidio el dueño: "debe permitir interactuar con la IA y SUSPENDER el juego
//     ..., en este caso es loteria, pero debe funcionar igual para todos".
// Un solo criterio para los tres: `isClaimedByOtherDomain` (dueño del turno), aplicado
// por el ejecutor del motor y por el ciclo de vida de la partida. Sin ramas por juego.
// ============================================================

/** Arranca una partida REAL (motor del catalogo) para los casos de ejecucion. */
function startActiveGame(id: string = 'loteria'): void {
    const engine = getGameEngine(id as never);
    if (!engine) throw new Error(`sin motor para ${id}`);
    setActiveGameSession(engine.createSession({ rounds: 3 }));
}

/** Contexto real de applyGameAction; `spoken` recoge todo lo que FLU dice. */
function execCtx(spoken: string[] = [], turnText?: string) {
    return {
        languageRef: { current: 'es' },
        conversationActiveRef: { current: false },
        speakFluRef: { current: async (text: string) => { spoken.push(text); } },
        scheduleResumeListening: () => undefined,
        participantIdRef: { current: 'p1' },
        ...(turnText ? { turnText } : {}),
    };
}

const CITA_LOG = 'Okay flu Crea una cita para mañana a las 3 de la tarde con el doctor';
const IMAGEN_LOG = 'Okay Flow genera una imagen';

describe('la orden de juego que la IA pide para un turno AJENO no se ejecuta (log 16:24:42)', () => {
    it('la cita no se convierte en "La carta es..." y la partida queda EN PAUSA', async () => {
        startActiveGame();
        const spoken: string[] = [];
        const antes = getActiveGameSession();
        await applyGameAction(
            { gameId: 'loteria', action: 'turn', playerText: CITA_LOG } as never,
            execCtx(spoken, CITA_LOG) as never,
        );
        expect(spoken, 'el motor no debe hablar en un turno ajeno').toEqual([]);
        expect(getActiveGameSession()).toBe(antes);
        expect((getActiveGameSession()!.state as { cursor: number }).cursor).toBe(0);
        expect(isGameSuspended()).toBe(true);
    });

    it('la imagen del log (16:20:29) tampoco: ni carta ni segunda fila del turno', async () => {
        startActiveGame();
        const spoken: string[] = [];
        await applyGameAction(
            { gameId: 'loteria', action: 'turn', playerText: IMAGEN_LOG } as never,
            execCtx(spoken, IMAGEN_LOG) as never,
        );
        expect(spoken).toEqual([]);
        expect(isGameSuspended()).toBe(true);
    });

    it('falsacion: la MISMA orden sin texto de turno si llega al motor (lo que la bloquea es el dueño)', async () => {
        startActiveGame();
        const spoken: string[] = [];
        await applyGameAction(
            { gameId: 'loteria', action: 'turn', playerText: 'siguiente' } as never,
            execCtx(spoken) as never,
        );
        expect(spoken.length).toBe(1);
    });
});

describe('la partida EN PAUSA deja de consumir turnos, sigue viva y se retoma', () => {
    // Partida real (no la compartida del fichero): la pausa MUTA la sesion activa.
    beforeEach(() => startActiveGame());

    it('control + pausa: la misma respuesta abierta es jugada sin pausa y NO lo es en pausa', () => {
        expect(resolveGameCommandFromText('el sol')).toMatchObject({ action: 'turn' });
        noteGameTurn(false);
        expect(isGameSuspended()).toBe(true);
        expect(resolveGameCommandFromText('el sol')).toBeNull();
        expect(resolveStatefulDomains('el sol', { language: 'es' }).game).toBeNull();
        expect(resolveDeterministicCommand('el sol', { language: 'es' }).domain).not.toBe('game');
    });

    it('una ORDEN del juego la RETOMA sin reiniciar el estado (y ya sin pausa, el motor avanza)', async () => {
        startActiveGame();
        const antes = getActiveGameSession();
        const cursorAntes = (antes!.state as { cursor: number }).cursor;
        noteGameTurn(false);
        // EN PAUSA el motor no consume: 'siguiente' pertenece al turno de su dueno real.
        expect(resolveGameCommandFromText('siguiente')).toBeNull();
        const spoken: string[] = [];
        await applyGameAction(
            { gameId: 'loteria', action: 'start' } as never,
            execCtx(spoken, 'vamos a jugar loteria') as never,
        );
        expect(isGameSuspended()).toBe(false);
        expect(spoken.length).toBe(1);
        expect(getActiveGameSession()).toBe(antes);
        // RETOMADA: el comando del motor vuelve a ser jugada (sin reiniciar el mazo).
        expect(resolveGameCommandFromText('siguiente')).toMatchObject({ action: 'turn' });
        await applyGameAction(
            { gameId: 'loteria', action: 'turn', playerText: 'siguiente' } as never,
            execCtx(spoken, 'siguiente') as never,
        );
        expect((antes!.state as { cursor: number }).cursor).toBe(cursorAntes + 1);
    });

    it('en pausa siguen funcionando salir, menu y cambio; el MOTOR no consume', () => {
        noteGameTurn(false);
        expect(resolveGameCommandFromText('salir del juego')).toMatchObject({ action: 'end' });
        expect(resolveGameCommandFromText('que otro juego podemos jugar')).toMatchObject({ action: 'menu' });
        expect(resolveGameCommandFromText('vamos a jugar trivia')).toMatchObject({ action: 'switch' });
        // El comando propio del motor NO es una orden de juego: en pausa no se consume.
        expect(resolveGameCommandFromText('loteria')).toBeNull();
    });

    it('repetir el arranque del juego activo la retoma (idempotente: no reinicia el mazo)', async () => {
        startActiveGame();
        const antes = getActiveGameSession();
        const cursorAntes = (antes!.state as { cursor: number }).cursor;
        noteGameTurn(false);
        const spoken: string[] = [];
        await applyGameAction(
            { gameId: 'loteria', action: 'start' } as never,
            execCtx(spoken, 'vamos a jugar loteria') as never,
        );
        expect(isGameSuspended()).toBe(false);
        expect(getActiveGameSession()).toBe(antes);
        expect((antes!.state as { cursor: number }).cursor).toBe(cursorAntes);
    });
});

describe('igual para TODOS los juegos del catalogo (sin ramas por juego)', () => {
    for (const id of GAME_IDS) {
        it(`${id}: un turno ajeno no lo consume y lo deja EN PAUSA`, async () => {
            startActiveGame(id);
            const spoken: string[] = [];
            await applyGameAction(
                { gameId: id, action: 'turn', playerText: CITA_LOG } as never,
                execCtx(spoken, CITA_LOG) as never,
            );
            expect(spoken).toEqual([]);
            expect(isGameSuspended()).toBe(true);
            expect(resolveGameCommandFromText('el sol')).toBeNull();
        });
    }
});

describe('dueño del turno - tabla medida: las ordenes del juego no las reclama nadie', () => {
    // Medido con el arbol actual. Si algun dia una orden de juego cae en otro dominio,
    // el gate del ejecutor bloquearia una jugada real: por eso es guard.
    const ORDENES_DEL_JUEGO = [
        'salir del juego', 'cancela el juego', 'terminar el juego', 'ya basta', 'se acabo',
        'que otro juego podemos jugar', 'mas juegos', 'otra cosa',
        'vamos a jugar trivia', 'cambiar a adivinanzas',
        'vamos a jugar loteria', 'loteria', 'siguiente', 'carta', 'la tengo', 'otra',
        'el sol', 'cinco', 'rojo', 'una casa',
    ];
    const TURNOS_AJENOS = [
        IMAGEN_LOG,
        'ok flu genera una imagen de un perro',
        CITA_LOG,
        'apunta comprar pan',
        'agrega leche a la lista de compras',
        'actua como chef',
        'anota en el diario que hoy fue un buen dia',
        'genera un video de un conejo',
    ];

    it('ninguna orden de juego la reclama otro dominio', () => {
        for (const frase of ORDENES_DEL_JUEGO) {
            expect(isClaimedByOtherDomain(frase, { language: 'es' }), frase).toBe(false);
        }
    });

    it('los turnos ajenos (frases reales del log) SI estan reclamados por su dueño', () => {
        for (const frase of TURNOS_AJENOS) {
            expect(isClaimedByOtherDomain(frase, { language: 'es' }), frase).toBe(true);
        }
    });
});

describe('isNoteCommand - fuente unica del passthrough', () => {
    it('reconoce el alta Y el borrado, y no confunde una jugada', () => {
        expect(isNoteCommand('apunta comprar pan')).toBe(true);
        expect(isNoteCommand('incluye la nota del súper pan')).toBe(true);
        expect(isNoteCommand('borra la nota del súper')).toBe(true);
        expect(isNoteCommand('borra todas las notas')).toBe(true);
        expect(isNoteCommand('siguiente carta')).toBe(false);
    });
});

// ------------------------------------------------------------
// Defecto medido en el log del dueño (16:20): con la lotería activa,
// "Okay Flow genera una imagen" se ejecutaba (la imagen SÍ se generaba) pero el
// motor TAMBIÉN consumía el turno y respondía su carta ("La carta es: La muerte"),
// o sea la respuesta iba desalineada del pedido; y el turno se producía dos veces
// (motor + IA), duplicando la fila de la instrucción (16:20:29 / 16:20:33).
//
// Causa raíz: el passthrough del juego era una LISTA PROPIA de dominios
// (agenda/notas/config/navegación) que no incluía la petición visual, compras,
// diario ni ambiente, y el árbitro tenía ADEMÁS un segundo criterio más estrecho
// (`hasAgendaPendingCreate`). Dos criterios para la misma pregunta.
// ------------------------------------------------------------
const OTHER_DOMAIN_TURNS = [
    // Petición visual: el caso del log.
    ['Okay Flow genera una imagen', 'visual'],
    ['ok flu genera una imagen de un perro', 'visual'],
    ['okay flow generame una imagen', 'visual'],
    // Generación declarada (navegación de video/documento).
    ['genera un video de un conejo', 'navegación'],
    // Agenda CON hora (se ejecuta; la partida no responde por encima).
    ['Okay flu Crea una cita para mañana a las 3 de la tarde con el doctor', 'agenda'],
    // Compras, diario y ambiente: dominios que la lista propia no miraba.
    ['agrega leche a la lista de compras', 'compras'],
    ['anota en el diario que hoy fue un buen día', 'diario'],
    ['actúa como chef', 'ambiente'],
];

describe('con partida activa, un turno de OTRO dominio no es jugada (log 16:20)', () => {
    for (const [frase, dominio] of OTHER_DOMAIN_TURNS) {
        it(`"${frase}" no lo consume el motor (${dominio})`, () => {
            // El motor no responde por encima del dueño real.
            expect(resolveGameCommandFromText(frase)).toBeNull();
            // El árbitro no lo etiqueta como juego (una sola producción del turno).
            const arb = resolveDeterministicCommand(frase, { language: 'es' });
            expect(arb.domain).not.toBe('game');
            // La partida sigue viva: no se cerró por dejar pasar el turno.
            expect(getActiveGameSession()?.id).toBe('loteria');
        });
    }

    it('el fast-path del hook no despacha el turno del juego (sin doble producción)', () => {
        // El hook resuelve config/juego/ambiente en paralelo: si `game` viniera
        // con turno, el motor produciría el turno ADEMÁS de la IA → fila duplicada.
        expect(resolveStatefulDomains('Okay Flow genera una imagen', { language: 'es' }).game).toBeNull();
        expect(resolveStatefulDomains('agrega leche a la lista de compras', { language: 'es' }).game).toBeNull();
        expect(resolveStatefulDomains('anota en el diario que hoy fue un buen día', { language: 'es' }).game).toBeNull();
    });

    it('la jugada real sigue siendo jugada (no se rompió lo validado)', () => {
        expect(resolveStatefulDomains('siguiente carta', { language: 'es' }).game)
            .toMatchObject({ action: 'turn' });
        expect(resolveDeterministicCommand('siguiente carta', { language: 'es' }).domain).toBe('game');
        expect(resolveDeterministicCommand('el sol', { language: 'es' }).domain).toBe('game');
    });
});

describe('un solo criterio de "otro dominio reclama el turno" (invariante)', () => {
    it('el criterio vive en un único dueño y el duplicado ya no existe', async () => {
        const { readFileSync, readdirSync, statSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const { dirname, join, resolve } = await import('node:path');
        const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
        const walk = (dir: string): string[] => readdirSync(dir).flatMap((name: string) => {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) return walk(full);
            return /\.(ts|tsx|js)$/.test(name) ? [full] : [];
        });
        const files = walk(src);
        const hits = (needle: string) => files.filter((f: string) => readFileSync(f, 'utf8').includes(needle));
        // El criterio duplicado (más estrecho) del árbitro ya no existe.
        expect(hits('hasAgendaPendingCreate')).toEqual([]);
        // Y el criterio único es el del resolutor del juego (lo consume el árbitro).
        expect(hits('isClaimedByOtherDomain').length).toBeGreaterThan(0);
        expect(readFileSync(resolve(src, 'voice/lib/deterministicArbiter.js'), 'utf8'))
            .toContain('isClaimedByOtherDomain');
    });
});
