// ============================================================
// speakerEmbeddingCore - nucleo de embedding (Node / fallback sin Worker)
// ------------------------------------------------------------
// Se sustituyen SOLO las fronteras: el servicio de modelos
// (@huggingface/transformers), los helpers de frames/vector, la config de
// embedding y el cliente del worker. El modulo bajo prueba NUNCA se mockea.
// Cada test re-importa el modulo con vi.resetModules() porque mantiene estado
// de modulo (modelBundlePromise / preloadError). Casos borde: muestras vacias,
// muestras insuficientes tras downsample, vector crudo vacio, cache del bundle,
// fallo de precarga (error pegajoso) y la rama del Worker en navegador.
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  AutoProcessor: { from_pretrained: vi.fn() },
  AutoModel: { from_pretrained: vi.fn() },
  downsampleTo16k: vi.fn(),
  tensorToEmbeddingVector: vi.fn(),
  normalizeEmbeddingVector: vi.fn(),
  getEmbeddingConfig: vi.fn(),
  getMinSamples: vi.fn(),
  getModelId: vi.fn(),
  getTargetSampleRate: vi.fn(),
  embedAudioForDiarization: vi.fn(),
  preloadVoiceIdWorker: vi.fn(),
}));

vi.mock('@huggingface/transformers', () => ({
  env: h.env,
  AutoProcessor: h.AutoProcessor,
  AutoModel: h.AutoModel,
}));

vi.mock('../src/voice/lib/embeddingFrames.js', () => ({
  downsampleTo16k: h.downsampleTo16k,
  tensorToEmbeddingVector: h.tensorToEmbeddingVector,
}));

vi.mock('../src/voice/lib/speakerCore.js', () => ({
  normalizeEmbeddingVector: h.normalizeEmbeddingVector,
}));

vi.mock('../src/voice/lib/embeddingConfig.js', () => ({
  getEmbeddingConfig: h.getEmbeddingConfig,
  getMinSamples: h.getMinSamples,
  getModelId: h.getModelId,
  getTargetSampleRate: h.getTargetSampleRate,
}));

vi.mock('../src/voice/lib/voiceIdWorkerClient.js', () => ({
  embedAudioForDiarization: h.embedAudioForDiarization,
  preloadVoiceIdWorker: h.preloadVoiceIdWorker,
}));

async function fresh() {
  vi.resetModules();
  return await import('../src/voice/lib/speakerEmbeddingCore.js');
}

beforeEach(() => {
  vi.resetAllMocks();
  h.getEmbeddingConfig.mockReturnValue({
    modelId: 'model-x',
    quantized: true,
    targetSampleRate: 16000,
  });
  h.getModelId.mockReturnValue('model-x');
  h.getTargetSampleRate.mockReturnValue(16000);
  h.getMinSamples.mockReturnValue(0);
  h.normalizeEmbeddingVector.mockImplementation((v: number[]) => v);
  h.tensorToEmbeddingVector.mockReturnValue([1, 2, 3]);
  h.downsampleTo16k.mockImplementation((s: ArrayLike<number>) => new Float32Array(s));
  h.AutoProcessor.from_pretrained.mockResolvedValue(vi.fn(async () => ({ inputs: true })));
  h.AutoModel.from_pretrained.mockResolvedValue(vi.fn(async () => ({ output: true })));
  h.embedAudioForDiarization.mockResolvedValue([0.5, 0.5]);
  h.preloadVoiceIdWorker.mockResolvedValue(undefined);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).Worker;
});

// ---- estado del modelo ----
describe('speakerEmbeddingCore - getSpeakerEmbeddingModelStatus', () => {
  it('arranca en idle con el modelId resuelto y dimension 512', async () => {
    const m = await fresh();
    expect(m.getSpeakerEmbeddingModelStatus()).toEqual({
      state: 'idle',
      modelId: 'model-x',
      dim: 512,
      backend: 'wavlm-sv',
    });
  });

  it('tras precargar pasa a loading-or-ready', async () => {
    const m = await fresh();
    await m.preloadSpeakerEmbeddingModel();
    expect(m.getSpeakerEmbeddingModelStatus()).toEqual({
      state: 'loading-or-ready',
      modelId: 'model-x',
      dim: 512,
      backend: 'wavlm-sv',
    });
  });
});

// ---- computeSpeakerEmbedding: entradas vacias ----
describe('speakerEmbeddingCore - computeSpeakerEmbedding (vacio)', () => {
  it('sin muestras devuelve vector vacio sin tocar el modelo', async () => {
    const m = await fresh();
    expect(await m.computeSpeakerEmbedding([])).toEqual([]);
    expect(await m.computeSpeakerEmbedding(undefined as never)).toEqual([]);
    expect(h.AutoProcessor.from_pretrained).not.toHaveBeenCalled();
  });
});

