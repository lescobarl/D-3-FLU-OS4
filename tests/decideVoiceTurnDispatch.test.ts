// ============================================================
// decideVoiceTurnDispatch — Estabilización del turno de voz (Bug #3/#4)
// ------------------------------------------------------------
// El ASR entrega la frase del usuario en VARIOS fragmentos finales con pausas
// ("ok flu busca en la web" + pausa + "cómo saltan los conejos"). Si se
// despacha al recibir el primer fragmento, la búsqueda web dispara con una
// consulta vacía/truncada. decideVoiceTurnDispatch decide, con el transcript
// COMPLETO acumulado hasta ahora, si el turno está LISTO o si falta contenido.
//
// Datos PRODUCTIVOS: las frases canónicas vienen del FLU_CONFIG real
// (voiceCommands.buscar / navigate / generateVideo / generateDocument), no de
// literales copiados.
// ============================================================

import { describe, expect, it } from 'vitest';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig';
import {
  decideVoiceTurnDispatch,
  extractQueryFromWebSearchPhrase,
} from '../src/voice/lib/audioMath';

const voiceCommands = (FLU_CONFIG as any).voiceCommands as Record<string, string[]>;
const wakeWords = voiceCommands.wakeWords as string[];

describe('decideVoiceTurnDispatch — estabilización de fragmentos de voz', () => {
  it('turno SOLO con el gatillo de búsqueda ("ok flu busca en la web") NO está listo', () => {
    const fragment = decideVoiceTurnDispatch('ok flu busca en la web', voiceCommands, {
      requireWake: true,
    });
    expect(fragment.ready).toBe(false);
    expect(fragment.reason).toBe('incomplete-content-command');
  });

  it('el turno acumulado con la consulta completa SÍ está listo', () => {
    const full = decideVoiceTurnDispatch(
      'ok flu busca en la web como saltan los conejos',
      voiceCommands,
      { requireWake: true },
    );
    expect(full.ready).toBe(true);
  });

  it('simula la secuencia real de fragmentos: primero incompleto, luego listo', () => {
    // Fragmento 1 entregado por el STT al hacer una pausa tras el gatillo.
    const parcial = decideVoiceTurnDispatch('ok flu busca en la web', voiceCommands, {
      requireWake: true,
    });
    expect(parcial.ready).toBe(false);
    // Fragmento 2 (la consulta) ya unido por el motor de turnos.
    const completo = decideVoiceTurnDispatch(
      'ok flu busca en la web como saltan los conejos',
      voiceCommands,
      { requireWake: true },
    );
    expect(completo.ready).toBe(true);
  });

  it('no espera por navegación curada completa ("navega a wikipedia")', () => {
    const nav = decideVoiceTurnDispatch('ok flu navega a wikipedia', voiceCommands, {
      requireWake: true,
    });
    expect(nav.ready).toBe(true);
  });

  it('espera por un gatillo de generación sin contenido ("ok flu crea un video")', () => {
    const video = decideVoiceTurnDispatch('ok flu crea un video', voiceCommands, {
      requireWake: true,
    });
    expect(video.ready).toBe(false);
  });

  it('no espera cuando el gatillo ya trae tema ("ok flu crea un video de un conejo saltando")', () => {
    const video = decideVoiceTurnDispatch(
      'ok flu crea un video de un conejo saltando',
      voiceCommands,
      { requireWake: true },
    );
    expect(video.ready).toBe(true);
  });

  it('palabras de gatillo sueltas al final ("ok flu busca", "ok flu navega") quedan en espera', () => {
    expect(decideVoiceTurnDispatch('ok flu busca', voiceCommands, { requireWake: true }).ready).toBe(false);
    expect(decideVoiceTurnDispatch('ok flu navega', voiceCommands, { requireWake: true }).ready).toBe(false);
  });
});

describe('extractQueryFromWebSearchPhrase — consulta real sin el gatillo', () => {
  it('"busca en la web cómo saltan los conejos" → "cómo saltan los conejos"', () => {
    expect(
      extractQueryFromWebSearchPhrase('busca en la web cómo saltan los conejos', voiceCommands),
    ).toBe('cómo saltan los conejos');
  });

  it('"búscame cómo saltan los conejos" → "cómo saltan los conejos"', () => {
    expect(extractQueryFromWebSearchPhrase('búscame cómo saltan los conejos', voiceCommands)).toBe(
      'cómo saltan los conejos',
    );
  });

  it('frase sin gatillo reconocido se conserva completa', () => {
    expect(extractQueryFromWebSearchPhrase('capital de Francia', voiceCommands)).toBe(
      'capital de Francia',
    );
  });

  it('wake word incluida no contamina la consulta', () => {
    expect(
      extractQueryFromWebSearchPhrase('ok flu busca en internet el ciclo del agua', voiceCommands),
    ).toBe('el ciclo del agua');
  });

  it('cada gatillo de búsqueda declarado en config extrae su propia consulta', () => {
    for (const trigger of voiceCommands.buscar) {
      const query = `${trigger} el tema productivo`;
      const extracted = extractQueryFromWebSearchPhrase(query, voiceCommands);
      expect(extracted, `consulta tras "${trigger}" debe quedar limpia`).toBe('el tema productivo');
    }
    expect(wakeWords.length).toBeGreaterThan(0);
  });
});
