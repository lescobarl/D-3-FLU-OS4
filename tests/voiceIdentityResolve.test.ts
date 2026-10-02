// ============================================================
// voiceIdentityResolve - resuelve hablante desde un vector 512-D
// ------------------------------------------------------------
// Se sustituyen SOLO las fronteras de configuracion/servicio: micCapture
// (umbrales), conversationRow (ids/nombres) y voiceIdentity (match por voz y
// fallback). El modulo bajo prueba NUNCA se mockea. Casos borde: vector vacio o
// no-array, match nulo (fallback), match con cluster (id del cluster), copia de
// signature/signatureHistory, fallback explicito, paso de parametros derivados
// y trazabilidad (label + workingClusters + signatureVector).
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getMinVoicedNew: vi.fn(),
  getMinVoiced: vi.fn(),
  getCaptureConfig: vi.fn(),
  ensureClusterSpeakerId: vi.fn(),
  labelToSpeakerId: vi.fn(),
  resolveSpeakerNameFromId: vi.fn(),
  matchSpeakerByVoice: vi.fn(),
  getFallbackSpeaker: vi.fn(),
}));

vi.mock('../src/voice/lib/micCapture.js', () => ({
  getConversationMinVoicedForNewSamples: h.getMinVoicedNew,
  getConversationMinVoicedSamples: h.getMinVoiced,
  getVoiceIdentityCaptureConfig: h.getCaptureConfig,
}));

vi.mock('../src/voice/lib/conversationRow.js', () => ({
  ensureClusterSpeakerId: h.ensureClusterSpeakerId,
  labelToSpeakerId: h.labelToSpeakerId,
  resolveSpeakerNameFromId: h.resolveSpeakerNameFromId,
}));

vi.mock('../src/voice/lib/voiceIdentity.js', () => ({
  resolveConversationSpeaker: h.matchSpeakerByVoice,
  getFallbackSpeaker: h.getFallbackSpeaker,
}));

import { resolveSpeakerIdentityFromVector } from '../src/voice/lib/voiceIdentityResolve.js';

/**
 * El JSDoc del modulo declara el retorno como { speakerId, speakerName }, asi
 * que se reescribe el tipo real aqui para leer el resto del contrato.
 */
type Resolved = {
  speakerId: string;
  speakerName: string;
  workingClusters: Array<Record<string, unknown>>;
  label: string;
  signatureVector: number[];
};

function resolve(vector: unknown, options: Record<string, unknown> = {}): Resolved {
  return resolveSpeakerIdentityFromVector(
    vector as never,
    options as never,
  ) as unknown as Resolved;
}

beforeEach(() => {
  vi.resetAllMocks();
  h.getCaptureConfig.mockReturnValue({
    conversationSpeakerThresholds: { cosine: 0.5 },
    conversationMaxAutoSpeakers: 3,
  });
  h.getMinVoiced.mockReturnValue(12000);
  h.getMinVoicedNew.mockReturnValue(24000);
  h.getFallbackSpeaker.mockReturnValue('Hablante 1');
  h.ensureClusterSpeakerId.mockImplementation((cluster: Record<string, unknown>) => ({
    ...cluster,
    label: String(cluster.label ?? '').trim(),
    speakerId: `sid:${String(cluster.label ?? '').trim()}`,
  }));
  h.labelToSpeakerId.mockImplementation((label: string) => `sid:${label}`);
  h.resolveSpeakerNameFromId.mockImplementation((id: string) => `name:${id}`);
  h.matchSpeakerByVoice.mockReturnValue(undefined);
});

// ---- vector vacio o no-array: no consulta el match de voz ----
describe('voiceIdentityResolve - vector vacio o no-array', () => {
  it('vector vacio usa el fallback y no consulta el match', () => {
    const out = resolve([], { speakerClusters: [] });

    expect(h.matchSpeakerByVoice).not.toHaveBeenCalled();
    expect(out.label).toBe('Hablante 1');
    expect(out.speakerId).toBe('sid:Hablante 1');
    expect(out.speakerName).toBe('name:sid:Hablante 1');
    expect(out.workingClusters).toEqual([]);
    expect(out.signatureVector).toEqual([]);
  });

  it('un vector no-array tambien cae al fallback', () => {
    const out = resolve('x', {});
    expect(h.matchSpeakerByVoice).not.toHaveBeenCalled();
    expect(out.label).toBe('Hablante 1');
  });
});

