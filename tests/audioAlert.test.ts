// ============================================================
// audioAlert — tono de alarma con WebAudio (degradación elegante)
// ------------------------------------------------------------
// El driver valida `typeof window` antes de tocar audio; para
// ejercitar la lógica real en vitest se inyecta un AudioContext
// falso y se garantiza que `window` exista (vi.stubGlobal).
// Regla #1: sin hardcode — frecuencias/duración/volumen inyectables.
// ============================================================

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNoopDriver,
  createWebAudioDriver,
  type AudioContextLike,
} from '../src/core/temporal/audioAlert';

// Algunos entornos de vitest no definen `window`; se garantiza para
// que el driver no haga el early-return y sí cree los osciladores.
beforeEach(() => {
  vi.stubGlobal('window', {});
});
afterAll(() => {
  vi.unstubAllGlobals();
});

interface FakeBag {
  ctx: AudioContextLike & { resume: ReturnType<typeof vi.fn> };
  oscillators: Array<{
    type: string;
    frequency: { value: number };
    connect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }>;
  gains: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn> }>;
}

function createFakeContext(state = 'running'): FakeBag {
  const oscillators: FakeBag['oscillators'] = [];
  const gains: FakeBag['gains'] = [];
  const ctx: FakeBag['ctx'] = {
    state,
    currentTime: 0,
    destination: {},
    resume: vi.fn(async () => undefined),
    createOscillator() {
      const osc = {
        type: '',
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(osc);
      return osc;
    },
    createGain() {
      const gain = { gain: { value: 0 }, connect: vi.fn() };
      gains.push(gain);
      return gain;
    },
  } as unknown as FakeBag['ctx'];
  return { ctx, oscillators, gains };
}

describe('audioAlert — createWebAudioDriver', () => {
  it('play crea beeps osciladores por defecto (880 Hz, 3 beeps, 0.4 de volumen)', async () => {
    const fake = createFakeContext();
    const driver = createWebAudioDriver(() => fake.ctx);

    expect(driver.isSupported()).toBe(true);
    await driver.play();

    expect(fake.oscillators.length).toBe(3);
    for (const osc of fake.oscillators) {
      expect(osc.type).toBe('sine');
      expect(osc.frequency.value).toBe(880);
      expect(osc.start).toHaveBeenCalled();
      expect(osc.stop).toHaveBeenCalled();
    }
    for (const gain of fake.gains) {
      expect(gain.gain.value).toBe(0.4);
    }
    // stepSec = (500 + 150) / 1000 = 0.65s → starts en 0, 0.65, 1.3.
    expect(fake.oscillators[0].start).toHaveBeenCalledWith(0);
    expect(fake.oscillators[1].start).toHaveBeenCalledWith(0.65);
    expect(fake.oscillators[2].start).toHaveBeenCalledWith(1.3);
    // stop = startAt + durationMs/1000 (0.5s).
    expect(fake.oscillators[0].stop).toHaveBeenCalledWith(0.5);
    // Cada oscilador se conecta a su gain y cada gain al destination.
    expect(fake.oscillators[0].connect).toHaveBeenCalledWith(fake.gains[0]);
    expect(fake.gains[0].connect).toHaveBeenCalledWith(fake.ctx.destination);
  });

  it('respeta las opciones inyectadas (frecuencia, beeps, duración, pausa, volumen)', async () => {
    const fake = createFakeContext();
    const driver = createWebAudioDriver(() => fake.ctx);

    await driver.play({ frequency: 440, durationMs: 1000, beeps: 2, gapMs: 200, volume: 0.8 });

    expect(fake.oscillators.length).toBe(2);
    expect(fake.oscillators[0].frequency.value).toBe(440);
    expect(fake.gains[0].gain.value).toBe(0.8);
    // stepSec = (1000 + 200) / 1000 = 1.2s.
    expect(fake.oscillators[1].start).toHaveBeenCalledWith(1.2);
    expect(fake.oscillators[0].stop).toHaveBeenCalledWith(1.0);
  });

  it('reanuda un contexto suspendido antes de sonar', async () => {
    const fake = createFakeContext('suspended');
    const driver = createWebAudioDriver(() => fake.ctx);

    await driver.play({ beeps: 1 });
    expect(fake.ctx.resume).toHaveBeenCalledTimes(1);
    expect(fake.oscillators.length).toBe(1);
  });

  it('no reanuda un contexto ya running', async () => {
    const fake = createFakeContext('running');
    const driver = createWebAudioDriver(() => fake.ctx);

    await driver.play({ beeps: 1 });
    expect(fake.ctx.resume).not.toHaveBeenCalled();
  });

  it('contexto nulo → play resuelve sin crear osciladores', async () => {
    const driver = createWebAudioDriver(() => null);
    expect(driver.isSupported()).toBe(false);
    await expect(driver.play()).resolves.toBeUndefined();
  });

  it('getContext lanza → play resuelve (degradación elegante, nunca falla)', async () => {
    const driver = createWebAudioDriver(() => {
      throw new Error('audio bloqueado');
    });
    expect(driver.isSupported()).toBe(false);
    await expect(driver.play()).resolves.toBeUndefined();
  });

  it('driver por defecto con window sin AudioContext → no soportado y play no-op', async () => {
    const driver = createWebAudioDriver();
    expect(driver.isSupported()).toBe(false);
    await expect(driver.play()).resolves.toBeUndefined();
    driver.stop();
  });
});

describe('audioAlert — createNoopDriver', () => {
  it('nunca soporta audio y todas sus operaciones resuelven', async () => {
    const driver = createNoopDriver();
    expect(driver.isSupported()).toBe(false);
    await expect(driver.play()).resolves.toBeUndefined();
    expect(() => driver.stop()).not.toThrow();
  });
});
