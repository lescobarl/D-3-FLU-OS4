// ============================================================
// demoSeed — el seed de DEMO no re-siembra lo ya existente.
// ------------------------------------------------------------
// Bug real: al cancelar un demo quedaba en status 'deleted'; si el seed
// filtraba solo 'pending', el label desaparecía y se volvía a crear
// (síntoma "borro un registro y reaparecen otros").
// Guard de COMPORTAMIENTO: ejecuta la selección real del seed.
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildDemoAgendaInputs, selectDemoAgendaInputs } from '../src/core/agenda/demoSeed';

const NOW = new Date(2026, 8, 17, 10, 0, 0, 0).getTime();

describe('demoSeed — selectDemoAgendaInputs', () => {
    it('sin existentes devuelve todos los inputs de demo', () => {
        const all = buildDemoAgendaInputs(NOW);
        expect(selectDemoAgendaInputs([], NOW)).toHaveLength(all.length);
    });

    it('un demo cancelado (deleted) NO se vuelve a sembrar', () => {
        const all = buildDemoAgendaInputs(NOW);
        const cancelled = { label: all[0].label };
        const selected = selectDemoAgendaInputs([cancelled], NOW);
        expect(selected.map((i) => i.label)).not.toContain(cancelled.label);
        expect(selected).toHaveLength(all.length - 1);
    });

    it('no re-siembra aunque el existente esté pendiente, hecho o borrado', () => {
        const all = buildDemoAgendaInputs(NOW);
        const existing = all.map((i) => ({ label: i.label }));
        expect(selectDemoAgendaInputs(existing, NOW)).toHaveLength(0);
    });
});
