// @vitest-environment node
/**
 * whisperAsr.worker — transcriptor unico on-device (§9).
 * Se sustituye SOLO la frontera pesada: @huggingface/transformers (pipeline/env)
 * y el puente del worker (workerBridge). La config (mock ESTABLE) se muta in-situ
 * y caughtError se espia. No se toca src.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  pipeline: vi.fn(),
  env: {} as Record<string, unknown>,
  config: { transcript: { asr: {} as Record<string, unknown> } },
}));

vi.mock('@huggingface/transformers', () => ({ env: h.env, pipeline: h.pipeline }));
vi.mock('../src/voice/lib/fluConfig.js', () => ({ FLU_CONFIG: h.config }));

const buf = vi.hoisted(() => ({ samplesFromTransfer: vi.fn(), createWorkerReply: vi.fn() }));
vi.mock('../src/voice/lib/workerBridge.js', () => ({
  samplesFromTransfer: buf.samplesFromTransfer,
  createWorkerReply: buf.createWorkerReply,
}));

const log = vi.hoisted(() => ({ logCaughtError: vi.fn() }));
vi.mock('../src/lib/caughtError', () => ({ logCaughtError: log.logCaughtError }));

const ASR_DEFECTO = { modelId: 'Xenova/whisper-tiny', dtype: 'q8', language: 'spanish', initialPrompt: 'flu' };
const selfStub: { onmessage: ((e: unknown) => Promise<void>) | null } = { onmessage: null };

type Handler = (e: unknown) => Promise<void>;

/** Reimporta el worker con estado de modulo limpio (asrPromise). */
async function montar(): Promise<Handler> {
  vi.resetModules();
  h.pipeline.mockReset();
  selfStub.onmessage = null;
  vi.stubGlobal('self', selfStub);
  await import('../src/voice/workers/whisperAsr.worker.js');
  const handler = selfStub.onmessage as Handler | null;
  if (!handler) throw new Error('el worker no registro self.onmessage');
  return handler;
}

let reply: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  h.config.transcript.asr = { ...ASR_DEFECTO };
  reply = vi.fn();
  buf.createWorkerReply.mockReturnValue(reply);
  buf.samplesFromTransfer.mockReturnValue(new Float32Array([0.1, 0.2]));
});

describe('whisperAsr.worker — configuracion de entorno', () => {
  it('fija los flags offline-first de transformers al cargar el modulo', async () => {
    await montar();
    expect(h.env.allowLocalModels).toBe(false);
    expect(h.env.allowRemoteModels).toBe(true);
    expect(h.env.useBrowserCache).toBe(true);
  });
});

describe('whisperAsr.worker — preload', () => {
  it('crea la pipeline con el modelo y dtype de la config', async () => {
    const onmessage = await montar();
    h.pipeline.mockResolvedValue(async () => ({ text: '' }));
    await onmessage({ data: { id: 1, type: 'preload' } });
    expect(h.pipeline).toHaveBeenCalledWith('automatic-speech-recognition', 'Xenova/whisper-tiny', { dtype: 'q8' });
    expect(reply).toHaveBeenCalledWith(true, { ready: true, modelId: 'Xenova/whisper-tiny' });
  });

  it('el payload puede sobreescribir modelId', async () => {
    const onmessage = await montar();
    h.pipeline.mockResolvedValue(async () => ({ text: '' }));
    await onmessage({ data: { id: 2, type: 'preload', payload: { modelId: 'otro/modelo' } } });
    expect(h.pipeline).toHaveBeenCalledWith('automatic-speech-recognition', 'otro/modelo', { dtype: 'q8' });
    expect(reply).toHaveBeenCalledWith(true, { ready: true, modelId: 'otro/modelo' });
  });

  it('memoiza la pipeline: dos preloads construyen una sola vez', async () => {
    const onmessage = await montar();
    h.pipeline.mockResolvedValue(async () => ({ text: '' }));
    await onmessage({ data: { id: 3, type: 'preload' } });
    await onmessage({ data: { id: 4, type: 'preload' } });
    expect(h.pipeline).toHaveBeenCalledTimes(1);
  });

  it("dtype por defecto 'q8' si la config no lo trae", async () => {
    const onmessage = await montar();
    h.config.transcript.asr = { modelId: 'solo/modelo' };
    h.pipeline.mockResolvedValue(async () => ({ text: '' }));
    await onmessage({ data: { id: 5, type: 'preload' } });
    expect(h.pipeline).toHaveBeenCalledWith('automatic-speech-recognition', 'solo/modelo', { dtype: 'q8' });
  });
});

