// @vitest-environment node
// ============================================================
// resolveVoiceCommand — entrada única wake-first (invariante)
// ------------------------------------------------------------
// Fija el comportamiento de la "ruta única": sin wake word →
// NUNCA comando ni IA (ambiente); con wake word → pasa por el
// árbitro determinista y, si no matchea, a la IA.
// ============================================================
import { describe, it, expect } from 'vitest';
import { resolveVoiceCommand } from '../src/voice/lib/deterministicArbiter';

const WAKE = ['ok flu', 'oye flu'];

describe('resolveVoiceCommand — ruta única (wake-first)', () => {
    it('sin wake → ambiente (ni comando ni IA)', () => {
        const r = resolveVoiceCommand('generame un video', { requireWake: true, wakeWords: WAKE });
        expect(r.kind).toBe('ambient');
        expect(r.command).toBeNull();
        expect(r.domain).toBeNull();
    });

    it('sin wake y frase de comando → sigue siendo ambiente (no lanza comando)', () => {
        const r = resolveVoiceCommand('crea una cita para mañana', { requireWake: true, wakeWords: WAKE });
        expect(r.kind).toBe('ambient');
        expect(r.command).toBeNull();
    });

    it('con wake + comando → command vía árbitro', () => {
        const r = resolveVoiceCommand('ok flu pon una alarma a las 7', { requireWake: true, wakeWords: WAKE });
        expect(r.kind).toBe('command');
        expect(r.domain).toBe('temporal');
    });

    it('con wake + recordatorio → command vía árbitro', () => {
        const r = resolveVoiceCommand('ok flu recuérdame comprar leche mañana a las 9', { requireWake: true, wakeWords: WAKE });
        expect(r.kind).toBe('command');
        expect(r.domain).toBe('reminder');
    });

    it('con wake + consulta genérica → flu (IA)', () => {
        const r = resolveVoiceCommand('ok flu cuéntame de los conejos', { requireWake: true, wakeWords: WAKE });
        expect(r.kind).toBe('flu');
        expect(r.command).toBeNull();
    });

    it('sin requerir wake (conversación) y con contenido → flu (IA extrae el intent)', () => {
        const r = resolveVoiceCommand('genera un video de un conejo', { requireWake: false, wakeWords: WAKE });
        expect(r.kind).toBe('flu');
    });
});
