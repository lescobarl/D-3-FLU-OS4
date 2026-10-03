// ============================================================
// ingressGuards - guardas de ingress (relajar shrink / forzar fila nueva)
// ------------------------------------------------------------
// Se sustituyen SOLO las fronteras: la config (fluConfig, fluTranscriptPause,
// fluTranscriptMotor), el servicio de similitud/transcripcion
// (conversationStream) y los helpers puros de texto (audioMath). El modulo bajo
// prueba NUNCA se mockea. Casos borde: etiquetas iguales, etiquetas con barra,
// firmas ausentes/no-array, umbrales por contexto, entrada vacia, sin ancla,
// texto identico, progreso ASR, misma revision, y las dos ramas de relajacion
// (por palabras nuevas y por pausa suficiente).
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  compare: vi.fn(),
  asrProgress: vi.fn(),
  relate: vi.fn(),
  sameRevision: vi.fn(),
  ingress: { novelWordMinCount: 2, novelWordMinTextLength: 8, alternateNewRowMinLength: 10, forceNewRowShortFinalMaxWords: 4 } as Record<string, number>,
  thresholds: { cosineContinuityThreshold: 0.8, cosineNewVoiceThreshold: 0.5, abruptSimilarityDrop: 0.2 } as Record<string, number>,
  pause: { pauseContinuationMinMs: 1000 } as Record<string, number>,
}));

