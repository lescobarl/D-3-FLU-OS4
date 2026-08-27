// ============================================================
// SeasonalEffects — invariantes data-driven
// ============================================================
// Verifica que el overlay creativo por temporada:
//  - cubre 1:1 TODAS las paletas con decoración (nada inventado)
//  - deja sin efecto las paletas SIN decoración
//  - genera partículas deterministas y válidas
// ============================================================
import { describe, it, expect } from 'vitest';
import { PALETTES } from '../src/core/branding/seasonalPalettes';
import {
  SEASONAL_EFFECTS,
  getSeasonalEffect,
  buildParticles,
  type SeasonalEffectConfig,
} from '../src/core/branding/SeasonalEffects';

describe('SeasonalEffects — cobertura data-driven vs PALETTES', () => {
  const decoratedSeasons = Object.entries(PALETTES)
    .filter(([, palette]) => Boolean(palette.decoration))
    .map(([key]) => key);
  const plainSeasons = Object.entries(PALETTES)
    .filter(([, palette]) => !palette.decoration)
    .map(([key]) => key);

  it('toda paleta CON decoración tiene un efecto de temporada', () => {
    for (const season of decoratedSeasons) {
      expect(getSeasonalEffect(season), `falta efecto para "${season}"`).not.toBeNull();
    }
  });

  it('toda clave de SEASONAL_EFFECTS existe en PALETTES (sin claves inventadas)', () => {
    for (const key of Object.keys(SEASONAL_EFFECTS)) {
      expect(PALETTES[key], `clave inventada: "${key}"`).toBeDefined();
    }
  });

  it('toda paleta SIN decoración NO genera efecto (default/maestro/trabajo/padres)', () => {
    expect(plainSeasons.length).toBeGreaterThan(0);
    for (const season of plainSeasons) {
      expect(getSeasonalEffect(season), `"${season}" no debería tener efecto`).toBeNull();
    }
  });

  it('el efecto ecológico existe (branding ecológico DeepSeek)', () => {
    expect(getSeasonalEffect('ecologico')).not.toBeNull();
  });
});

describe('SeasonalEffects — invariantes de configuración', () => {
  it('toda entrada tiene emojis, count y motion válidos con rangos coherentes', () => {
    for (const [key, cfg] of Object.entries(SEASONAL_EFFECTS) as [string, SeasonalEffectConfig][]) {
      expect(cfg.emojis.length, `"${key}" sin emojis`).toBeGreaterThan(0);
      expect(cfg.count, `"${key}" count<=0`).toBeGreaterThan(0);
      expect(['fall', 'rise']).toContain(cfg.motion);
      expect(cfg.durationRange[0], `"${key}" duración inválida`).toBeLessThanOrEqual(cfg.durationRange[1]);
      expect(cfg.opacityRange[0], `"${key}" opacidad inválida`).toBeLessThanOrEqual(cfg.opacityRange[1]);
      expect(cfg.opacityRange[0], `"${key}" opacidad fuera de rango`).toBeGreaterThanOrEqual(0);
      expect(cfg.opacityRange[1], `"${key}" opacidad fuera de rango`).toBeLessThanOrEqual(1);
      expect(cfg.sizeRange[0], `"${key}" tamaño inválido`).toBeLessThanOrEqual(cfg.sizeRange[1]);
      expect(cfg.sizeRange[0], `"${key}" tamaño negativo`).toBeGreaterThan(0);
    }
  });
});

describe('SeasonalEffects — buildParticles determinista', () => {
  it('mismo seed → mismas partículas (toEqual)', () => {
    const cfg = getSeasonalEffect('primavera');
    expect(cfg).not.toBeNull();
    if (!cfg) return;
    const a = buildParticles(cfg, cfg.count, 2026);
    const b = buildParticles(cfg, cfg.count, 2026);
    expect(a).toEqual(b);
  });

  it('seed distinto → partículas distintas', () => {
    const cfg = getSeasonalEffect('primavera');
    expect(cfg).not.toBeNull();
    if (!cfg) return;
    const a = buildParticles(cfg, cfg.count, 2026);
    const b = buildParticles(cfg, cfg.count, 7);
    expect(a).not.toEqual(b);
  });

  it('genera exactamente `count` partículas válidas para toda temporada decorada', () => {
    for (const [key, cfg] of Object.entries(SEASONAL_EFFECTS) as [string, SeasonalEffectConfig][]) {
      const particles = buildParticles(cfg, cfg.count, 2026);
      expect(particles.length, `"${key}" cantidad`).toBe(cfg.count);
      for (const p of particles) {
        expect(p.left, `"${key}" left`).toBeGreaterThanOrEqual(0);
        expect(p.left, `"${key}" left`).toBeLessThanOrEqual(100);
        expect(p.duration, `"${key}" duración`).toBeGreaterThan(0);
        expect(p.fontSize, `"${key}" tamaño`).toBeGreaterThan(0);
        expect(p.opacity, `"${key}" opacidad`).toBeGreaterThanOrEqual(0);
        expect(p.opacity, `"${key}" opacidad`).toBeLessThanOrEqual(1);
        expect(cfg.emojis).toContain(p.emoji);
        expect(p.delay, `"${key}" delay`).toBeLessThanOrEqual(0);
      }
    }
  });
});
