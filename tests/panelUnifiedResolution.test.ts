// ============================================================
// panelUnifiedResolution — agenda + notas por UN solo resolutor
// ------------------------------------------------------------
// Invariante: los dos elementos del panel derecho resuelven por el MISMO
// árbitro determinista (un solo entendedor de la estructura), y App ya no
// tiene una rama paralela que estructure por IA (nombre/contenido) ni un
// rescate con nombre aparte.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';
import { resolvePanelRescue } from '../src/voice/lib/panelRescue';

const NOW = new Date(2026, 8, 17, 10, 0, 0, 0).getTime();
const OPTS = { now: NOW } as never;

describe('panel derecho — un solo resolutor (árbitro determinista)', () => {
    it('AGENDA y NOTA resuelven por el MISMO árbitro', () => {
        const agenda = resolveDeterministicCommand('recuérdame comprar pan a las 7', OPTS);
        expect(agenda?.matched).toBe(true);
        expect(agenda?.domain).toBe('agendaCommand');

        const nota = resolveDeterministicCommand('apunta comprar pan', OPTS);
        expect(nota?.matched).toBe(true);
        expect(nota?.domain).toBe('note');
    });

    it('una nota con destino+contenido resuelve por el árbitro (sin IA)', () => {
        const r = resolveDeterministicCommand('nota del super con pan y huevo', OPTS);
        expect(r?.matched).toBe(true);
        expect(r?.domain).toBe('note');
        const data = (r?.action as { data?: { label?: string; body?: string } } | null)?.data;
        expect(String(data?.label || '').length).toBeGreaterThan(0);
    });

    it('el rescate del panel cubre agenda y nota, sin duplicar', () => {        expect(resolvePanelRescue({ transcript: 'recuérdame comprar pan a las 7' })?.domain).toBe('agendaCommand');
        expect(resolvePanelRescue({ transcript: 'apunta comprar pan' })?.domain).toBe('note');
        expect(resolvePanelRescue({ transcript: 'apunta comprar pan', resolvedDomains: ['note'] })).toBeNull();
    });

    it('App YA NO estructura la nota por IA ni usa un rescate aparte', () => {
        const app = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');
        expect(app.includes('accion.nombre')).toBe(false);
        expect(app.includes('accion.contenido')).toBe(false);
        expect(app.includes('resolveNoteRescue')).toBe(false);
    });

    it('el schema del LLM ya no pide nombre/contenido de nota', () => {
        const g = readFileSync(join(process.cwd(), 'src/voice/lib/gemini.js'), 'utf8');
        expect(/nombre\s*:/.test(g)).toBe(false);
    });
});