vi.mock('../src/voice/lib/audioMath.js', () => ({
  cleanForSpeech: (s: unknown) =>
    String(s ?? '')
      .replace(/[\n\r]+/g, ' ')
      .replace(/[*_`~>#-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  speechWords: (t: unknown) =>
    String(t ?? '').toLowerCase().replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean),
  compareCosineSignatures: h.compare,
}));

vi.mock('../src/voice/lib/fluConfig.js', () => ({
  FLU_CONFIG: { transcript: { relaxGuardsAfterCommitMs: 1500 } },
}));

vi.mock('../src/voice/lib/fluTranscriptPause.js', () => ({
  getTranscriptPauseCfg: () => h.pause,
}));

vi.mock('../src/voice/lib/fluTranscriptMotor.js', () => ({
  getIngressGuardsCfg: () => h.ingress,
  getSpeakerThresholdsCfg: () => h.thresholds,
}));

vi.mock('../src/voice/lib/conversationStream.js', () => ({
  utterancesAsrProgress: h.asrProgress,
  utterancesRelate: h.relate,
  utterancesSameRevision: h.sameRevision,
}));

import {
  isSpeakerVoiceAbruptChange,
  msSinceLastCommit,
  shouldForceNewLogRowOnCommit,
  shouldRelaxIngressTextGuards,
} from '../src/voice/lib/ingressGuards.js';

beforeEach(() => {
  vi.resetAllMocks();
  h.compare.mockReturnValue(0.9);
  h.asrProgress.mockReturnValue(false);
  h.relate.mockReturnValue(true);
  h.sameRevision.mockReturnValue(false);
  h.pause.pauseContinuationMinMs = 1000;
  h.ingress = { novelWordMinCount: 2, novelWordMinTextLength: 8, alternateNewRowMinLength: 10, forceNewRowShortFinalMaxWords: 4 };
  h.thresholds = { cosineContinuityThreshold: 0.8, cosineNewVoiceThreshold: 0.5, abruptSimilarityDrop: 0.2 };
});

// ---- cambio abrupto de hablante por etiqueta ----
describe('ingressGuards - isSpeakerVoiceAbruptChange (etiquetas)', () => {
  it('etiquetas distintas sin barra implican cambio abrupto sin consultar similitud', () => {
    expect(
      isSpeakerVoiceAbruptChange({ finalSpeaker: 'Luis', previewSpeaker: 'Juan' }),
    ).toBe(true);
    expect(h.compare).not.toHaveBeenCalled();
  });

  it('etiquetas iguales o con barra no son cambio por si mismas', () => {
    expect(
      isSpeakerVoiceAbruptChange({ finalSpeaker: 'Luis', previewSpeaker: 'Luis' }),
    ).toBe(false);
    expect(
      isSpeakerVoiceAbruptChange({ finalSpeaker: 'A/B', previewSpeaker: 'C' }),
    ).toBe(false);
    expect(h.compare).not.toHaveBeenCalled();
  });
});

// ---- cambio abrupto de hablante por firma ----
describe('ingressGuards - isSpeakerVoiceAbruptChange (firmas)', () => {
  it('sin firmas validas no hay cambio abrupto', () => {
    expect(isSpeakerVoiceAbruptChange({})).toBe(false);
    expect(
      isSpeakerVoiceAbruptChange({ finalSignature: [1], previewSignature: 'x' }),
    ).toBe(false);
    expect(h.compare).not.toHaveBeenCalled();
  });

  it('usa el umbral del piso, el de continuidad menos la caida y los overrides de contexto', () => {
    h.compare.mockReturnValue(0.3);
    expect(
      isSpeakerVoiceAbruptChange({ finalSignature: [1, 0], previewSignature: [1, 0] }),
    ).toBe(true);

    h.compare.mockReturnValue(0.55);
    expect(
      isSpeakerVoiceAbruptChange({ finalSignature: [1, 0], previewSignature: [1, 0] }),
    ).toBe(true);

    h.compare.mockReturnValue(0.7);
    expect(
      isSpeakerVoiceAbruptChange({ finalSignature: [1, 0], previewSignature: [1, 0] }),
    ).toBe(false);
    expect(
      isSpeakerVoiceAbruptChange({
        finalSignature: [1, 0],
        previewSignature: [1, 0],
        abruptSimilarityFloor: 0.9,
      }),
    ).toBe(true);
  });
});

// ---- tiempo desde el ultimo commit ----
describe('ingressGuards - msSinceLastCommit', () => {
  it('prioriza el valor explicito y cae a las pausas disponibles', () => {
    expect(msSinceLastCommit({ msSinceLastCommit: 500 })).toBe(500);
    expect(msSinceLastCommit({ msSinceLastCommit: -5, pauseBeforeMs: 300 })).toBe(300);
    expect(msSinceLastCommit({ openLineAgeMs: 120 })).toBe(120);
    expect(msSinceLastCommit({ userPauseMs: 80 })).toBe(80);
    expect(msSinceLastCommit({})).toBe(0);
  });
});

// ---- relajacion de guardas de texto ----
describe('ingressGuards - shouldRelaxIngressTextGuards', () => {
  it('relaja por bandera, por cambio abrupto y al alcanzar el gate de commit', () => {
    expect(shouldRelaxIngressTextGuards({ forceRelaxGuards: true })).toBe(true);
    expect(
      shouldRelaxIngressTextGuards({ finalSpeaker: 'Luis', previewSpeaker: 'Juan' }),
    ).toBe(true);
    expect(shouldRelaxIngressTextGuards({ msSinceLastCommit: 1500 })).toBe(true);
    expect(shouldRelaxIngressTextGuards({ msSinceLastCommit: 1499 })).toBe(false);
  });
});

// ---- forzar fila nueva en commit ----
describe('ingressGuards - shouldForceNewLogRowOnCommit (base)', () => {
  it('texto vacio no fuerza fila; sin ancla si; identico no; y el progreso ASR tampoco', () => {
    expect(shouldForceNewLogRowOnCommit('', '')).toBe(false);
    expect(shouldForceNewLogRowOnCommit('hola', '', '')).toBe(true);
    expect(shouldForceNewLogRowOnCommit('hola', 'hola', '')).toBe(false);

    h.asrProgress.mockReturnValue(true);
    expect(shouldForceNewLogRowOnCommit('abcdefghij', 'abc', '')).toBe(false);

    h.asrProgress.mockReturnValue(false);
    h.sameRevision.mockReturnValue(true);
    expect(shouldForceNewLogRowOnCommit('nuevo texto', 'previo', '')).toBe(false);
  });
});

describe('ingressGuards - shouldForceNewLogRowOnCommit (relajado)', () => {
  it('con relajacion forzada, un texto que no se relaciona fuerza fila nueva', () => {
    h.relate.mockReturnValue(false);
    expect(
      shouldForceNewLogRowOnCommit('otra cosa', 'previo', '', { forceRelaxGuards: true }),
    ).toBe(true);
  });

  it('con relajacion, las palabras nuevas por encima del minimo fuerzan fila nueva', () => {
    expect(
      shouldForceNewLogRowOnCommit('nueva idea brillante', 'idea', '', {
        forceRelaxGuards: true,
      }),
    ).toBe(true);
  });

  it('con relajacion, una palabra nueva suficientemente larga fuerza fila nueva', () => {
    expect(
      shouldForceNewLogRowOnCommit('distinta', 'base', '', { forceRelaxGuards: true }),
    ).toBe(true);
  });
});

describe('ingressGuards - shouldForceNewLogRowOnCommit (heuristica de pausa)', () => {
  it('pausa por debajo del minimo no fuerza fila nueva', () => {
    expect(
      shouldForceNewLogRowOnCommit('nueva', 'viejo', '', { msSinceLastCommit: 0 }),
    ).toBe(false);
  });

  it('pausa suficiente: final largo o con palabras nuevas fuerza fila nueva', () => {
    expect(
      shouldForceNewLogRowOnCommit('uno dos tres cuatro cinco seis', 'previo', '', {
        msSinceLastCommit: 1200,
      }),
    ).toBe(true);
    expect(
      shouldForceNewLogRowOnCommit('nueva', 'viejo', '', { msSinceLastCommit: 1200 }),
    ).toBe(true);
  });
});

describe("PRUEBA DE DETECTOR - la marca de fila nueva discrimina", () => {
  it("PRUEBA DE DETECTOR: el detector marca la pausa suficiente y no marca el turno sin pausa", () => {
    // Entrada infractora sintetica: sin pausa ni novedad, no puede forzar fila nueva.
    const sinPausa = shouldForceNewLogRowOnCommit("nueva", "viejo", "", { msSinceLastCommit: 0 });
    expect(sinPausa).toBe(false);
    // Y no puede ser vacua: con pausa suficiente SI fuerza fila nueva.
    const conPausa = shouldForceNewLogRowOnCommit("nueva", "viejo", "", { msSinceLastCommit: 1200 });
    expect(conPausa).toBe(true);
  });
});
