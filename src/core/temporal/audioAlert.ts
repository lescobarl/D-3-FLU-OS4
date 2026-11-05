import { logCaughtError } from '../../lib/caughtError';

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
  /** Repeticiones del patrón completo (además del primero). Ej. 2 → suena 3 veces. */
  repeat?: number;
  /** Intervalo entre repeticiones del patrón, en ms. */
  repeatIntervalMs?: number;
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
  const AC = (Reflect.get(window, 'AudioContext') || Reflect.get(window, 'webkitAudioContext')) as
    | (new () => AudioContextLike)
    | undefined;
  return AC ? new AC() : null;
}

/** Crea un driver WebAudio real con la factoría de contexto inyectable. */
export function createWebAudioDriver(getContext: AudioContextFactory = defaultGetContext): AudioDriver {
  let ctx: AudioContextLike | null = null;
  // Generación de reproducción: `stop()` la incrementa para invalidar cualquier
  // `play()` en vuelo (p. ej. mientras el AudioContext se reanuda) y evitar que
  // programe beeps DESPUÉS de "Detener".
  let generation = 0;
  // Nodos activos para poder DETENER el tono (alarma sonando → stop).
  const activeNodes: Array<{
    osc: { stop: (t: number) => void; disconnect?: () => void };
    gain?: { disconnect?: () => void };
  }> = [];
  // Timers de las REPETICIONES del patrón (la alarma insiste): `stop()` los cancela.
  const repeatTimers: Array<ReturnType<typeof setTimeout>> = [];

  const isSupported = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
      return Boolean(getContext());
    } catch (e) {
        logCaughtError('[catch] src/core/temporal/audioAlert.ts', e);
      return false;
    }
  };

  const play = async (opts: SoundOptions = {}): Promise<void> => {
    if (typeof window === 'undefined') return;
    const myGeneration = generation;
    try {
      ctx = getContext();
      if (!ctx) return;
      const frequency = opts.frequency ?? 880;
      const durationMs = opts.durationMs ?? 500;
      const beeps = opts.beeps ?? 3;
      const gapMs = opts.gapMs ?? 150;
      const volume = opts.volume ?? 0.4;
      // La alarma "insiste": por defecto suena 3 veces separadas 10 s
      // (configurable por FLU_CONFIG.temporal.sound).
      const repeat = Math.max(0, Math.floor(opts.repeat ?? 2));
      const repeatIntervalMs = opts.repeatIntervalMs ?? 10_000;
      if (ctx.state === 'suspended' && ctx.resume) await ctx.resume();
      // stop() durante el resume invalida esta reproducción.
      if (myGeneration !== generation) return;
      const scheduleBurst = (): void => {
        if (myGeneration !== generation || !ctx) return;
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
      };
      scheduleBurst();
      for (let r = 1; r <= repeat; r += 1) {
        const timer = setTimeout(() => {
          if (myGeneration !== generation) return;
          scheduleBurst();
        }, r * repeatIntervalMs);
        repeatTimers.push(timer);
      }
    } catch (e) {
        logCaughtError('[catch] src/core/temporal/audioAlert.ts', e);
      // Degradación elegante: el hook avisa con toast + voz.
    }
  };

  const stop = (): void => {
    // Invalida cualquier play() en vuelo, cancela las repeticiones pendientes y
    // detiene/libera los osciladores programados o activos (alarma sonando).
    generation += 1;
    while (repeatTimers.length) {
      const timer = repeatTimers.pop();
      if (timer) clearTimeout(timer);
    }
    while (activeNodes.length) {
      const node = activeNodes.pop();
      try {
        node?.osc?.stop(0);
      } catch (e) {
        logCaughtError('[catch] src/core/temporal/audioAlert.ts', e);
        /* ya detenido */
      }
      try {
        node?.osc?.disconnect?.();
      } catch (e) {
        logCaughtError('[catch] src/core/temporal/audioAlert.ts', e);
        /* ignorar */
      }
      try {
        node?.gain?.disconnect?.();
      } catch (e) {
        logCaughtError('[catch] src/core/temporal/audioAlert.ts', e);
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
