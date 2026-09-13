// ============================================================
// horarioIntentParser — Horario por dictado de voz (FASE C)
// ------------------------------------------------------------
// Pruebas del parser determinista es/en para AGREGAR, CONSULTAR
// y QUITAR entradas del horario semanal por dictado.
// Regla #1: sin hardcode; días/horas se resuelven con helpers
// reutilizados de horarioService.
// ============================================================

import { describe, it, expect } from 'vitest';
import { parseHorarioIntent } from '../src/core/horario/horarioIntentParser';

describe('parseHorarioIntent — agregar (es)', () => {
  it('agrega una clase con hora de fin explícita (hasta las)', () => {
    const r = parseHorarioIntent('agrega matemáticas el lunes a las 8 hasta las 9:30');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('horario.add');
    expect(r.data?.materia).toBe('matemáticas');
    expect(r.data?.dia).toBe(1);
    expect(r.data?.inicio).toBe('08:00');
    expect(r.data?.fin).toBe('09:30');
  });

  it('agrega una clase sin hora de fin (fin queda indefinido para derivarlo)', () => {
    const r = parseHorarioIntent('agrega matemáticas el lunes a las 8');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('horario.add');
    expect(r.data?.materia).toBe('matemáticas');
    expect(r.data?.dia).toBe(1);
    expect(r.data?.inicio).toBe('08:00');
    expect(r.data?.fin).toBeUndefined();
  });

  it('agrega con aula opcional', () => {
    const r = parseHorarioIntent('pon natación el miércoles a las 5 en el aula 3');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('horario.add');
    expect(r.data?.materia).toBe('natación');
    expect(r.data?.dia).toBe(3);
    expect(r.data?.inicio).toBe('05:00');
    expect(r.data?.aula).toBe('3');
  });

  it('agrega con hora en formato am/pm', () => {
    const r = parseHorarioIntent('agrega historia el martes a las 2 pm');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('horario.add');
    expect(r.data?.materia).toBe('historia');
    expect(r.data?.dia).toBe(2);
    expect(r.data?.inicio).toBe('14:00');
  });

  it('pide aclaración cuando falta el día', () => {
    const r = parseHorarioIntent('agrega matemáticas a las 8');
    expect(r.handled).toBe(true);
    expect(r.action).toBeNull();
    expect(r.reply).toContain('agregar');
  });

  it('pide la hora cuando falta el inicio', () => {
    const r = parseHorarioIntent('agrega matemáticas el lunes');
    expect(r.handled).toBe(true);
    expect(r.action).toBeNull();
    expect(r.reply).toContain('¿A qué hora');
  });
});

describe('parseHorarioIntent — agregar (en)', () => {
  it('adds a class with an explicit end time', () => {
    const r = parseHorarioIntent('add math on monday at 8 until 9:30');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('horario.add');
    expect(r.data?.materia).toBe('math');
    expect(r.data?.dia).toBe(1);
    expect(r.data?.inicio).toBe('08:00');
    expect(r.data?.fin).toBe('09:30');
  });

  it('adds a class without an end time', () => {
    const r = parseHorarioIntent('add math on monday at 8');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('horario.add');
    expect(r.data?.materia).toBe('math');
    expect(r.data?.dia).toBe(1);
    expect(r.data?.inicio).toBe('08:00');
    expect(r.data?.fin).toBeUndefined();
  });
});

describe('parseHorarioIntent — consultar (es/en)', () => {
  it('consulta clases de hoy → when=hoy', () => {
    const r = parseHorarioIntent('qué clases tengo hoy');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('horario.query');
    expect(r.data?.when).toBe('hoy');
  });

  it('consulta clases de mañana → when=manana', () => {
    const r = parseHorarioIntent('qué tengo mañana');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('horario.query');
    expect(r.data?.when).toBe('manana');
  });

  it('consulta un día explícito → dia ISO', () => {
    const r = parseHorarioIntent('qué clases tengo el viernes');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('horario.query');
    expect(r.data?.dia).toBe(5);
  });

  it('consulta con "dime mis clases"', () => {
    const r = parseHorarioIntent('dime mis clases');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('horario.query');
  });

  it('consulta en inglés (what classes tomorrow)', () => {
    const r = parseHorarioIntent('what classes do I have tomorrow');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('horario.query');
    expect(r.data?.when).toBe('manana');
  });

  it('consulta en inglés (show my schedule)', () => {
    const r = parseHorarioIntent('show my schedule');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('horario.query');
  });
});