describe('whisperAsr.worker — transcribe', () => {
  it('devuelve el texto recortado y pasa las opciones antialucinacion', async () => {
    const onmessage = await montar();
    const asr = vi.fn(async () => ({ text: '  hola mundo  ' }));
    h.pipeline.mockResolvedValue(asr);
    buf.samplesFromTransfer.mockReturnValue(new Float32Array([1, 2, 3]));
    await onmessage({ data: { id: 6, type: 'transcribe' } });
    expect(asr).toHaveBeenCalledWith(
      expect.any(Float32Array),
      expect.objectContaining({
        task: 'transcribe',
        return_timestamps: false,
        condition_on_previous_text: false,
        no_repeat_ngram_size: 3,
        language: 'spanish',
        initial_prompt: 'flu',
      }),
    );
    expect(reply).toHaveBeenCalledWith(true, { text: 'hola mundo' });
  });

  it('audio vacio responde texto vacio sin invocar la pipeline', async () => {
    const onmessage = await montar();
    const asr = vi.fn();
    h.pipeline.mockResolvedValue(asr);
    buf.samplesFromTransfer.mockReturnValue(new Float32Array([]));
    await onmessage({ data: { id: 7, type: 'transcribe' } });
    expect(asr).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(true, { text: '' });
  });

  it('language e initialPrompt del payload ganan a la config', async () => {
    const onmessage = await montar();
    const asr = vi.fn(async () => ({ text: 'x' }));
    h.pipeline.mockResolvedValue(asr);
    await onmessage({ data: { id: 8, type: 'transcribe', payload: { language: 'english', initialPrompt: 'custom' } } });
    expect(asr).toHaveBeenCalledWith(
      expect.any(Float32Array),
      expect.objectContaining({ language: 'english', initial_prompt: 'custom' }),
    );
  });

  it('salida sin text cae a cadena vacia', async () => {
    const onmessage = await montar();
    h.pipeline.mockResolvedValue(async () => ({}));
    await onmessage({ data: { id: 9, type: 'transcribe' } });
    expect(reply).toHaveBeenCalledWith(true, { text: '' });
  });
});

describe('whisperAsr.worker — errores', () => {
  it('tipo desconocido responde ok=false con Error descriptivo', async () => {
    const onmessage = await montar();
    await onmessage({ data: { id: 10, type: 'otra-cosa' } });
    const [ok, data, err] = reply.mock.calls[0];
    expect(ok).toBe(false);
    expect(data).toBeNull();
    expect(String(err.message)).toContain('unknown worker message type');
  });

  it('si la pipeline falla, se registra y se responde ok=false con el error', async () => {
    const onmessage = await montar();
    const boom = new Error('sin modelo');
    h.pipeline.mockRejectedValue(boom);
    await onmessage({ data: { id: 11, type: 'transcribe' } });
    expect(reply).toHaveBeenCalledWith(false, null, boom);
    expect(log.logCaughtError).toHaveBeenCalledTimes(1);
    expect(String(log.logCaughtError.mock.calls[0][0])).toContain('whisperAsr.worker.js');
  });

  it('un evento sin data no revienta: cae en tipo desconocido', async () => {
    const onmessage = await montar();
    await onmessage({});
    expect(reply.mock.calls[0][0]).toBe(false);
  });
});
