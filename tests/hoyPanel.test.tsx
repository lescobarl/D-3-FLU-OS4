// @vitest-environment jsdom
// ============================================================
// Validación de render del panel lateral "Hoy" (Paso 2 del
// Pizarrón consolidado). Monta HoyPanel con datos de ejemplo y
// verifica que los tres bloques <details> (HOY / DIARIO / NOTAS)
// renderizan correctamente con los datos provistos por props.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { HoyPanel, type HoyPanelProps } from '../src/components/HoyPanel';
import type { HorarioRecord, DiaryEntryRecord, NoteRecord } from '../src/core/db/fluDatabase';

const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime(); // Jueves 10:00
const SYNCHRONIZED_AT = new Date(NOW).toISOString();

function horario(overrides: Partial<HorarioRecord> = {}): HorarioRecord {
    return {
        id: overrides.id || 'hor-1',
        materia: overrides.materia || 'Matemáticas',
        dia: overrides.dia ?? 4,
        inicio: overrides.inicio || '08:00',
        fin: overrides.fin || '09:00',
        aula: overrides.aula,
        color: overrides.color || 'm1',
        reminders: [],
        createdAt: overrides.createdAt ?? NOW,
        updatedAt: overrides.updatedAt ?? NOW,
        sync: overrides.sync || { revision: 1, updated_at: SYNCHRONIZED_AT, deleted: false },
    };
}

function diario(overrides: Partial<DiaryEntryRecord> = {}): DiaryEntryRecord {
    return {
        id: overrides.id || 'dia-1',
        date: overrides.date || '2026-01-15',
        title: overrides.title ?? 'Mi día',
        content: overrides.content || 'Hoy fue un buen día.',
        mood: overrides.mood ?? 4,
        createdAt: overrides.createdAt ?? NOW,
        updatedAt: overrides.updatedAt ?? NOW,
        sync: overrides.sync || { revision: 1, updated_at: SYNCHRONIZED_AT, deleted: false },
    };
}

function nota(overrides: Partial<NoteRecord> = {}): NoteRecord {
    return {
        id: overrides.id || 'nota-1',
        label: overrides.label || 'Comprar leche',
        done: overrides.done ?? false,
        createdAt: overrides.createdAt ?? NOW,
        updatedAt: overrides.updatedAt ?? NOW,
        sync: overrides.sync || { revision: 1, updated_at: SYNCHRONIZED_AT, deleted: false },
    };
}

function props(overrides: Partial<HoyPanelProps> = {}): HoyPanelProps {
    return {
        horario: {
            items: [horario({ id: 'hor-1', materia: 'Química', dia: 4, inicio: '12:00', fin: '13:00' })],
            loading: false,
            modo: 'semana',
            onModoChange: () => {},
            onAdd: async () => ({ ok: true }),
            onRemove: async () => {},
        },
        diary: {
            entries: [diario()],
            loading: false,
        },
        notes: {
            notes: [nota({ id: 'nota-1', label: 'Comprar leche', done: false })],
            loading: false,
            onToggle: async () => null,
            onRemove: async () => true,
        },
        now: () => NOW,
        language: 'es',
        ...overrides,
    };
}