// ---- match de voz ----
describe('voiceIdentityResolve - matchSpeakerByVoice', () => {
  it('si el match devuelve una etiqueta de cluster usa su speakerId', () => {
    h.matchSpeakerByVoice.mockReturnValue('Luis');
    const out = resolve([1, 2, 3], { speakerClusters: [{ label: 'Luis' }] });

    expect(out.label).toBe('Luis');
    expect(out.speakerId).toBe('sid:Luis');
    expect(h.resolveSpeakerNameFromId).toHaveBeenCalledWith('sid:Luis', out.workingClusters);
  });

  it('si el match devuelve vacio se usa el fallback y labelToSpeakerId', () => {
    h.matchSpeakerByVoice.mockReturnValue(undefined);
    const out = resolve([1, 2, 3], {});

    expect(out.label).toBe('Hablante 1');
    expect(h.labelToSpeakerId).toHaveBeenCalledWith('Hablante 1');
  });

  it('pasa al match los parametros derivados de config y opciones', () => {
    h.getCaptureConfig.mockReturnValue({
      conversationSpeakerThresholds: { t: 1 },
      conversationMaxAutoSpeakers: 5,
    });
    resolve([1, 2, 3], {
      sampleRate: 16000,
      voicedSampleCount: 999,
      lastSpeaker: 'L',
      preferSpeaker: 'P',
      reservedLabels: ['R'],
      sessionPrimary: 'S',
      allowNewCluster: true,
      atTurnBoundary: false,
      utteranceText: 'hola',
    });

    expect(h.matchSpeakerByVoice).toHaveBeenCalledWith(
      expect.objectContaining({
        signatureVector: [1, 2, 3],
        lastSpeaker: 'L',
        voicedSampleCount: 999,
        utteranceText: 'hola',
        sampleRate: 16000,
        preferSpeaker: 'P',
        thresholds: { t: 1 },
        maxAutoSpeakers: 5,
        atTurnBoundary: false,
        allowNewCluster: true,
        reservedLabels: ['R'],
        sessionPrimary: 'S',
        minVoicedSamples: 12000,
        minVoicedSamplesForNew: 24000,
      }),
    );
    expect(h.getMinVoiced).toHaveBeenCalledWith(16000);
    expect(h.getMinVoicedNew).toHaveBeenCalledWith(16000);
  });

  it('sin conversationMaxAutoSpeakers usa 0', () => {
    h.getCaptureConfig.mockReturnValue({ conversationSpeakerThresholds: {} });
    resolve([1], {});
    expect(h.matchSpeakerByVoice).toHaveBeenCalledWith(
      expect.objectContaining({ maxAutoSpeakers: 0 }),
    );
  });
});

// ---- copia defensiva de firmas de los clusters ----
describe('voiceIdentityResolve - copia de firmas', () => {
  it('copia el array signature (no comparte referencia)', () => {
    const signature = [1, 2, 3];
    resolve([9], { speakerClusters: [{ label: 'A', signature }] });

    const passed = h.ensureClusterSpeakerId.mock.calls[0][0];
    expect(passed.signature).toEqual([1, 2, 3]);
    expect(passed.signature).not.toBe(signature);
  });

  it('copia tambien los arrays internos de signatureHistory', () => {
    const inner = [1, 2];
    resolve([9], { speakerClusters: [{ label: 'A', signatureHistory: [inner] }] });

    const passed = h.ensureClusterSpeakerId.mock.calls[0][0];
    expect(passed.signatureHistory[0]).toEqual([1, 2]);
    expect(passed.signatureHistory[0]).not.toBe(inner);
  });

  it('deja pasar valores no-array de signature sin romper', () => {
    resolve([9], { speakerClusters: [{ label: 'A', signature: 'nope' }] });
    const passed = h.ensureClusterSpeakerId.mock.calls[0][0];
    expect(passed.signature).toBe('nope');
  });

  it('normaliza cada cluster y expone workingClusters', () => {
    const out = resolve([1], { speakerClusters: [{ label: '  L  ' }, { label: 'M' }] });
    expect(h.ensureClusterSpeakerId).toHaveBeenCalledTimes(2);
    expect(h.ensureClusterSpeakerId.mock.calls[0][0].label).toBe('  L  ');
    expect(out.workingClusters.length).toBe(2);
  });
});

// ---- fallback explicito y trazabilidad ----
describe('voiceIdentityResolve - fallback y retorno', () => {
  it('un fallbackSpeaker explicito evita leer el fallback global', () => {
    const out = resolve([], { fallbackSpeaker: 'Pepito' });
    expect(out.label).toBe('Pepito');
    expect(h.getFallbackSpeaker).not.toHaveBeenCalled();
  });

  it('devuelve la misma referencia del vector y la etiqueta del match', () => {
    const vector = [4, 5, 6];
    h.matchSpeakerByVoice.mockReturnValue('X');
    const out = resolve(vector, {});
    expect(out.signatureVector).toBe(vector);
    expect(out.label).toBe('X');
  });
});
