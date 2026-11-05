// ============================================================
// Tests para normalizeWorkspaceContract — rama tipo='horario'
// ============================================================
// El contrato workspace del Pizarrón admite tipo='horario' con
// modo ('semana'|'dia'|'proxima'|'recordatorios'). Este test
// verifica que la normalización:
//   - preserva { titulo, tipo:'horario', modo, contenido, puntos_clave }
//   - valida/limita el modo (fallback 'semana', minúsculas)
//   - devuelve null cuando no hay nada que renderizar
//   - NO rompe las ramas text/image_prompt existentes
// NOTA: cleanForSpeech elimina guiones → los strings NO llevan '-'.
// ============================================================
import { describe, it, expect } from 'vitest';
import { normalizeWorkspaceContract } from '../src/voice/lib/workspaceContract';

describe('normalizeWorkspaceContract — rama tipo=horario', () => {
  it('preserva el contrato completo del horario (titulo, modo, contenido, puntos_clave)', () => {
    const result = normalizeWorkspaceContract({
      titulo: 'Mi horario',
      tipo: 'horario',
      modo: 'semana',
      contenido: 'Horario de clases de matematicas',
      puntos_clave: ['Matematicas', 'Fisica'],
    });
    expect(result).toEqual({
      titulo: 'Mi horario',
      tipo: 'horario',
      modo: 'semana',
      contenido: 'Horario de clases de matematicas',
      puntos_clave: ['Matematicas', 'Fisica'],
    });
  });

  it('devuelve modo por defecto (semana) cuando el modo no es válido', () => {
    const result = normalizeWorkspaceContract({
      titulo: 'Mi horario',
      tipo: 'horario',
      modo: 'otro',
    });
    expect(result?.tipo).toBe('horario');
    expect(result?.modo).toBe('semana');
  });

  it('devuelve modo por defecto (semana) cuando no hay modo', () => {
    const result = normalizeWorkspaceContract({ titulo: 'Mi horario', tipo: 'horario' });
    expect(result?.tipo).toBe('horario');
    expect(result?.modo).toBe('semana');
  });

  it('normaliza el modo a minúsculas', () => {
    const result = normalizeWorkspaceContract({
      titulo: 'Mi horario',
      tipo: 'horario',
      modo: 'PROXIMA',
    });
    expect(result?.modo).toBe('proxima');
  });

  it('acepta los cuatro modos válidos', () => {
    for (const modo of ['semana', 'dia', 'proxima', 'recordatorios']) {
      const result = normalizeWorkspaceContract({ titulo: 'Mi horario', tipo: 'horario', modo });
      expect(result?.modo).toBe(modo);
    }
  });

  it('devuelve null cuando no hay titulo, contenido ni puntos_clave', () => {
    expect(normalizeWorkspaceContract({ tipo: 'horario' })).toBeNull();
    expect(
      normalizeWorkspaceContract({ tipo: 'horario', titulo: '', contenido: '', puntos_clave: [] }),
    ).toBeNull();
  });

  it('el contenido por sí solo es suficiente', () => {
    const result = normalizeWorkspaceContract({
      tipo: 'horario',
      contenido: 'Matematicas 08:00',
    });
    expect(result?.tipo).toBe('horario');
    expect(result?.contenido).toBe('Matematicas 08:00');
  });

  it('los puntos_clave por sí solos bastan y se recortan (trim)', () => {
    const result = normalizeWorkspaceContract({
      tipo: 'horario',
      puntos_clave: ['  matematicas  ', 'fisica'],
    });
    expect(result?.tipo).toBe('horario');
    expect(result?.puntos_clave).toEqual(['matematicas', 'fisica']);
  });

  it('no altera la rama de texto (tipo text)', () => {
    const result = normalizeWorkspaceContract({
      titulo: 'Nota',
      contenido: 'Contenido de la nota',
    });
    expect(result?.tipo).toBe('text');
    expect(result?.titulo).toBe('Nota');
  });

  it('devuelve null para entrada vacía, null o undefined', () => {
    expect(normalizeWorkspaceContract(null)).toBeNull();
    expect(normalizeWorkspaceContract(undefined)).toBeNull();
    expect(normalizeWorkspaceContract('' as unknown as object)).toBeNull();
    expect(normalizeWorkspaceContract({})).toBeNull();
  });
});

describe('normalizeWorkspaceContract — ramas visuales sin regresión', () => {
  it('preserva un prompt_visual específico (tipo image_prompt)', () => {
    const result = normalizeWorkspaceContract({
      tipo: 'image_prompt',
      titulo: 'Diagrama',
      prompt_visual: 'diagrama de arquitectura del sistema',
    });
    expect(result?.tipo).toBe('image_prompt');
    expect(result?.prompt_visual).toBe('diagrama de arquitectura del sistema');
  });

  it('rechaza un prompt_visual genérico (composicion abstracta) como null', () => {
    expect(
      normalizeWorkspaceContract({ tipo: 'image_prompt', prompt_visual: 'composicion abstracta' }),
    ).toBeNull();
  });
});

describe('normalizeWorkspaceContract — rama de generación doc/video', () => {
  it('preserva tipo doc con contenido y título', () => {
    const result = normalizeWorkspaceContract({
      tipo: 'doc',
      titulo: 'Carta de presentación',
      contenido: 'Estimado equipo, me presento...',
    });
    expect(result?.tipo).toBe('doc');
    expect(result?.titulo).toBe('Carta de presentación');
    expect(result?.contenido).toBe('Estimado equipo, me presento...');
  });

  it('preserva tipo video con el tema en contenido', () => {
    const result = normalizeWorkspaceContract({
      tipo: 'video',
      contenido: 'video sobre los planetas del sistema solar',
    });
    expect(result?.tipo).toBe('video');
    expect(result?.contenido).toBe('video sobre los planetas del sistema solar');
  });

  it('usa el título como contenido cuando no hay contenido (doc)', () => {
    const result = normalizeWorkspaceContract({ tipo: 'doc', titulo: 'Ensayo sobre la IA' });
    expect(result?.tipo).toBe('doc');
    expect(result?.contenido).toBe('Ensayo sobre la IA');
  });

  it('devuelve null cuando doc/video no tiene contenido ni título', () => {
    expect(normalizeWorkspaceContract({ tipo: 'doc' })).toBeNull();
    expect(normalizeWorkspaceContract({ tipo: 'video', contenido: '', titulo: '' })).toBeNull();
  });

  it('normaliza el tipo a minúsculas (DOC → doc)', () => {
    const result = normalizeWorkspaceContract({ tipo: 'DOC', contenido: 'contenido' });
    expect(result?.tipo).toBe('doc');
  });
});
