// ============================================================
// SeasonalEffects — Overlay creativo por temporada
// ============================================================
// Capa full-screen de partículas por temporada (fall/rise),
// data-driven desde SEASONAL_EFFECTS. NO toca el pizarrón:
// su identidad es FIJA (--board-* en App.css). Complementa el
// cambio de paleta con un efecto TEMÁTICO real por estación
// (caen flores en primavera, copos en invierno, chispas en
// año nuevo, etc.) — no solo un cambio de colores.
// ============================================================
import { useMemo } from 'react';
import type { CSSProperties } from 'react';

export interface SeasonalEffectConfig {
  emojis: string[];
  count: number;
  motion: 'fall' | 'rise';
  durationRange: [number, number];
  opacityRange: [number, number];
  sizeRange: [number, number];
}

// 17 temporadas con decoración real (coinciden 1:1 con PALETTES).
// Las temporadas SIN decoración (default/maestro/trabajo/padres)
// NO tienen entrada aquí: getSeasonalEffect devuelve null.
export const SEASONAL_EFFECTS: Record<string, SeasonalEffectConfig> = {
  navidad: {
    emojis: ['❄️', '⭐', '🎄'],
    count: 20,
    motion: 'fall',
    durationRange: [6, 14],
    opacityRange: [0.5, 0.9],
    sizeRange: [14, 26],
  },
  muertos: {
    emojis: ['🌼', '💀', '🕯️'],
    count: 18,
    motion: 'fall',
    durationRange: [7, 15],
    opacityRange: [0.45, 0.85],
    sizeRange: [14, 26],
  },
  patrio: {
    emojis: ['🎆', '🎊', '🎉', '🪅'],
    count: 18,
    motion: 'fall',
    durationRange: [5, 12],
    opacityRange: [0.5, 0.9],
    sizeRange: [14, 24],
  },
  infantil: {
    emojis: ['🎈', '🎉', '🧸', '🎠'],
    count: 20,
    motion: 'fall',
    durationRange: [6, 13],
    opacityRange: [0.5, 0.9],
    sizeRange: [14, 26],
  },
  cumpleanos: {
    emojis: ['🎉', '🎊', '🎈', '🎂'],
    count: 22,
    motion: 'fall',
    durationRange: [5, 12],
    opacityRange: [0.5, 0.95],
    sizeRange: [14, 28],
  },
  ano_nuevo: {
    emojis: ['🎆', '🎊', '🥂', '✨'],
    count: 22,
    motion: 'fall',
    durationRange: [5, 12],
    opacityRange: [0.5, 0.95],
    sizeRange: [14, 26],
  },
  reyes: {
    emojis: ['👑', '⭐', '✨', '🌙'],
    count: 20,
    motion: 'fall',
    durationRange: [6, 14],
    opacityRange: [0.5, 0.9],
    sizeRange: [14, 26],
  },
  san_valentin: {
    emojis: ['❤️', '💖', '💘', '🌹'],
    count: 20,
    motion: 'fall',
    durationRange: [6, 13],
    opacityRange: [0.5, 0.9],
    sizeRange: [14, 26],
  },
  primavera: {
    emojis: ['🌸', '🌷', '🦋', '💐'],
    count: 22,
    motion: 'fall',
    durationRange: [6, 14],
    opacityRange: [0.5, 0.9],
    sizeRange: [14, 26],
  },
  san_patricio: {
    emojis: ['🍀', '✨', '🌈', '💚'],
    count: 20,
    motion: 'fall',
    durationRange: [6, 13],
    opacityRange: [0.5, 0.9],
    sizeRange: [14, 26],
  },
  tierra: {
    emojis: ['🌿', '🌱', '🍃', '🌍'],
    count: 20,
    motion: 'fall',
    durationRange: [6, 14],
    opacityRange: [0.5, 0.9],
    sizeRange: [14, 26],
  },
  madres: {
    emojis: ['💐', '🌹', '🌸', '💝'],
    count: 18,
    motion: 'fall',
    durationRange: [6, 14],
    opacityRange: [0.5, 0.9],
    sizeRange: [14, 26],
  },
  verano: {
    emojis: ['☀️', '✨', '🌈', '🕶️'],
    count: 18,
    motion: 'rise',
    durationRange: [6, 13],
    opacityRange: [0.5, 0.9],
    sizeRange: [16, 28],
  },
  otono: {
    emojis: ['🍂', '🍁', '🍃', '🌰'],
    count: 22,
    motion: 'fall',
    durationRange: [6, 14],
    opacityRange: [0.5, 0.9],
    sizeRange: [14, 26],
  },
  halloween: {
    emojis: ['🦇', '🎃', '👻', '🕷️'],
    count: 20,
    motion: 'fall',
    durationRange: [6, 14],
    opacityRange: [0.5, 0.9],
    sizeRange: [14, 26],
  },
  invierno: {
    emojis: ['❄️', '⭐', '☃️', '🌨️'],
    count: 22,
    motion: 'fall',
    durationRange: [6, 14],
    opacityRange: [0.5, 0.9],
    sizeRange: [14, 26],
  },
  ecologico: {
    emojis: ['🌱', '🍃', '🌿', '💚'],
    count: 18,
    motion: 'fall',
    durationRange: [6, 14],
    opacityRange: [0.45, 0.85],
    sizeRange: [14, 24],
  },
};

