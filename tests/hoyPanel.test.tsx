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
    it('renderiza HOY y NOTAS, y NO el bloque DIARIO (pedido quitar)', () => {
        const { container } = render(<HoyPanel {...props()} />);

        expect(container.querySelector('[data-testid="hoy-panel"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="hoy-block"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="diario-block"]')).toBeNull();
        // NOTAS se muestra expandido por defecto (details open), como el resto.
        const notas = container.querySelector('[data-testid="notas-block"]');
        expect(notas).not.toBeNull();
        expect(notas!.hasAttribute('open')).toBe(true);
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

    it('no renderiza el bloque DIARIO (pedido quitar del panel)', () => {
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

        expect(container.querySelector('[data-testid="diario-block"]')).toBeNull();
        expect(container.querySelector('[data-testid="diario-ultima"]')).toBeNull();
        expect(container.querySelector('[data-testid="diario-mood"]')).toBeNull();
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

    it('notas: sin checkbox, con expandir (clic) y editar (✎ → onRename)', () => {
        const onRename = vi.fn(async () => null);
        const { container } = render(
            <HoyPanel
                {...props({
                    notes: {
                        notes: [nota({ id: 'nota-1', label: 'Comprar leche', done: false })],
                        loading: false,
                        onToggle: async () => null,
                        onRemove: async () => true,
                        onRename,
                    },
                })}
            />
        );

        const pendientes = container.querySelector('[data-testid="notas-pendientes"]');
        expect(pendientes).not.toBeNull();
        // Sin checkbox: la nota no se marca hecha.
        expect(pendientes!.querySelector('input[type="checkbox"]')).toBeNull();

        // Expandir el texto de la nota al hacer clic.
        const expand = container.querySelector('[data-testid="nota-expand-nota-1"]') as HTMLElement;
        expect(expand).not.toBeNull();
        fireEvent.click(expand);
        expect(expand.className).toContain('card-title--expanded');

        // Editar en línea: ✎ → input → blur persiste vía onRename.
        const editBtn = container.querySelector('[data-testid="nota-edit-btn-nota-1"]') as HTMLElement;
        expect(editBtn).not.toBeNull();
        fireEvent.click(editBtn);
        const input = container.querySelector('[data-testid="nota-edit-nota-1"]') as HTMLInputElement;
        expect(input).not.toBeNull();
        fireEvent.change(input, { target: { value: 'Comprar pan' } });
        fireEvent.blur(input);
        expect(onRename).toHaveBeenCalledWith('nota-1', 'Comprar pan');
    });

    it('muestra "Detener" cuando una alarma está sonando y llama a onStopRinging', () => {
        const onStop = vi.fn();
        const { container } = render(
            <HoyPanel
                {...props({
                    temporals: {
                        alarms: [],
                        timers: [],
                        loading: false,
                        ringing: { id: 'a1', kind: 'alarm', label: 'Despertar' },
                        onStopRinging: onStop,
                    },
                })}
            />
        );

        const stopBtn = container.querySelector('[data-testid="temporal-stop"]');
        expect(stopBtn).not.toBeNull();
        expect(container.querySelector('[data-testid="temporal-ringing"]')!.textContent).toContain(
            'Despertar',
        );
        fireEvent.click(stopBtn!);
        expect(onStop).toHaveBeenCalledTimes(1);
    });

    it('citas y alarmas: ✎ edita en línea (onEdit) como las notas', () => {
        const onRemEdit = vi.fn(async () => null);
        const onTempEdit = vi.fn(async () => null);
        const sync = { revision: 1, updated_at: SYNCHRONIZED_AT, deleted: false };
        const { container } = render(
            <HoyPanel
                {...props({
                    reminders: {
                        items: [
                            {
                                id: 'r1',
                                text: 'Cita con Ana',
                                dueAt: NOW + 3600000,
                                status: 'pending',
                                createdAt: NOW,
                                updatedAt: NOW,
                                sync,
                            } as any,
                        ],
                        loading: false,
                        onRemove: async () => {},
                        onEdit: onRemEdit,
                    },
                    temporals: {
                        alarms: [
                            {
                                id: 'a1',
                                kind: 'alarm',
                                label: 'Despertar',
                                trigger: { kind: 'countdown', at: NOW, durationMs: 1000 },
                                recurrence: { kind: 'once' },
                                nextAt: NOW + 3600000,
                                status: 'pending',
                                createdAt: NOW,
                                updatedAt: NOW,
                                sync,
                            } as any,
                        ],
                        timers: [],
                        loading: false,
                        onCancel: async () => {},
                        onEdit: onTempEdit,
                    },
                })}
            />
        );

        // Cita (agenda)
        const remBtn = container.querySelector('[data-testid="reminder-edit-btn-r1"]');
        expect(remBtn).not.toBeNull();
        fireEvent.click(remBtn!);
        const remInput = container.querySelector('[data-testid="reminder-edit-r1"]') as HTMLInputElement;
        expect(remInput).not.toBeNull();
        fireEvent.change(remInput, { target: { value: 'Cita con Ana y Luis' } });
        fireEvent.blur(remInput);
        expect(onRemEdit).toHaveBeenCalledWith('r1', 'Cita con Ana y Luis');

        // Alarma
        const tempBtn = container.querySelector('[data-testid="temporal-edit-btn-a1"]');
        expect(tempBtn).not.toBeNull();
        fireEvent.click(tempBtn!);
        const tempInput = container.querySelector('[data-testid="temporal-edit-a1"]') as HTMLInputElement;
        fireEvent.change(tempInput, { target: { value: 'Despertar 6am' } });
        fireEvent.blur(tempInput);
        expect(onTempEdit).toHaveBeenCalledWith('a1', { label: 'Despertar 6am' });
    });
});
