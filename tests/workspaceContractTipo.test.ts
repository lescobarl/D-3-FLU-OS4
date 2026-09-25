// ============================================================
// workspaceContractTipo — decisión de workspace.tipo por petición
// EXPLÍCITA del usuario (Bug #5/#6)
// ------------------------------------------------------------
// El tipo de artefacto ("video" vs "doc" vs "text") que el modelo emite puede
// ser incoherente con lo que el usuario PIDIÓ ("crea un video de un conejo
// saltando" → text; "genera una carta…" → video). Estas pruebas verifican que
// el contrato se corrige por la petición explícita (fuente de verdad del
// transcript) con datos productivos reales de FLU_CONFIG.
// ============================================================

import { describe, expect, it } from 'vitest';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig';
import { detectExplicitGenerationTipo, normalizeWorkspaceContract } from '../src/voice/lib/workspaceContract';

const voiceCommands = (FLU_CONFIG as any).voiceCommands;

describe('detectExplicitGenerationTipo — petición explícita de video/documento', () => {
  it('"crea un video de un conejo saltando" → video', () => {
    expect(detectExplicitGenerationTipo('crea un video de un conejo saltando', voiceCommands)).toBe('video');
  });

  it('"ok flu genera un video sobre los planetas" (con wake) → video', () => {
    expect(detectExplicitGenerationTipo('ok flu genera un video sobre los planetas', voiceCommands)).toBe('video');
  });

  it('"genera una carta sobre un conejo saltando" → doc', () => {
    expect(detectExplicitGenerationTipo('genera una carta sobre un conejo saltando', voiceCommands)).toBe('doc');
  });

  it('"escribe una carta a la abuela" → doc', () => {
    expect(detectExplicitGenerationTipo('escribe una carta a la abuela', voiceCommands)).toBe('doc');
  });

  it('NO confunde preguntas ("¿qué es un video?", "¿cómo se crea una carta?")', () => {
    expect(detectExplicitGenerationTipo('qué es un video', voiceCommands)).toBeNull();
    expect(detectExplicitGenerationTipo('cómo se crea una carta', voiceCommands)).toBeNull();
    expect(detectExplicitGenerationTipo('dime qué es un documento', voiceCommands)).toBeNull();
  });

  it('no dispara para consultas conversacionales sin verbo de generación', () => {
    expect(detectExplicitGenerationTipo('cuéntame sobre los conejos', voiceCommands)).toBeNull();
    expect(detectExplicitGenerationTipo('capital de Francia', voiceCommands)).toBeNull();
  });
});

describe('normalizeWorkspaceContract — corrige el tipo según la petición', () => {
  it('modelo devolvió tipo text para "crea un video…" → se corrige a video (Bug #5)', () => {
    const normalized = normalizeWorkspaceContract(
      { tipo: 'text', titulo: '', contenido: 'Preparando el video del conejo saltando.' },
      { transcript: 'ok flu crea un video de un conejo saltando' },
    );
    expect(normalized).not.toBeNull();
    expect(normalized?.tipo).toBe('video');
    expect(normalized?.contenido).toContain('conejo');
  });

  it('modelo devolvió tipo video para "genera una carta…" → se corrige a doc (Bug #6)', () => {
    const normalized = normalizeWorkspaceContract(
      { tipo: 'video', titulo: 'Carta', contenido: 'Carta sobre un conejo saltando' },
      { transcript: 'ok flu genera una carta sobre un conejo saltando' },
    );
    expect(normalized?.tipo).toBe('doc');
  });

  it('sin petición explícita de doc/video se preserva el tipo del modelo', () => {
    const normalized = normalizeWorkspaceContract(
      { tipo: 'doc', titulo: 'Ensayo sobre la IA', contenido: 'contenido' },
      { transcript: 'explícame la fotosíntesis' },
    );
    expect(normalized?.tipo).toBe('doc');
  });

  it('petición explícita sin contenido del modelo usa el asunto del transcript', () => {
    const normalized = normalizeWorkspaceContract(
      { tipo: 'text' },
      { transcript: 'ok flu genera una carta para la maestra sobre la fotosíntesis' },
    );
    expect(normalized).not.toBeNull();
    expect(normalized?.tipo).toBe('doc');
    expect(normalized?.contenido).toContain('fotosintesis');
  });
});