describe('HoyPanel — render del panel lateral', () => {
    it('renderiza el aside y los tres bloques HOY/DIARIO/NOTAS', () => {
        const { container } = render(<HoyPanel {...props()} />);

        expect(container.querySelector('[data-testid="hoy-panel"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="hoy-block"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="diario-block"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="notas-block"]')).not.toBeNull();
    });

    it('muestra la próxima clase y las clases del día en el bloque HOY', () => {
        const { container } = render(
            <HoyPanel
                {...props({
                    horario: {
                        items: [
                            horario({ id: 'hor-1', materia: 'Química', dia: 4, inicio: '12:00', fin: '13:00' }),
                            horario({ id: 'hor-2', materia: 'Física', dia: 4, inicio: '07:00', fin: '08:00' }),
                        ],
                        loading: false,
                        modo: 'semana',
                        onModoChange: () => {},
                        onAdd: async () => ({ ok: true }),
                        onRemove: async () => {},
                    },
                })}
            />
        );

        // Próxima clase (después de las 10:00 del jueves) → Química 12:00
        const proxima = container.querySelector('[data-testid="hoy-proxima-clase"]');
        expect(proxima).not.toBeNull();
        expect(proxima!.textContent).toContain('Química');
        expect(proxima!.textContent).toContain('12:00–13:00');

        // Clases del día (jueves, día 4) → Física y Química ordenadas
        const lista = container.querySelector('[data-testid="hoy-clases-list"]');
        expect(lista).not.toBeNull();
        expect(lista!.textContent).toContain('Física');
        expect(lista!.textContent).toContain('Química');
    });

    it('muestra mensaje vacío cuando no hay próxima clase ni clases hoy', () => {
        const { container } = render(
            <HoyPanel
                {...props({
                    horario: {
                        items: [],
                        loading: false,
                        modo: 'semana',
                        onModoChange: () => {},
                        onAdd: async () => ({ ok: true }),
                        onRemove: async () => {},
                    },
                })}
            />
        );

        expect(container.querySelector('[data-testid="hoy-proxima-clase"]')).toBeNull();
        expect(container.querySelector('[data-testid="hoy-clases-list"]')).toBeNull();
        const hoyBlock = container.querySelector('[data-testid="hoy-block"]');
        expect(hoyBlock!.textContent).toContain('Sin próxima entrada');
    });

    it('muestra la última entrada del diario con su ánimo', () => {
        const { container } = render(
            <HoyPanel
                {...props({
                    diary: {
                        entries: [diario({ id: 'dia-1', title: 'Mi día', content: 'Hoy fue un buen día.', mood: 4 })],
                        loading: false,
                    },
                })}
            />
        );

        const ultima = container.querySelector('[data-testid="diario-ultima"]');
        expect(ultima).not.toBeNull();
        expect(ultima!.textContent).toContain('Mi día');
        expect(ultima!.textContent).toContain('Hoy fue un buen día.');
        expect(container.querySelector('[data-testid="diario-mood"]')).not.toBeNull();
    });

    it('muestra mensaje vacío cuando el diario no tiene entradas', () => {
        const { container } = render(
            <HoyPanel
                {...props({
                    diary: { entries: [], loading: false },
                })}
            />
        );

        expect(container.querySelector('[data-testid="diario-ultima"]')).toBeNull();
        const diarioBlock = container.querySelector('[data-testid="diario-block"]');
        expect(diarioBlock!.textContent).toContain('Aún no hay entradas en el diario.');
    });

    it('separa notas pendientes y hechas en listas distintas', () => {
        const { container } = render(
            <HoyPanel
                {...props({
                    notes: {
                        notes: [
                            nota({ id: 'nota-1', label: 'Comprar leche', done: false }),
                            nota({ id: 'nota-2', label: 'Terminar tarea', done: true }),
                        ],
                        loading: false,
                        onToggle: async () => null,
                        onRemove: async () => true,
                    },
                })}
            />
        );

        const pendientes = container.querySelector('[data-testid="notas-pendientes"]');
        const hechas = container.querySelector('[data-testid="notas-hechas"]');
        expect(pendientes).not.toBeNull();
        expect(pendientes!.textContent).toContain('Comprar leche');
        expect(hechas).not.toBeNull();
        expect(hechas!.textContent).toContain('Terminar tarea');
    });

    it('dispara onRemove al pulsar el botón de quitar nota', () => {
        const onRemove = vi.fn(async () => true);
        const { container } = render(
            <HoyPanel
                {...props({
                    notes: {
                        notes: [nota({ id: 'nota-1', label: 'Comprar leche', done: false })],
                        loading: false,
                        onToggle: async () => null,
                        onRemove,
                    },
                })}
            />
        );

        const removeBtn = container.querySelector('[data-testid="nota-remove-nota-1"]');
        expect(removeBtn).not.toBeNull();
        fireEvent.click(removeBtn!);
        expect(onRemove).toHaveBeenCalledWith('nota-1');
    });

    it('expande el horario completo al pulsar "Ver horario completo"', () => {
        const { container } = render(<HoyPanel {...props()} />);

        expect(container.querySelector('[data-testid="hoy-horario-completo"]')).toBeNull();
        const verHorario = container.querySelector('[data-testid="hoy-ver-horario"]');
        expect(verHorario).not.toBeNull();
        fireEvent.click(verHorario!);
        expect(container.querySelector('[data-testid="hoy-horario-completo"]')).not.toBeNull();
    });
});
