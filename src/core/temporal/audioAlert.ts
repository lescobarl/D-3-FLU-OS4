// ============================================================
// Audio Alert — Tono de alarma con WebAudio (degradación elegante)
// ------------------------------------------------------------
// El navegador puede bloquear WebAudio sin gesto previo del
// usuario; por eso el driver se inyecta y cualquier fallo degrada
// a toast + voz sin romper el flujo (Regla de diseño: nunca fallar).
// Regla #1: sin hardcode — frecuencias/duración/volumen se inyectan
// desde FLU_CONFIG.temporal.sound (valores por defecto solo aquí,
// en la frontera de bajo nivel, NO en la lógica de negocio).
// ============================================================

export interface SoundOptions {
  /** Frecuencia en Hz del beep. */
  frequency?: number;
  /** Duración de cada beep en ms. */
  durationMs?: number;
  /** Número de beeps. */
  beeps?: number;
  /** Pausa entre beeps en ms. */
  gapMs?: number;
  /** Volumen 0..1. */
  volume?: number;
}

export interface AudioDriver {
  isSupported(): boolean;
  play(opts?: SoundOptions): Promise<void>;
  stop(): void;
}

export interface AudioContextLike {
  state?: string;
  currentTime: number;
  destination: unknown;
  resume?: () => Promise<void>;
  createOscillator(): unknown;
  createGain(): unknown;
}

type AudioContextFactory = () => AudioContextLike | null;

/** Factoría por defecto: crea un AudioContext real del navegador. */
function defaultGetContext(): AudioContextLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const AC = w.AudioContext || w.webkitAudioContext;
  return AC ? new AC() : null;
}

/** Crea un driver WebAudio real con la factoría de contexto inyectable. */
export function createWebAudioDriver(getContext: AudioContextFactory = defaultGetContext): AudioDriver {
  let ctx: AudioContextLike | null = null;
  // Nodos activos para poder DETENER el tono (alarma sonando → stop).
  const activeNodes: Array<{
    osc: { stop: (t: number) => void; disconnect?: () => void };
    gain?: { disconnect?: () => void };
  }> = [];

  const isSupported = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
      return Boolean(getContext());
    } catch {
      return false;
    }
  };

  const play = async (opts: SoundOptions = {}): Promise<void> => {
    if (typeof window === 'undefined') return;
    try {
      ctx = getContext();
      if (!ctx) return;
      const frequency = opts.frequency ?? 880;
      const durationMs = opts.durationMs ?? 500;
      const beeps = opts.beeps ?? 3;
      const gapMs = opts.gapMs ?? 150;
      const volume = opts.volume ?? 0.4;
      if (ctx.state === 'suspended' && ctx.resume) await ctx.resume();
      const stepSec = (durationMs + gapMs) / 1000;
      for (let i = 0; i < beeps; i += 1) {
        const osc = ctx.createOscillator() as {
          type: string;
          frequency: { value: number };
          connect: (node: unknown) => void;
          start: (t: number) => void;
          stop: (t: number) => void;
          disconnect?: () => void;
        };
        const gain = ctx.createGain() as {
          gain: { value: number };
          connect: (node: unknown) => void;
          disconnect?: () => void;
        };
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.value = volume;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const startAt = ctx.currentTime + i * stepSec;
        osc.start(startAt);
        osc.stop(startAt + durationMs / 1000);
        activeNodes.push({ osc, gain });
      }
    } catch {
      // Degradación elegante: el hook avisa con toast + voz.
    }
  };

  const stop = (): void => {
    // Detiene y libera los osciladores programados/activos (alarma sonando).
    while (activeNodes.length) {
      const node = activeNodes.pop();
      try {
        node?.osc?.stop(0);
      } catch {
        /* ya detenido */
      }
      try {
        node?.osc?.disconnect?.();
      } catch {
        /* ignorar */
      }
      try {
        node?.gain?.disconnect?.();
      } catch {
        /* ignorar */
      }
    }
  };

  return { isSupported, play, stop };
}

/** Driver silencioso (tests / entorno sin soporte de audio). */
export function createNoopDriver(): AudioDriver {
  return {
    isSupported: () => false,
    play: async () => undefined,
    stop: () => undefined,
  };
}
