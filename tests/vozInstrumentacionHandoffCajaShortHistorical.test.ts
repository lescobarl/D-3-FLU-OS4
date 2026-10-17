/**
 * Instrumentacion (nace ROJO) de los 3 defectos de voz medidos en el log real del dueno.
 * NO toca src/**: solo MIDE el log de evidencia. Evidencia:
 *   %TEMP%\flu-debug-owner-2026-10-15-12h16-12h20.log
 * Override de ruta: variable de entorno FLU_VOZ_LOG.
 * Valores HOY medidos en ese log (2026-10-15):
 *   - commits=34, preReady=true=0, src=sticky-preflight-pending=34
 *   - D1 (shown repite+extiende el previous)=3
 *   - Identity reason=production-short-historical con label generico Hablante N=45
 * Estos 3 guards DEBEN fallar mientras esos valores sigan.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function loadLog() {
  const candidates = [
    process.env.FLU_VOZ_LOG,
    join(process.env.TEMP || process.env.TMP || '', 'flu-debug-owner-2026-10-15-12h16-12h20.log'),
    join(process.env.TEMP || process.env.TMP || '', 'flu-debug-owner-2026-10-14-18h26-18h33.log'),
  ].filter(Boolean) as string[]
  for (const p of candidates) {
    if (p && existsSync(p)) return { path: p, raw: readFileSync(p, 'utf8') }
  }
  throw new Error('Sin log de voz de evidencia. Define FLU_VOZ_LOG con la ruta.')
}

function parseProbe(raw: string, tag: string) {
  const re = new RegExp('VozProbe ' + tag + ' (\\{[^}]+\\})', 'g')
  const out: any[] = []
  for (const m of raw.matchAll(re)) {
    try {
      out.push(JSON.parse(m[1]))
    } catch {}
  }
  return out
}

describe('voz instrumentacion ROJA: handoff preflight->commit, caja D1, short-historical', () => {
  const { path: logPath, raw } = loadLog();

  it('GUARD 1 handoff preflight->commit: todo commit debe tener preReady=true (hoy 0/34 -> FALLA)', () => {
    const commits = parseProbe(raw, 'commit');
    expect(commits.length, 'anti-vacio: deben existir commits en el log').toBeGreaterThan(0);
    const preReadyTrue = commits.filter((c) => c.preReady === true).length;
    const sticky = commits.filter((c) => c.src === 'sticky-preflight-pending').length;
    const ratio = preReadyTrue / commits.length;
    expect(
      ratio,
      'handoff roto: preflight no aterriza en el commit. LOG=' + logPath +
        ' commits=' + commits.length + ' preReady=true=' + preReadyTrue +
        ' src=sticky-preflight-pending=' + sticky + ' ratio=' + ratio.toFixed(3)
    ).toBe(1);
  });

  it('GUARD 2 caja D1/duplicados: shown no debe repetir+extender el shown previo (hoy 3 -> FALLA)', () => {
    const commits = parseProbe(raw, 'commit');
    expect(commits.length, 'anti-vacio: deben existir mas de 1 commit').toBeGreaterThan(1);
    let d1 = 0;
    for (let i = 1; i < commits.length; i++) {
      const prev = String(commits[i - 1].shown || '').trim();
      const cur = String(commits[i].shown || '').trim();
      if (prev && cur && cur.startsWith(prev) && cur.length > prev.length * 1.05) d1++;
    }
    expect(
      d1,
      'caja D1: shown repite+extiende el commit previo. LOG=' + logPath + ' d1=' + d1
    ).toBe(0);
  });

  it('GUARD 3 short-historical: no debe etiquetar Hablante N cuando existe primario nombrado (hoy 45 -> FALLA)', () => {
    const identityLines = [...raw.matchAll(/Identity ([^\n]*)reason=production-short-historical([^\n]*)/g)];
    expect(identityLines.length, 'anti-vacio: deben existir resoluciones short-historical').toBeGreaterThan(0);
    const genericos = identityLines.filter((m) => /(?:label|prefer)="Hablante/i.test(m[0])).length;
    expect(
      genericos,
      'short-historical: domina y etiqueta generico Hablante N en vez del nombre. LOG=' + logPath +
        ' short-historical=' + identityLines.length + ' con-label-generico=' + genericos
    ).toBe(0);
  });
});