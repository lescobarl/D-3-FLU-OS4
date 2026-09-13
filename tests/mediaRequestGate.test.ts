// ============================================================
// mediaRequestGate.test.ts — Guard de idempotencia de medios
// ------------------------------------------------------------
// Invariante: el MISMO comando de video/documento NO debe regenerar dentro de
// la ventana (el ASR re-captura el mismo pedido y re-cobraría). Un comando
// distinto siempre pasa; el mismo comando vuelve a pasar tras la ventana.
// ============================================================
import { describe, expect, it } from 'vitest';
import { createMediaRequestGate } from '../src/core/media/mediaRequestGate';

describe('mediaRequestGate — una generación por comando', () => {
    it('omite el mismo comando dentro de la ventana (evita re-cobrar)', () => {
        const gate = createMediaRequestGate(120000);
        expect(gate.shouldRun('video', 'generame un video de un perro', 1000)).toBe(true);
        expect(gate.shouldRun('video', 'generame un video de un perro', 2000)).toBe(false);
    });

    it('permite un comando distinto', () => {
        const gate = createMediaRequestGate(120000);
        expect(gate.shouldRun('video', 'video A', 1000)).toBe(true);
        expect(gate.shouldRun('video', 'video B', 2000)).toBe(true);
    });

    it('permite el mismo comando después de la ventana', () => {
        const gate = createMediaRequestGate(1000);
        expect(gate.shouldRun('video', 'mismo', 1000)).toBe(true);
        expect(gate.shouldRun('video', 'mismo', 2500)).toBe(true);
    });

    it('normaliza espacios y mayúsculas', () => {
        const gate = createMediaRequestGate(120000);
        expect(gate.shouldRun('video', '  Video   de PERRO ', 1000)).toBe(true);
        expect(gate.shouldRun('video', 'video de perro', 1500)).toBe(false);
    });

    it('video y documento son claves distintas', () => {
        const gate = createMediaRequestGate(120000);
        expect(gate.shouldRun('video', 'mismo tema', 1000)).toBe(true);
        expect(gate.shouldRun('doc', 'mismo tema', 1500)).toBe(true);
    });

    it('reset() vuelve a permitir', () => {
        const gate = createMediaRequestGate(120000);
        expect(gate.shouldRun('video', 'x', 1000)).toBe(true);
        expect(gate.shouldRun('video', 'x', 1500)).toBe(false);
        gate.reset();
        expect(gate.shouldRun('video', 'x', 2000)).toBe(true);
    });
});