describe('parseHorarioIntent — quitar (es/en)', () => {
  it('quita una clase indicando el día', () => {
    const r = parseHorarioIntent('quita la clase de historia del martes');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('horario.remove');
    expect(r.data?.materia).toBe('historia');
    expect(r.data?.dia).toBe(2);
  });

  it('quita una clase sin día (todas las coincidencias)', () => {
    const r = parseHorarioIntent('elimina matemáticas');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('horario.remove');
    expect(r.data?.materia).toBe('matemáticas');
    expect(r.data?.dia).toBeUndefined();
  });

  it('quita en inglés', () => {
    const r = parseHorarioIntent('remove math from monday');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('horario.remove');
    expect(r.data?.materia).toBe('math');
    expect(r.data?.dia).toBe(1);
  });

  it('pide aclaración cuando no hay materia', () => {
    const r = parseHorarioIntent('quita del horario');
    expect(r.handled).toBe(true);
    expect(r.action).toBeNull();
    expect(r.reply).toContain('quitar');
  });
});

describe('parseHorarioIntent — no dispara en conversación casual', () => {
  it('devuelve handled=false para frases sin intención de horario', () => {
    expect(parseHorarioIntent('hola flu').handled).toBe(false);
    expect(parseHorarioIntent('cuéntame un chiste').handled).toBe(false);
    expect(parseHorarioIntent('').handled).toBe(false);
    expect(parseHorarioIntent('   ').handled).toBe(false);
  });

  it('devuelve handled=false para entradas no string', () => {
    expect(parseHorarioIntent(null as unknown as string).handled).toBe(false);
    expect(parseHorarioIntent(undefined as unknown as string).handled).toBe(false);
  });
});

// ============================================================
// Dictado natural (niños): frases coloquiales que NO empiezan con
// el verbo canónico ('agrega'/'pon'). Deben reconocerse igual.
// Nace ROJO: 'ponen'/'agenda una clase' no están en los triggers.
// ============================================================
describe('parseHorarioIntent — dictado natural (niños)', () => {
  it('"ponen en la agenda una entrada para mañana natación a las 10 de la mañana"', () => {
    const r = parseHorarioIntent(
      'ponen en la agenda una entrada para mañana natación a las 10 de la mañana',
    );
    expect(r.handled).toBe(true);
    expect(r.action).toBe('horario.add');
    expect(String(r.data?.materia || '').toLowerCase()).toContain('nataci');
    expect(r.data?.inicio).toBe('10:00');
    expect(typeof r.data?.dia).toBe('number');
  });

  it('"pon en la agenda natación mañana a las 10"', () => {
    const r = parseHorarioIntent('pon en la agenda natación mañana a las 10');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('horario.add');
    expect(String(r.data?.materia || '').toLowerCase()).toContain('nataci');
    expect(r.data?.inicio).toBe('10:00');
  });

  it('"agenda una clase de natación para mañana a las 10"', () => {
    const r = parseHorarioIntent('agenda una clase de natación para mañana a las 10');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('horario.add');
    expect(String(r.data?.materia || '').toLowerCase()).toContain('nataci');
    expect(r.data?.inicio).toBe('10:00');
  });
});

describe('parseHorarioIntent — hora con meridiem (alineada al selector único)', () => {
  it('"a las 2:00 con 10 p.m" → inicio 22:00 (gana el meridiem)', () => {
    const r = parseHorarioIntent('agrega natación el lunes a las 2:00 con 10 p.m');
    expect(r.action).toBe('horario.add');
    expect((r.data as any)?.inicio).toBe('22:00');
  });
});