// ---- computeSpeakerEmbedding: ruta Node (fallback sin Worker) ----
describe('speakerEmbeddingCore - computeSpeakerEmbedding (Node)', () => {
  it('downsamplea a la tasa objetivo y normaliza el vector crudo', async () => {
    const m = await fresh();
    const out = await m.computeSpeakerEmbedding([0.1, 0.2, 0.3]);

    const [frame, inRate, outRate] = h.downsampleTo16k.mock.calls[0];
    expect(frame.length).toBe(3);
    expect(inRate).toBe(48000);
    expect(outRate).toBe(16000);
    expect(h.normalizeEmbeddingVector).toHaveBeenCalledWith([1, 2, 3]);
    expect(out).toEqual([1, 2, 3]);
  });

  it('envuelve los arrays de entrada en Float32Array', async () => {
    const m = await fresh();
    await m.computeSpeakerEmbedding([1, 2, 3]);
    const wrapped = h.downsampleTo16k.mock.calls[0][0];
    expect(wrapped).toBeInstanceOf(Float32Array);
    expect(Array.from(wrapped)).toEqual([1, 2, 3]);
  });

  it('reusa el Float32Array ya recibido sin volver a copiarlo', async () => {
    const m = await fresh();
    const input = new Float32Array([4, 5, 6]);
    await m.computeSpeakerEmbedding(input as never);
    expect(h.downsampleTo16k.mock.calls[0][0]).toBe(input);
  });

  it('si el frame queda por debajo del minimo de muestras devuelve vacio', async () => {
    h.getMinSamples.mockReturnValue(1000);
    h.downsampleTo16k.mockReturnValue(new Float32Array(10));
    const m = await fresh();
    expect(await m.computeSpeakerEmbedding([1, 2, 3])).toEqual([]);
    expect(h.AutoProcessor.from_pretrained).not.toHaveBeenCalled();
  });

  it('si el vector crudo viene vacio devuelve vacio sin normalizar', async () => {
    h.tensorToEmbeddingVector.mockReturnValue([]);
    const m = await fresh();
    expect(await m.computeSpeakerEmbedding([1, 2, 3])).toEqual([]);
    expect(h.normalizeEmbeddingVector).not.toHaveBeenCalled();
  });

  it('con sampleRate 0 cae a la tasa objetivo', async () => {
    const m = await fresh();
    await m.computeSpeakerEmbedding([1, 2, 3], 0);
    expect(h.downsampleTo16k.mock.calls[0][1]).toBe(16000);
  });
});

// ---- precarga: cache y error pegajoso ----
describe('speakerEmbeddingCore - preloadSpeakerEmbeddingModel', () => {
  it('cachea el bundle: dos llamadas devuelven la misma promesa y un solo load', async () => {
    const m = await fresh();
    const p1 = m.preloadSpeakerEmbeddingModel();
    const p2 = m.preloadSpeakerEmbeddingModel();

    expect(p1).toBe(p2);
    const bundle = await p1;
    expect(bundle.modelId).toBe('model-x');
    expect(h.AutoModel.from_pretrained).toHaveBeenCalledTimes(1);
  });

  it('ante fallo de carga marca error pegajoso y no reintenta', async () => {
    h.AutoModel.from_pretrained.mockRejectedValue(new Error('boom'));
    const m = await fresh();

    await expect(m.preloadSpeakerEmbeddingModel()).rejects.toThrow('boom');
    expect(m.getSpeakerEmbeddingModelStatus()).toEqual({
      state: 'error',
      modelId: 'model-x',
      error: 'boom',
    });

    await expect(m.preloadSpeakerEmbeddingModel()).rejects.toThrow('boom');
    expect(h.AutoProcessor.from_pretrained).toHaveBeenCalledTimes(1);
  });
});

// ---- rama Worker (navegador) ----
describe('speakerEmbeddingCore - rama Worker', () => {
  it('con window y Worker delega en el cliente y reporta estado worker', async () => {
    (globalThis as Record<string, unknown>).window = {};
    (globalThis as Record<string, unknown>).Worker = class {};

    const m = await fresh();
    expect(m.getSpeakerEmbeddingModelStatus()).toEqual({
      state: 'worker',
      modelId: 'model-x',
      dim: 512,
      backend: 'wavlm-sv-worker',
    });

    const out = await m.computeSpeakerEmbedding([1, 2, 3], 48000);
    expect(h.embedAudioForDiarization).toHaveBeenCalledWith([1, 2, 3], 48000);
    expect(out).toEqual([0.5, 0.5]);
  });
});
