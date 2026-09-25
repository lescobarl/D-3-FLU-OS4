// @vitest-environment jsdom
// ============================================================
// reportedScenariosSimulation — simula los escenarios reportados
// ------------------------------------------------------------
// 1) RECETA:  la respuesta hablada larga se reparte en chunks SIN perder texto
//             y el prompt ya NO enruta "paso a paso" como documento.
// 2) JUNTA:   etiqueta limpia ("hazme …" fuera) + hoy 22:00.
// 3) JUEGO:   ciclo (avanza), salir, y NO secuestra comandos de agenda.
// ============================================================
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitSpeechChunks } from '../src/voice/lib/fluSpeech';
import { parseAgendaCommand } from '../src/core/agenda/agendaCommandParser';
import { resolveGameCommandFromText } from '../src/voice/lib/gameCommands';
import {
    setActiveGameSession,
    clearActiveGameSession,
    getActiveGameSession,
} from '../src/core/games/gameSessionStore';
import { createLoteriaEngine } from '../src/core/games/loteria';

// ------------------------------------------------------------
// 1) RECETA — no se pierde texto al hablar
// ------------------------------------------------------------
const RECETA =
    'Claro que sí, aquí tienes un remedio casero paso a paso para esa tos. ' +
    'Ingredientes: 1 limón, 1 cucharada de miel, media cucharadita de jengibre rallado. ' +
    'Pasos: 1. Exprime el jugo de medio limón en una taza. 2. Añade la cucharada de miel y mezcla bien. ' +
    '3. Incorpora el jengibre rallado y mezcla de nuevo. 4. Toma una cucharadita cada pocas horas. ' +
    '¿Por qué funciona? El limón reduce la inflamación, la miel recubre la garganta y el jengibre es antiinflamatorio. ' +
    '¡Espero que te sientas mejor muy pronto!';

describe('RECETA — el habla cubre el texto completo', () => {
    it('los chunks juntos contienen TODO (no se corta en el preámbulo)', () => {
        const chunks = splitSpeechChunks(RECETA, 180);
        expect(chunks.length).toBeGreaterThan(1);
        const spoken = chunks.join(' ').replace(/\s+/g, ' ');
        for (const key of ['remedio casero', 'Ingredientes', 'jengibre', 'Pasos', 'Toma una cucharadita', '¿Por qué funciona?', 'muy pronto']) {
            expect(spoken).toContain(key);
        }
    });

    it('el prompt YA NO manda "paso a paso"/recetas a documento', () => {
        const g = readFileSync(join(process.cwd(), 'src', 'voice', 'lib', 'gemini.js'), 'utf8');
        expect(g).toContain('NUNCA enrutes como documento');
        expect(g).toContain('paso a paso');
        expect(g).toContain('respuesta_voz');
    });
});

// ------------------------------------------------------------
// 2) JUNTA — etiqueta limpia y hoy 22:00
// ------------------------------------------------------------
describe('JUNTA — "hazme una junta para hoy a las 10:00 de la noche liberación de procesos"', () => {
    const NOW = new Date(2026, 8, 17, 20, 23, 0, 0).getTime(); // jueves 20:23

    it('kind junta, etiqueta limpia (sin "hazme") y hoy 22:00', () => {
        const r = parseAgendaCommand(
            'Okay flu hazme una junta para hoy a las 10:00 de la noche liberación de procesos',
            { now: NOW },
        );
        expect(r.handled).toBe(true);
        expect(r.action).toBe('agenda.create');
        expect(r.kind).toBe('junta');
        const label = String(r.label || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
        expect(label).toBe('liberacion procesos');
        expect(r.trigger?.type).toBe('absolute');
        const at = (r.trigger as { at: number }).at;
        expect(new Date(at).getHours()).toBe(22);
        const a = new Date(NOW);
        const b = new Date(at);
        expect(new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()).toBe(
            new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime(),
        ); // hoy
    });
});

// ------------------------------------------------------------
// 3) JUEGO — ciclo, salir y pass-through
// ------------------------------------------------------------
function seeded(seed = 3) {
    let s = seed;
    return () => {
        s = (s * 1103515245 + 12345) % 2147483648;
        return s / 2147483648;
    };
}

describe('JUEGO (lotería) — simulación de partida', () => {
    afterEach(() => clearActiveGameSession());

    it('arranca, avanza con "sí"/"siguiente" sin repetir la carta (sin ciclo)', () => {
        const engine = createLoteriaEngine({ random: seeded() });
        const session = engine.createSession({});
        const start = engine.start(session, {});
        setActiveGameSession(session as never);

        const cantadas: string[] = [start.prompt];
        for (const dicho of ['sí', 'siguiente', 'continúa', 'otra', 'dale']) {
            // El enrutador lo clasifica como turno de juego (no como comando ajeno).
            expect(resolveGameCommandFromText(dicho)).toMatchObject({ action: 'turn' });
            const r = engine.turn(session, dicho);
            cantadas.push(r.prompt);
        }
        // 6 cartas cantadas, todas distintas (el mazo avanza; no hay ciclo).
        expect(new Set(cantadas).size).toBe(cantadas.length);
    });

    it('un comando de ALARMA durante el juego pasa de largo y el juego sigue activo', () => {
        const engine = createLoteriaEngine({ random: seeded() });
        const session = engine.createSession({});
        engine.start(session, {});
        setActiveGameSession(session as never);

        // El juego NO lo consume: se ejecuta por la ruta normal.
        expect(resolveGameCommandFromText('crea una alarma hoy a las 5:59')).toBeNull();
        // El juego sigue en curso (la partida no se perdió).
        expect(getActiveGameSession()).not.toBeNull();
        // Y puede seguir avanzando.
        expect(resolveGameCommandFromText('siguiente')).toMatchObject({ action: 'turn' });
    });

    it('"salir" termina el juego y luego no queda partida activa', () => {
        const engine = createLoteriaEngine({ random: seeded() });
        const session = engine.createSession({});
        engine.start(session, {});
        setActiveGameSession(session as never);

        expect(resolveGameCommandFromText('salir')).toMatchObject({ action: 'end' });
        // App aplica `end` → limpia la sesión (App.tsx:865). Simulamos esa limpieza.
        clearActiveGameSession();
        expect(getActiveGameSession()).toBeNull();
        // Sin partida activa, un comando normal no inicia nada.
        expect(resolveGameCommandFromText('crea una alarma hoy a las 5:59')).toBeNull();
    });
});