export function getSeasonalEffect(season: string): SeasonalEffectConfig | null {
  return SEASONAL_EFFECTS[season] ?? null;
}

export interface SeasonalParticle {
  id: number;
  emoji: string;
  left: number; // %
  delay: number; // s (negativo → arranque inmediato escalonado)
  duration: number; // s
  fontSize: number; // px
  opacity: number; // 0..1
  spin: number; // deg
  drift: number; // px (desplazamiento horizontal)
}

// PRNG determinista (mulberry32) — partículas reproducibles (tests)
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rand: () => number, min: number, max: number): number {
  return min + rand() * (max - min);
}

export function buildParticles(
  config: SeasonalEffectConfig,
  count: number,
  seed = 2026,
): SeasonalParticle[] {
  const rand = mulberry32(seed);
  const particles: SeasonalParticle[] = [];
  const [dMin, dMax] = config.durationRange;
  const [oMin, oMax] = config.opacityRange;
  const [sMin, sMax] = config.sizeRange;
  for (let i = 0; i < count; i += 1) {
    particles.push({
      id: i,
      emoji: config.emojis[Math.floor(rand() * config.emojis.length)],
      left: rand() * 100,
      delay: -rand() * (dMax - dMin),
      duration: randRange(rand, dMin, dMax),
      fontSize: randRange(rand, sMin, sMax),
      opacity: randRange(rand, oMin, oMax),
      spin: randRange(rand, -360, 360),
      drift: randRange(rand, -60, 60),
    });
  }
  return particles;
}

export interface SeasonalEffectsProps {
  season: string;
  enabled?: boolean;
}

export function SeasonalEffects({ season, enabled = true }: SeasonalEffectsProps) {
  const effect = useMemo(() => getSeasonalEffect(season), [season]);
  const particles = useMemo(
    () => (effect ? buildParticles(effect, effect.count) : []),
    [effect],
  );

  if (!enabled || !effect || particles.length === 0) {
    return null;
  }

  const isRise = effect.motion === 'rise';

  return (
    <div className="seasonal-effects" aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.id}
          className={
            isRise
              ? 'seasonal-effects__particle seasonal-effects__particle--rise'
              : 'seasonal-effects__particle'
          }
          style={
            {
              left: `${p.left}%`,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
              fontSize: `${p.fontSize}px`,
              opacity: p.opacity,
              '--particle-opacity': p.opacity,
              '--particle-spin': `${p.spin}deg`,
              '--particle-drift': `${p.drift}px`,
            } as CSSProperties
          }
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}
