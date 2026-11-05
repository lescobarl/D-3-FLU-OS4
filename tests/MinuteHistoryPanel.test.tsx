// @vitest-environment jsdom
// ============================================================
// MinuteHistoryPanel - lista presentacional del historial de minutas.
// ------------------------------------------------------------
// El módulo bajo prueba (jsx) NO se mockea. Su colaborador real,
// formatMinuteHistoryLabel (minuteKnowledge), también queda real: es la
// fuente de la etiqueta que se pinta. Se cubre estado vacío, lista,
// selección por id, aviso de selección y robustez sin handler.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MinuteHistoryPanel } from '../src/voice/components/MinuteHistoryPanel.jsx';
import { formatMinuteHistoryLabel } from '../src/voice/lib/minuteKnowledge.js';
import type { MinuteUIEntry } from '../src/hooks/useMinuteKnowledge';

// Entradas parciales: la etiqueta solo depende de historyCode/description/
// summarySnapshot.titulo, así que basta con esos campos para la conducta.
const ENTRIES = [
    { id: 'a', historyCode: '2026-01-01-1', description: 'Primera minuta' },
    { id: 'b', historyCode: '2026-01-02-2', summarySnapshot: { titulo: 'Segunda minuta' } },
] as unknown as MinuteUIEntry[];

const filas = () => screen.getAllByRole('listitem');

describe('MinuteHistoryPanel - estado vacío', () => {
    it('sin entradas y con emptyLabel muestra el aviso compacto', () => {
        render(<MinuteHistoryPanel entries={[]} emptyLabel="Sin minutas guardadas" />);

        const aviso = screen.getByText('Sin minutas guardadas');
        expect(aviso.className).toContain('panel__hint');
        expect(aviso.className).toContain('panel__hint--compact');
    });

    it('sin entradas y sin emptyLabel no pinta nada', () => {
        const { container } = render(<MinuteHistoryPanel />);

        expect(container.firstChild).toBeNull();
    });
});

describe('MinuteHistoryPanel - lista de entradas', () => {
    it('pinta una lista con un item por entrada', () => {
        render(<MinuteHistoryPanel entries={ENTRIES} />);

        expect(screen.getByRole('list')).toBeTruthy();
        expect(filas()).toHaveLength(2);
    });

    it('cada fila muestra la etiqueta formateada como texto y title', () => {
        render(<MinuteHistoryPanel entries={ENTRIES} />);

        filas().forEach((fila, i) => {
            const etiqueta = formatMinuteHistoryLabel(ENTRIES[i]);
            expect(fila.textContent).toBe(etiqueta);
            expect(fila.getAttribute('title')).toBe(etiqueta);
        });
    });

    it('cada fila es un botón de tipo button', () => {
        render(<MinuteHistoryPanel entries={ENTRIES} />);

        for (const fila of filas()) {
            expect((fila as HTMLButtonElement).type).toBe('button');
        }
    });

    it('marca como seleccionada la fila cuyo id coincide con selectedId', () => {
        render(<MinuteHistoryPanel entries={ENTRIES} selectedId="b" />);

        expect(filas()[1].className).toContain('minute-history__row--selected');
        expect(filas()[0].className).not.toContain('minute-history__row--selected');
    });

    it('sin selectedId ninguna fila queda marcada', () => {
        render(<MinuteHistoryPanel entries={ENTRIES} />);

        for (const fila of filas()) {
            expect(fila.className).not.toContain('minute-history__row--selected');
        }
    });

    it('selectedId inexistente no marca ninguna fila', () => {
        render(<MinuteHistoryPanel entries={ENTRIES} selectedId="zzz" />);

        for (const fila of filas()) {
            expect(fila.className).not.toContain('minute-history__row--selected');
        }
    });
});

describe('MinuteHistoryPanel - selección', () => {
    it('al pulsar una fila avisa onSelect con la entrada exacta', () => {
        const onSelect = vi.fn();
        render(<MinuteHistoryPanel entries={ENTRIES} onSelect={onSelect} />);

        fireEvent.click(filas()[1]);

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith(ENTRIES[1]);
    });

    it('sin onSelect el clic no lanza', () => {
        render(<MinuteHistoryPanel entries={ENTRIES} />);

        expect(() => fireEvent.click(filas()[0])).not.toThrow();
    });
});
