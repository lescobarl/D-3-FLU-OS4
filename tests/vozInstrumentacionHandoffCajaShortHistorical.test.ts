/**
 * Instrumentacion (nace ROJO) de los 3 defectos de voz medidos en el log real del dueno.
 * NO toca src/**: solo MIDE el log de evidencia.
 * Override de ruta: variable de entorno FLU_VOZ_LOG.
 *
 * GROUND TRUTH FRESCA: solo un log producido por el codigo VIGENTE puede juzgarlo. El
 * handoff preflight->commit se corrigio el 2026-10-16 (commit 9c42907), asi que un log
 * ANTERIOR mide un bundle previo y sus valores (commits=34 preReady=true=0, D1=3,
 * short-historical=45 en el log 2026-10-15) NO son ground truth de HEAD. Mismo criterio
 * que logRevisionGuard (D6_DESDE): la sonda solo juzga logs >= FRESH_FROM.
 * Sin log fresco NO se inventa evidencia: los guards se SALTAN (runIf); antes el fichero
 * reventaba en la recoleccion (throw en el cuerpo del describe) en cualquier maquina sin
 * el log del dueno. Con un log fresco, vuelve a exigir los 3 invariantes (y FALLA si el
 * defecto sigue).
 *
 * ACTUALIDAD MEDIDA (2026-10-18): la fecha del nombre es un proxy GRUESO; un log del
 * MISMO dia capturado ANTES del ultimo cambio de `src/` mide un bundle anterior. Medido:
 * el log de 14:40 (0/17 preReady, D1=2) parecia defecto de HEAD y era del bundle previo
 * a los fixes de las 15:02. Un log solo es ground truth si se capturo DESPUES del
 * ultimo cambio de `src/`; si no, se salta igual que si no hubiera log. No se borra
 * evidencia: el log viejo sigue en TEMP y se juzga cuando haya uno posterior.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const TEMP = process.env.TEMP || process.env.TMP || ''
const FRESH_FROM = '2026-10-16'

/** Mtime mas reciente de `src/`: el codigo que el log debe estar midiendo. */
export function ultimoCambioDeSrc(dir = join(process.cwd(), 'src')): number {
  let ultimo = 0
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name)
    ultimo = Math.max(ultimo, entrada.isDirectory() ? ultimoCambioDeSrc(ruta) : statSync(ruta).mtimeMs)
  }
  return ultimo
}

/**
 * ¿El log se capturo despues del ultimo cambio de `src/`?
 * @param capturadoMs mtime del log (el vigilante lo copia mientras crece).
 * @param ultimoSrcMs mtime mas reciente de `src/`.
 * @returns `true` solo si el log puede medir el codigo vigente.
 */
export function logEsDeCodigoVigente(capturadoMs: number, ultimoSrcMs: number): boolean {
  return capturadoMs >= ultimoSrcMs
}

function fechaDe(ruta: string): string {
  const m = ruta.match(/(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

function loadLog(): { path: string; raw: string } | null {
  const ultimoSrc = ultimoCambioDeSrc()
  let enTemp: string[] = []
  try {
    enTemp = readdirSync(TEMP)
      .filter((f) => f.startsWith('flu-debug-owner-') && f.endsWith('.log'))
      .map((f) => join(TEMP, f))
  } catch { enTemp = [] }
  const candidates = [process.env.FLU_VOZ_LOG, ...enTemp]
    .filter((p): p is string => Boolean(p))
    .filter((p) => existsSync(p))
    .filter((p) => { const f = fechaDe(p); return Boolean(f) && f >= FRESH_FROM })
    // Solo logs posteriores al ultimo cambio de src: uno anterior mide otro bundle.
    .filter((p) => logEsDeCodigoVigente(statSync(p).mtimeMs, ultimoSrc))
    .sort((a, b) => b.localeCompare(a))
  for (const p of candidates) {
    const raw = readFileSync(p, 'utf8')
    if (raw.includes('VozProbe')) return { path: p, raw }
  }
  return null
}

const LOG = loadLog()

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

describe('voz instrumentacion - el detector de ACTUALIDAD no es decorativo', () => {
  it('un log anterior al ultimo cambio de src NO es ground truth; uno posterior SI', () => {
    // Entrada infractora: el log de 14:40 contra los fixes de 15:02.
    expect(logEsDeCodigoVigente(1000, 2000)).toBe(false)
    // Entradas legitimas: mismo instante y captura posterior.
    expect(logEsDeCodigoVigente(2000, 2000)).toBe(true)
    expect(logEsDeCodigoVigente(2001, 2000)).toBe(true)
  })
});

describe('voz instrumentacion ROJA: handoff preflight->commit, caja D1, short-historical', () => {
  it.runIf(LOG !== null)('GUARD 1 handoff preflight->commit: todo commit debe tener preReady=true (hoy 0/34 -> FALLA)', () => {
    const { path: logPath, raw } = LOG!;
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

  it.runIf(LOG !== null)('GUARD 2 caja D1/duplicados: shown no debe repetir+extender el shown previo (hoy 3 -> FALLA)', () => {
    const { path: logPath, raw } = LOG!;
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

  it.runIf(LOG !== null)('GUARD 3 short-historical: no debe etiquetar Hablante N cuando existe primario nombrado (hoy 45 -> FALLA)', () => {
    const { path: logPath, raw } = LOG!;
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