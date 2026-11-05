// ============================================================
// scheduleAdapter.test.ts — Guard del adaptador OCR→horario (punto 11)
// ------------------------------------------------------------
// Invariante: un documento GENÉRICO no debe proponer importar un horario.
// Solo se propone cuando el texto parece un horario real (≥ minEntries).
// ============================================================
import { describe, expect, it } from 'vitest';
import { createScheduleAdapter } from '../src/core/documents/scheduleAdapter';
import { structureHorarioText } from '../src/core/agenda/agendaShared';

const adapter = createScheduleAdapter({ minEntries: 2 });

describe('scheduleAdapter — propone solo horarios reales', () => {
    it('horario con 2 entradas → propone', () => {
        const proposal = adapter.propose(
            'Lunes\nMatemáticas 08:00 - 09:30 Aula 3\nMartes\nFísica 10:00 - 11:00',
        );
        expect(proposal).not.toBeNull();
        expect(proposal!.adapterId).toBe('horario');
        expect(proposal!.items).toHaveLength(2);
    });

    it('documento NO-horario con una hora → NO propone (falso positivo evitado)', () => {
        const proposal = adapter.propose(
            'Reunión de padres el lunes de 08:00 a 09:00 en el salón 3',
        );
        expect(proposal).toBeNull();
    });

    it('carta con un rango horario → NO propone', () => {
        const proposal = adapter.propose(
            'Querida familia:\nEl lunes tenemos una cita a las 08:00 - 09:00 con el doctor',
        );
        expect(proposal).toBeNull();
    });

    it('tarea sin días → NO propone', () => {
        expect(
            adapter.propose('Tarea de matemáticas. Entrega mañana a las 10:00. Resolver 3+4'),
        ).toBeNull();
    });

    it('el umbral es configurable: minEntries=1 permite una sola entrada', () => {
        const lenient = createScheduleAdapter({ minEntries: 1 });
        expect(lenient.propose('lunes 8:00 a 9:00 clase de ingles')).not.toBeNull();
    });
});

describe('structureHorarioText — orden inline "Día HH:MM-HH:MM Materia"', () => {
    it('toma la materia DESPUÉS del rango, no el día', () => {
        const items = structureHorarioText('Lunes 08:00-09:00 Matemáticas');
        expect(items).toHaveLength(1);
        expect(items[0].materia).toBe('Matemáticas');
        expect(items[0].dia).toBe(1);
    });
});
