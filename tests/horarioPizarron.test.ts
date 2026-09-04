// ============================================================
// Tests para los helpers puros del HorarioPizarron
// ============================================================
// proximaClaseDe (próxima clase con wrap de semana) y
// clasesDelDia (filtro + orden) son funciones puras exportadas
// del componente para pruebas deterministas.
// ============================================================
import { describe, it, expect } from 'vitest';
import type { HorarioRecord } from '../src/core/db/fluDatabase';
import { proximaClaseDe, clasesDelDia } from '../src/components/HorarioPizarron';

const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime(); // Jueves 10:00
const HORA = 60 * 60 * 1000;
const SYNCHRONIZED_AT = new Date(NOW).toISOString();

function clase(overrides: Partial<HorarioRecord> = {}): HorarioRecord {
  return {
    id: overrides.id || 'hor-1',
    materia: overrides.materia || 'Matematicas',
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

describe('proximaClaseDe — próxima clase', () => {
  it('devuelve la clase más próxima estrictamente después de ahora', () => {
    const items = [
      clase({ id: 'hor-1', materia: 'Quimica', dia: 4, inicio: '12:00', fin: '13:00' }),
      clase({ id: 'hor-2', materia: 'Lunes temprano', dia: 1, inicio: '08:00', fin: '09:00' }),
    ];
    const proxima = proximaClaseDe(items, () => NOW);
    expect(proxima?.materia).toBe('Quimica');
  });

  it('da la vuelta a la semana cuando no queda ninguna clase', () => {
    const items = [
      clase({ id: 'hor-1', materia: 'Quimica', dia: 4, inicio: '12:00', fin: '13:00' }),
      clase({ id: 'hor-2', materia: 'Lunes temprano', dia: 1, inicio: '08:00', fin: '09:00' }),
    ];
    // Jueves 23:00: ya pasó Quimica (12:00) → envuelve al Lunes 08:00.
    const proxima = proximaClaseDe(items, () => NOW + 13 * HORA);
    expect(proxima?.materia).toBe('Lunes temprano');
  });

  it('devuelve null con lista vacía', () => {
    expect(proximaClaseDe([], () => NOW)).toBeNull();
  });

  it('ignora horas inválidas y devuelve null si ninguna es válida', () => {
    const items = [clase({ id: 'hor-1', materia: 'Invalida', inicio: '25:00', fin: '26:00' })];
    expect(proximaClaseDe(items, () => NOW)).toBeNull();
  });
});

describe('clasesDelDia — filtro y orden por día', () => {
  it('filtra por día ISO y ordena por hora de inicio', () => {
    const items = [
      clase({ id: 'hor-1', materia: 'Tarde', dia: 4, inicio: '12:00', fin: '13:00' }),
      clase({ id: 'hor-2', materia: 'Temprano', dia: 4, inicio: '07:00', fin: '08:00' }),
      clase({ id: 'hor-3', materia: 'Otro dia', dia: 2, inicio: '09:00', fin: '10:00' }),
    ];
    const hoy = clasesDelDia(items, 4);
    expect(hoy.map((c) => c.materia)).toEqual(['Temprano', 'Tarde']);
  });

  it('no muta el arreglo de entrada', () => {
    const items = [
      clase({ id: 'hor-1', materia: 'Tarde', dia: 4, inicio: '12:00', fin: '13:00' }),
      clase({ id: 'hor-2', materia: 'Temprano', dia: 4, inicio: '07:00', fin: '08:00' }),
    ];
    const before = items.map((c) => c.id);
    clasesDelDia(items, 4);
    expect(items.map((c) => c.id)).toEqual(before);
  });

  it('devuelve [] cuando el día no tiene clases', () => {
    const items = [clase({ id: 'hor-1', materia: 'Lunes', dia: 1, inicio: '08:00', fin: '09:00' })];
    expect(clasesDelDia(items, 4)).toEqual([]);
  });
});
