// ============================================================
// voiceTurnStabilization.test.ts — Estabilización del turno por
// fragmentos con datos PRODUCTIVOS (frases reales de voz)
// ============================================================
// Cubre Bug #3: "ok flu busca en la web" (corte por pausa del ASR)
// NO debe disparar todavía (ready:false); solo cuando llega la
// consulta completa el turno queda listo.
import { describe, it, expect } from 'vitest';
import { decideVoiceTurnDispatch } from '../src/voice/lib/audioMath';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig';

const voiceCommands = FLU_CONFIG.voiceCommands;

describe('🧪 Estabilización de turno — búsqueda web con datos productivos', () => {
    it('"ok flu busca en la web" (corte del ASR) NO debe despachar: espera la consulta', () => {
        const decision = decideVoiceTurnDispatch('ok flu busca en la web', voiceCommands, { requireWake: true });
        expect(decision.ready).toBe(false);
    });

    it('"ok flu busca en internet" (corte) tampoco despacha', () => {
        const decision = decideVoiceTurnDispatch('ok flu busca en internet', voiceCommands, { requireWake: true });
        expect(decision.ready).toBe(false);
    });

    it('"ok flu busca en la web cómo saltan los conejos" (frase completa) SÍ despacha', () => {
        const decision = decideVoiceTurnDispatch(
            'ok flu busca en la web como saltan los conejos',
            voiceCommands,
            { requireWake: true },
        );
        expect(decision.ready).toBe(true);
    });

    it('"ok flu crea un video" (gatillo pelado) espera el contenido', () => {
        const decision = decideVoiceTurnDispatch('ok flu crea un video', voiceCommands, { requireWake: true });
        expect(decision.ready).toBe(false);
    });

    it('"ok flu crea un video de un conejo saltando" (con contenido) SÍ despacha', () => {
        const decision = decideVoiceTurnDispatch(
            'ok flu crea un video de un conejo saltando',
            voiceCommands,
            { requireWake: true },
        );
        expect(decision.ready).toBe(true);
    });
});
