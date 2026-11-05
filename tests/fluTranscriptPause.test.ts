// ============================================================
// fluTranscriptPause - pausa / cola ASR debil guiado SOLO por config
// ------------------------------------------------------------
// Se sustituye la frontera de configuracion (fluConfig) y el helper puro de
// limpieza (audioMath.cleanForSpeech) para fijar valores deterministas; el
// modulo bajo prueba NUNCA se mockea. Casos borde: config ausente (lanza),
// inventario de claves configuradas, entrada vacia, frase corta por palabras,
// por tope de caracteres y por relacion de cola, evidencia debil por repeticion
// y por flush stale, y tope de palabras/caracteres alcanzado.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const config: { transcript?: { pauseAndWeakAsr?: Record<string, unknown> } } = {
    transcript: { pauseAndWeakAsr: {} },
  };
  return { config };
});

vi.mock('../src/voice/lib/fluConfig.js', () => ({ FLU_CONFIG: h.config }));

vi.mock('../src/voice/lib/audioMath.js', () => ({
  cleanForSpeech: (s: unknown) =>
    String(s ?? '')
      .replace(/[\n\r]+/g, ' ')
      .replace(/[*_`~>#-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
}));

import {
  countSpeechWords,
  getTranscriptPauseCfg,
  isPhraseShortForSpeakerHeuristics,
  isWeakAsrSpeakerEvidence,
  listConfiguredTranscriptHardRules,
  TRANSCRIPT_PAUSE_KEYS,
} from '../src/voice/lib/fluTranscriptPause.js';

const BASE: Record<string, unknown> = {
  tailMinLengthRatio: 0.5,
  treatEmptyPhraseAsWeak: true,
  staleFlushMinWords: 3,
  shortCommitMaxWords: 4,
  shortCommitMaxChars: 20,
  weakAsrRepetitionUniqueRatio: 0.5,
  weakAsrStaleMaxWords: 3,
  weakAsrStaleMaxChars: 15,
  weakAsrFinalMaxWords: 2,
  weakAsrFinalMaxChars: 8,
};

beforeEach(() => {
  h.config.transcript = { pauseAndWeakAsr: { ...BASE } };
});

// ---- lectura obligatoria de config ----
describe('fluTranscriptPause - getTranscriptPauseCfg', () => {
  it('devuelve el objeto de config y lanza si falta pausa/ASR debil', () => {
    const cfg = getTranscriptPauseCfg();
    expect(cfg).toBe(h.config.transcript?.pauseAndWeakAsr);

    h.config.transcript = { pauseAndWeakAsr: undefined };
    expect(() => getTranscriptPauseCfg()).toThrow(/pauseAndWeakAsr/);
  });
});

// ---- inventario de claves configuradas ----
describe('fluTranscriptPause - listConfiguredTranscriptHardRules', () => {
  it('lista SOLO las claves presentes, en orden canonico y con su fuente', () => {
    h.config.transcript = {
      pauseAndWeakAsr: { tailMinLengthRatio: 0.5, shortCommitMaxWords: 4 },
    };
    const rules = listConfiguredTranscriptHardRules();

    expect(rules.map((r: { key: string }) => r.key)).toEqual([
      'tailMinLengthRatio',
      'shortCommitMaxWords',
    ]);
    expect(rules[0]).toEqual({
      key: 'tailMinLengthRatio',
      value: 0.5,
      source: 'fluConfig.transcript.pauseAndWeakAsr',
    });
    expect(TRANSCRIPT_PAUSE_KEYS).toContain('tailMinLengthRatio');
  });

  it('con config vacia no lista ninguna regla', () => {
    h.config.transcript = { pauseAndWeakAsr: {} };
    expect(listConfiguredTranscriptHardRules()).toEqual([]);
  });
});

// ---- conteo de palabras de habla ----
describe('fluTranscriptPause - countSpeechWords', () => {
  it('cuenta palabras ignorando espacios y ruido de marcado', () => {
    expect(countSpeechWords('')).toBe(0);
    expect(countSpeechWords('   ')).toBe(0);
    expect(countSpeechWords('***')).toBe(0);
    expect(countSpeechWords('  hola   mundo ')).toBe(2);
  });
});

// ---- frase corta para heuristicas de hablante ----
describe('fluTranscriptPause - isPhraseShortForSpeakerHeuristics', () => {
  it('frase vacia depende de treatEmptyPhraseAsWeak', () => {
    expect(isPhraseShortForSpeakerHeuristics('')).toBe(true);

    h.config.transcript = { pauseAndWeakAsr: { ...BASE, treatEmptyPhraseAsWeak: false } };
    expect(isPhraseShortForSpeakerHeuristics('')).toBe(false);
  });

  it('marca corta si esta por debajo del minimo de palabras y no si es larga', () => {
    expect(isPhraseShortForSpeakerHeuristics('hola')).toBe(true);
    expect(isPhraseShortForSpeakerHeuristics('uno dos')).toBe(true);
    expect(isPhraseShortForSpeakerHeuristics('uno dos tres cuatro cinco')).toBe(false);
  });

  it('marca corta cuando la frase es cola de la ultima frase comprometida', () => {
    expect(isPhraseShortForSpeakerHeuristics('victoria', 'marcada la victoria')).toBe(true);
  });
});

// ---- evidencia debil de ASR ----
describe('fluTranscriptPause - isWeakAsrSpeakerEvidence', () => {
  it('frase vacia depende de treatEmptyPhraseAsWeak', () => {
    expect(isWeakAsrSpeakerEvidence({ phrase: '' })).toBe(true);

    h.config.transcript = { pauseAndWeakAsr: { ...BASE, treatEmptyPhraseAsWeak: false } };
    expect(isWeakAsrSpeakerEvidence({ phrase: '' })).toBe(false);
  });

  it('detecta repeticion excesiva y descarta texto largo y distinto', () => {
    expect(isWeakAsrSpeakerEvidence({ phrase: 'no no no' })).toBe(true);
    expect(isWeakAsrSpeakerEvidence({ phrase: 'una dos tres cuatro' })).toBe(false);
    expect(isWeakAsrSpeakerEvidence({ phrase: 'abcdefghij' })).toBe(false);
  });

  it('en flush stale, una frase por debajo del minimo de palabras es debil', () => {
    expect(
      isWeakAsrSpeakerEvidence({ phrase: 'conectando', staleInterimFlush: true }),
    ).toBe(true);
    expect(isWeakAsrSpeakerEvidence({ phrase: 'conectando' })).toBe(false);
  });

  it('en flush stale, supera el tope de caracteres y deja de ser debil', () => {
    expect(
      isWeakAsrSpeakerEvidence({ phrase: 'palabras uno dos', staleInterimFlush: true }),
    ).toBe(false);
  });

  it('marca debil cuando la frase es cola de la ultima comprometida', () => {
    expect(
      isWeakAsrSpeakerEvidence({ phrase: 'victoria', lastCommitted: 'marcada la victoria' }),
    ).toBe(true);
  });
});

describe('fluTranscriptPause - resolveSrGapTrigger (PRUEBA DE DETECTOR, el detector no es decorativo)', () => {
  it('dispara SOLO con silencio del ASR; el turno viejo con ASR activo NO dispara (spec del dueno)', async () => {
    h.config.transcript!.pauseAndWeakAsr!.srGapCommitMs = 10000;
    const { resolveSrGapTrigger } = await import('../src/voice/lib/fluTranscriptPause.js');
    // P9.55 aceptaba aqui 'turno viejo' (`sinceLastCommitMs`); RETIRADO: con el ASR
    // entregando onresult vaciaba la conversacion A MITAD del dictado (medido en la
    // sesion del dueno 2026-10-10: 26 de 26 srGap por 'sr-live-turn-stale').
    expect(resolveSrGapTrigger({ sinceLastResultMs: 500, sinceLastCommitMs: 12000 }).fire).toBe(false);
    expect(resolveSrGapTrigger({ sinceLastResultMs: 12000, sinceLastCommitMs: 12000 }).fire).toBe(true);
    expect(resolveSrGapTrigger({ sinceLastResultMs: 2000, sinceLastCommitMs: 2000 }).fire).toBe(false);
  });

  it('P11.12: el cierre es por SILENCIO real (el contenido estancado NO cierra la ultima frase)', async () => {
    h.config.transcript!.pauseAndWeakAsr!.srGapCommitMs = 10000;
    const { resolveSrGapTrigger } = await import('../src/voice/lib/fluTranscriptPause.js');
    // Mandato del dueno 2026-10-13: la ultima frase se vacia por SILENCIO o cambio de hablante.
    // La rama 'SIN CONTENIDO NUEVO' (P9.68) cerraba a mitad del dictado cuando el ASR iba por
    // detras (medido 03:35:57: sinceResult=1114 ms y la persona seguia hablando) y la fila
    // escrita entonces habia que ACTUALIZARLA. El caso 'Chrome repite lo mismo' lo cubre el
    // detector de eco committed-echo + rebuild del reconocimiento.
    const estancado = resolveSrGapTrigger({ sinceLastResultMs: 500, sinceLastCommitMs: 12000, hasOpenLine: true, openLineAgeMs: 12000 });
    expect(estancado.fire, 'sin silencio real NO se cierra la ultima frase').toBe(false);
    expect(estancado.reason).toBe('sr-active');
    // Silencio real (>= srGapCommitMs) SI cierra.
    expect(resolveSrGapTrigger({ sinceLastResultMs: 12000, sinceLastCommitMs: 12000, hasOpenLine: true, openLineAgeMs: 12000 }).fire).toBe(true);
  });
});
