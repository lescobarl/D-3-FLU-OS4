// ============================================================
// Validación de render del panel de confirmación de importación
// de horario (digitalización → HOY). Monta HorarioImportConfirm
// con entradas estructuradas de ejemplo y verifica que:
//   - Renderiza título, contador, hint y la lista de entradas.
//   - Muestra materia, día, tipo, inicio–fin y aula por entrada.
//   - Los botones Confirmar/Descartar disparan sus callbacks.
//   - En estado busy deshabilita ambos botones y muestra "Guardando…".
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { HorarioImportConfirm } from '../src/components/WorkspaceHub';
import type { HorarioClaseEstructurada } from '../src/core/horario/horarioService';

function entrada(overrides: Partial<HorarioClaseEstructurada> = {}): HorarioClaseEstructurada {
    return {
        materia: 'Matemáticas',
        tipo: 'Escuela',
        dia: 1,
        inicio: '08:00',
        fin: '09:00',
        aula: 'A-101',
        ...overrides,
    };
}

describe('HorarioImportConfirm — render del panel de confirmación', () => {
    it('renderiza título, contador, hint y lista de entradas (es)', () => {
        const { container } = render(
            <HorarioImportConfirm
                pending={[entrada(), entrada({ materia: 'Consulta IMSS', tipo: 'Médico', dia: 3, inicio: '10:30', fin: '11:30', aula: 'Consultorio 2' })]}
                busy={false}
                onConfirm={async () => {}}
                onCancel={() => {}}
                language="es"
            />
        );

        const section = container.querySelector('[data-testid="horario-import-confirm"]');
        expect(section).not.toBeNull();

        // Título y contador plural
        expect(section!.textContent).toContain('Leí un horario en la imagen');
        expect(section!.textContent).toContain('2 entradas detectadas');

        // Hint
        expect(section!.textContent).toContain('Revisa las entradas detectadas');

        // Entradas: materia, día, tipo, inicio–fin, aula
        expect(section!.textContent).toContain('Matemáticas');
        expect(section!.textContent).toContain('Lunes');
        expect(section!.textContent).toContain('Escuela');
        expect(section!.textContent).toContain('08:00–09:00');
        expect(section!.textContent).toContain('A-101');
        expect(section!.textContent).toContain('Consulta IMSS');
        expect(section!.textContent).toContain('Miércoles');
        expect(section!.textContent).toContain('Médico');
        expect(section!.textContent).toContain('10:30–11:30');
        expect(section!.textContent).toContain('Consultorio 2');

        // Botones
        expect(section!.textContent).toContain('Descartar');
        expect(section!.textContent).toContain('Confirmar y guardar');
    });

    it('usa el contador singular cuando hay una sola entrada', () => {
        const { container } = render(
            <HorarioImportConfirm
                pending={[entrada()]}
                busy={false}
                onConfirm={async () => {}}
                onCancel={() => {}}
                language="es"
            />
        );
        const section = container.querySelector('[data-testid="horario-import-confirm"]');
        expect(section!.textContent).toContain('1 entrada detectada');
    });

    it('omite tipo/aula cuando no están presentes', () => {
        const { container } = render(
            <HorarioImportConfirm
                pending={[entrada({ tipo: undefined, aula: undefined })]}
                busy={false}
                onConfirm={async () => {}}
                onCancel={() => {}}
                language="es"
            />
        );
        const section = container.querySelector('[data-testid="horario-import-confirm"]');
        // No debe contener el separador " · " de tipo/aula vacíos
        expect(section!.textContent).not.toContain('Lunes ·');
        expect(section!.textContent).not.toContain('08:00–09:00 ·');
    });

    it('dispara onConfirm al pulsar Confirmar y onCancel al pulsar Descartar', () => {
        const onConfirm = vi.fn(async () => {});
        const onCancel = vi.fn(() => {});
        const { container } = render(
            <HorarioImportConfirm
                pending={[entrada()]}
                busy={false}
                onConfirm={onConfirm}
                onCancel={onCancel}
                language="es"
            />
        );

        const buttons = container.querySelectorAll('button');
        const cancelBtn = Array.from(buttons).find((b) => b.textContent === 'Descartar');
        const confirmBtn = Array.from(buttons).find((b) => b.textContent === 'Confirmar y guardar');

        fireEvent.click(cancelBtn!);
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();

        fireEvent.click(confirmBtn!);
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('en estado busy deshabilita ambos botones y muestra "Guardando…"', () => {
        const { container } = render(
            <HorarioImportConfirm
                pending={[entrada()]}
                busy={true}
                onConfirm={async () => {}}
                onCancel={() => {}}
                language="es"
            />
        );
        const buttons = container.querySelectorAll('button');
        expect(buttons.length).toBe(2);
        buttons.forEach((b) => expect((b as HTMLButtonElement).disabled).toBe(true));
        expect(container.textContent).toContain('Guardando…');
    });

    it('respeta el idioma en (en)', () => {
        const { container } = render(
            <HorarioImportConfirm
                pending={[entrada()]}
                busy={false}
                onConfirm={async () => {}}
                onCancel={() => {}}
                language="en"
            />
        );
        const section = container.querySelector('[data-testid="horario-import-confirm"]');
        expect(section!.textContent).toContain('I read a schedule in the image');
        expect(section!.textContent).toContain('1 entry detected');
        expect(section!.textContent).toContain('Confirm and save');
        expect(section!.textContent).toContain('Discard');
    });
});
