// @vitest-environment jsdom
// ============================================================
// horarioCompact.test.tsx — Guard del punto 7
// ------------------------------------------------------------
// Invariante: la vista semanal COMPACTA las horas sin agenda; solo
// renderiza las franjas que contienen entradas (no ocupa alto en vacío).
// ============================================================
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { HorarioPizarron } from '../src/components/HorarioPizarron';
import type { HorarioRecord } from '../src/core/db/fluDatabase';

const SYNCHRONIZED_AT = new Date(2026, 0, 15).toISOString();

function clase(overrides: Partial<HorarioRecord> = {}): HorarioRecord {
    return {
        id: overrides.id || 'm1',
        materia: overrides.materia || 'Física',
        dia: overrides.dia ?? 4,
        inicio: overrides.inicio || '08:00',
        fin: overrides.fin || '09:00',
        color: overrides.color || 'm1',
        reminders: [],
        createdAt: 0,
        updatedAt: 0,
        sync: overrides.sync || { revision: 1, updated_at: SYNCHRONIZED_AT, deleted: false },
    } as HorarioRecord;
}

const baseProps = {
    loading: false,
    modo: 'semana' as const,
    onModoChange: () => {},
    onAdd: async () => ({ ok: true }),
    onRemove: async () => {},
};

describe('HorarioPizarron — compacta horas sin agenda', () => {
    it('solo renderiza la franja ocupada (08:00), ocultando las vacías', () => {
        const { container } = render(
            <HorarioPizarron items={[clase({ inicio: '08:00', fin: '09:00' })]} {...baseProps} />,
        );
        const labels = Array.from(container.querySelectorAll('.flu-horario__timelabel')).map(
            (el) => el.textContent,
        );
        expect(labels).toContain('08:00');
        // Con una sola entrada, solo una franja: no se renderiza el resto del rango.
        expect(labels.length).toBe(1);
    });

    it('con dos entradas en horas distintas, solo esas dos franjas', () => {
        const { container } = render(
            <HorarioPizarron
                items={[
                    clase({ id: 'a', inicio: '08:00', fin: '09:00' }),
                    clase({ id: 'b', inicio: '12:00', fin: '13:00' }),
                ]}
                {...baseProps}
            />,
        );
        const labels = Array.from(container.querySelectorAll('.flu-horario__timelabel')).map(
            (el) => el.textContent,
        );
        expect(labels).toEqual(['08:00', '12:00']);
    });
});

describe('HorarioPizarron — punto 9: sin etiqueta por defecto "Detalles" al embeber', () => {
    it('con hideHeader NO renderiza <details>/<summary> (el navegador pintaba "Detalles")', () => {
        const { container } = render(
            <HorarioPizarron items={[clase()]} {...baseProps} hideHeader />,
        );
        expect(container.querySelector('details')).toBeNull();
        expect(container.querySelector('summary')).toBeNull();
        expect(container.querySelector('.flu-horario__embedded')).not.toBeNull();
    });

    it('sin hideHeader sí muestra el resumen con el título', () => {
        const { container } = render(<HorarioPizarron items={[clase()]} {...baseProps} />);
        expect(container.querySelector('summary')).not.toBeNull();
    });
});
