/**
 * P4.3/P4.4/P4.5/P4.9/P4.13 - guard de duplicacion: un algoritmo, una copia.
 *
 * Estos cinco items eran el mismo defecto con cinco caras: la misma logica
 * escrita dos o mas veces, de modo que arreglar una copia no arregla las otras.
 * El guard lee los fuentes y exige que el algoritmo viva en un solo sitio.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';
import { AI_PROVIDERS, AI_PROVIDER_SYNONYMS } from '../src/core/config/sharedConfig';
import { walkFiles } from './_helpers'
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/');
/** Dueno unico del algoritmo de acentos. */
export const DIACRITICS_OWNER = 'src/lib/textUtils.ts';
/** Dueno unico del algoritmo de slug. */
export const SLUG_OWNER = 'src/lib/textUtils.ts';
/** Reimplementaciones del plegado NFD fuera del dueno. */
export function nfdOffenders(src: string, fileName: string): string[] {
  if (fileName === DIACRITICS_OWNER) return [];
  return src.includes("normalize('NFD')") ? [fileName] : [];
}
/** Definiciones de parseAllowlist en un fuente (debe haber una sola en src). */
export function allowlistDefinitions(src: string): number {
  return (src.match(/function parseAllowlist\s*\(/g) || []).length;
}
/** Declaraciones literales de la allowlist curada de wikipedia/educ.ar. */
export function curatedAllowlistLiterals(src: string): number {
  return (src.match(/\['wikipedia\.org', 'educ\.ar'\]/g) || []).length;
}
/** Dueno unico de la tokenizacion de frases (limites de palabra). */
export const TOKEN_HELPERS_OWNER = 'src/core/games/gameUtils.ts';
/** Definiciones locales de los token helpers fuera del dueno. */
export function tokenHelperOffenders(src: string, fileName: string): string[] {
  if (fileName === TOKEN_HELPERS_OWNER) return [];
  const defs = src.match(/\bfunction\s+(findTokenIndex|hasToken|hasAnyToken)\s*[(<]/g) || [];
  return defs.map((d) => `${fileName}: ${d.trim()}`);
}
/** Dueno unico del parseo del URL del request en los proxies. */
export const REQUEST_URL_OWNER = 'src/server/requestUrl.ts';
/**
 * Reimplementaciones del parseo del URL del request fuera del dueno.
 *
 * Detecta las DOS caras del mismo defecto: redeclarar la base ficticia
 * (`PARSE_BASE_URL`) y volver a copiar el `new URL(rawUrl, ...)` con su try/catch.
 * Ninguna de las dos debe reaparecer fuera del dueno.
 */
export function requestUrlOffenders(src: string, fileName: string): string[] {
  if (fileName === REQUEST_URL_OWNER) return [];
  const redeclaraBase = /\b(?:const|let|var)\s+PARSE_BASE_URL\b/.test(src);
  const copiaParseo = /new URL\(rawUrl,/.test(src);
  return redeclaraBase || copiaParseo ? [fileName] : [];
}
/** Dueno unico del remuestreo de audio (box low-pass). */
export const DOWNSAMPLE_OWNER = 'src/voice/lib/asr/resample.js';
/** Reimplementaciones de downsample fuera del dueno (definicion, no import). */
export function downsampleOffenders(src: string, fileName: string): string[] {
  if (fileName === DOWNSAMPLE_OWNER) return [];
  return /\b(function|const)\s+downsample\b/.test(src) ? [fileName] : [];
}
describe('P4.3/P4.4/P4.5/P4.9/P4.13 duplicacion - un algoritmo, una copia', () => {
  it('el plegado NFD existe solo en su dueno', () => {
    const offenders = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/).flatMap((f) => nfdOffenders(readFileSync(f, 'utf8'), rel(f)));
    expect(offenders, 'plegado NFD reimplementado fuera de ' + DIACRITICS_OWNER + ':\n  ' + offenders.join('\n  ')).toEqual([]);
  });
  it('el algoritmo de slug existe solo en su dueno; slugifyAmbiente delega', () => {
    const ambiente = readFileSync(join(ROOT, 'src/core/environments/ambienteFactory.ts'), 'utf8');
    expect(ambiente).toContain('slugifyPalette(nombre)');
    const owners = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/).filter((f) => /\.replace\(\/\[\^a-z0-9\]\+\/g, '-'\)/.test(readFileSync(f, 'utf8')));
    expect(owners.map(rel), 'algoritmo de slug duplicado').toEqual(['src/core/branding/paletaFactory.ts']);
  });
  it('la tokenizacion de frases existe solo en su dueno', () => {
    // La capa de voz ya NO se llama igual que la de juegos (C70: hasVoiceToken /
    // findVoiceTokenIndex), asi que no reabre este contrato y no necesita exencion: se
    // eximia a proposito y la exencion se retiro para que este guard no tenga zona ciega.
    const offenders = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)
      .flatMap((f) => tokenHelperOffenders(readFileSync(f, 'utf8'), rel(f)));
    expect(offenders, 'token helpers redefinidos fuera de ' + TOKEN_HELPERS_OWNER + ':\n  ' + offenders.join('\n  ')).toEqual([]);
  });
  it('parseAllowlist se define una sola vez y los proxies la importan', () => {
    const defs = walkFiles(join(SRC, 'server'), /\.(ts|tsx|js|jsx|mjs)$/).filter((f) => allowlistDefinitions(readFileSync(f, 'utf8')) > 0).map(rel);
    expect(defs, 'parseAllowlist definida en varios sitios').toEqual(['src/server/allowlist.ts']);
    for (const p of ['src/server/searchProxy.ts', 'src/server/browserProxy.ts']) {
      expect(readFileSync(join(ROOT, p), 'utf8'), p + ' no importa la allowlist compartida').toContain("from './allowlist'");
    }
  });
  it('la allowlist curada de wikipedia/educ.ar se declara una sola vez', () => {
    const cfg = readFileSync(join(ROOT, 'src/voice/lib/fluConfig.js'), 'utf8');
    expect(curatedAllowlistLiterals(cfg), 'allowlist curada repetida').toBe(1);
    expect(cfg).toContain('CURATED_ALLOWLIST');
  });
  it('el parseo del URL del request se define una sola vez y los proxies lo importan', () => {
    const offenders = walkFiles(join(SRC, 'server'), /\.(ts|tsx|js|jsx|mjs)$/)
      .flatMap((f) => requestUrlOffenders(readFileSync(f, 'utf8'), rel(f)));
    expect(offenders, 'parseo del URL del request copiado fuera de ' + REQUEST_URL_OWNER + ':\n  ' + offenders.join('\n  ')).toEqual([]);
    for (const p of ['src/server/searchProxy.ts', 'src/server/browserProxy.ts']) {
      expect(readFileSync(join(ROOT, p), 'utf8'), p + ' no importa el parseo compartido').toContain("from './requestUrl'");
    }
  });
  it('los sinonimos de proveedor cubren exactamente el catalogo', () => {
    expect(Object.keys(AI_PROVIDER_SYNONYMS).sort()).toEqual([...AI_PROVIDERS].sort());
  });
  it('el remuestreo de audio (downsample) existe solo en su dueno (P8.26)', () => {
    const offenders = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)
      .flatMap((f) => downsampleOffenders(readFileSync(f, 'utf8'), rel(f)));
    expect(offenders, 'downsample redefinido fuera de ' + DOWNSAMPLE_OWNER + ':\n  ' + offenders.join('\n  ')).toEqual([]);
    expect(readFileSync(join(ROOT, 'src/voice/lib/asr/whisperRecognitionEngine.js'), 'utf8')).toContain("from './resample.js'");
    expect(readFileSync(join(ROOT, 'src/dev/asrLab/AsrLab.tsx'), 'utf8')).toContain("from '../../voice/lib/asr/resample.js'");
  });
});
describe('P4.3/P4.4/P4.5/P4.9/P4.13 duplicacion - el detector no es decorativo', () => {
  it('marca el NFD reimplementado y no marca al dueno', () => {
    expect(nfdOffenders("x.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')", 'src/a.ts')).toHaveLength(1);
    expect(nfdOffenders("x.normalize('NFD')", DIACRITICS_OWNER)).toEqual([]);
  });
  it('marca los token helpers redefinidos y no marca al dueno', () => {
    expect(tokenHelperOffenders('function hasToken(n, p) { return true }', 'src/core/games/veoVeo.ts')).toHaveLength(1);
    expect(tokenHelperOffenders('function hasAnyToken(n, ps) {}', 'src/core/games/palabrasEncadenadas.ts')).toHaveLength(1);
    // El dueno puede definirlos; importarlos no cuenta como definicion.
    expect(tokenHelperOffenders('function hasToken(n, p) {}', TOKEN_HELPERS_OWNER)).toEqual([]);
    expect(tokenHelperOffenders("import { hasToken } from './gameUtils'", 'src/core/games/veoVeo.ts')).toEqual([]);
  });
  it('cuenta definiciones de parseAllowlist y literales de la allowlist', () => {
    expect(allowlistDefinitions('function parseAllowlist(raw) {}')).toBe(1);
    expect(allowlistDefinitions('import { parseAllowlist } from "./x"')).toBe(0);
    expect(curatedAllowlistLiterals("a: ['wikipedia.org', 'educ.ar']")).toBe(1);
    expect(curatedAllowlistLiterals('CURATED_ALLOWLIST')).toBe(0);
  });
  it('marca el parseo del URL del request reimplementado y no marca al dueno', () => {
    // Las dos caras del defecto: la base ficticia redeclarada y el parseo recopiado.
    expect(requestUrlOffenders("const PARSE_BASE_URL = 'http://localhost'", 'src/server/otroProxy.ts')).toHaveLength(1);
    expect(requestUrlOffenders('let parsed: URL; try { parsed = new URL(rawUrl, BASE) } catch {}', 'src/server/otroProxy.ts')).toHaveLength(1);
    // El dueno puede declararlos; importar el helper no cuenta como reimplementar.
    expect(requestUrlOffenders("const PARSE_BASE_URL = 'http://localhost'", REQUEST_URL_OWNER)).toEqual([]);
    expect(requestUrlOffenders("import { parseRequestUrl } from './requestUrl'", 'src/server/otroProxy.ts')).toEqual([]);
  });
  it('marca downsample reimplementado y no marca al dueno', () => {
    expect(downsampleOffenders('function downsample(s, a, b) {}', 'src/voice/lib/asr/otro.js')).toHaveLength(1);
    expect(downsampleOffenders('const downsample = (s, a, b) => s', 'src/dev/asrLab/otro.ts')).toHaveLength(1);
    expect(downsampleOffenders('function downsample(s, a, b) {}', DOWNSAMPLE_OWNER)).toEqual([]);
    expect(downsampleOffenders("import { downsample } from './resample.js'", 'src/voice/lib/asr/otro.js')).toEqual([]);
  });
});
describe('P7.20 duplicacion - isAIProvider con un solo dueno', () => {
  const DEFINICION = /export\s+function\s+isAIProvider\b/;
  it('isAIProvider se define una sola vez en src', () => {
    const defs = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/).filter((f) => DEFINICION.test(readFileSync(f, 'utf8'))).map(rel);
    expect(defs, 'isAIProvider definido en varios sitios').toEqual(['src/core/config/sharedConfig.ts']);
  });
  it('appTypeGuards re-exporta en vez de redefinir', () => {
    const g = readFileSync(join(ROOT, 'src/app/appTypeGuards.ts'), 'utf8');
    expect(DEFINICION.test(g), 'appTypeGuards sigue definiendo isAIProvider').toBe(false);
    expect(g).toContain("export { isAIProvider } from '../core/config/sharedConfig'");
  });
});

describe('P7.24 - el formato de clave de dia tiene un solo dueno', () => {
  const LITERAL = '/^\\d{4}-\\d{2}-\\d{2}$/';
  it('el literal solo aparece en src/lib/dateKey.ts', () => {
    const con = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)
      .filter((f) => readFileSync(f, 'utf8').includes(LITERAL))
      .map(rel);
    expect(con, 'formato de clave de dia copiado:\n  ' + con.join('\n  ')).toEqual(['src/lib/dateKey.ts']);
  });
  it('ningun modulo re-declara DATE_KEY_RE', () => {
    const con = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/).filter((f) => readFileSync(f, 'utf8').includes('DATE_KEY_RE')).map(rel);
    expect(con).toEqual([]);
  });
});

// ------------------------------------------------------------
// P4.x - nombres de calendario y lista de salud: un solo dueno
// ------------------------------------------------------------

/** Dueno unico de los nombres de dias y meses en espanol. */
export const CALENDAR_NAMES_OWNER = 'src/core/temporal/calendarNames.ts';
/** Dueno unico de la lista de componentes monitoreados. */
export const MONITORED_COMPONENTS_OWNER = 'src/core/autonomy/healthMonitor.ts';

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const DAYS_ES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const HEALTH_COMPONENTS = ['ai-service', 'indexed-db', 'network', 'memory', 'react-components'];

/**
 * Cuantos de `names` aparecen como LITERAL entrecomillado (una tabla de verdad).
 * Una alternancia de regex ("(enero|febrero|...)") va sin comillas y NO cuenta:
 * es un patron de busqueda, no una segunda copia de la tabla.
 */
export function quotedLiteralCount(src: string, names: readonly string[]): number {
  return names.filter((n) => new RegExp(`['"]${n}['"]`).test(src)).length;
}

/** Ficheros que recopian una tabla de `names` fuera de su dueno. */
export function nameTableOffenders(
  src: string,
  fileName: string,
  names: readonly string[],
  min: number,
  owner: string,
): string[] {
  if (fileName === owner) return [];
  return quotedLiteralCount(src, names) >= min ? [fileName] : [];
}

/**
 * Re-declaraciones de la lista de componentes monitoreados.
 *
 * El defecto era exactamente `monitoredComponents: [...]` recopiado, asi que se
 * exige la asignacion: un fichero que solo nombra los ids por otro motivo (p. ej.
 * las reglas de recuperacion por componente) no esta duplicando la lista.
 */
export function monitoredComponentsOffenders(src: string, fileName: string): string[] {
  if (fileName === MONITORED_COMPONENTS_OWNER) return [];
  const declaraLaLista = /monitoredComponents\s*:\s*\[/.test(src);
  return declaraLaLista && quotedLiteralCount(src, HEALTH_COMPONENTS) >= 3 ? [fileName] : [];
}

describe('P4.x duplicacion - nombres de calendario y componentes de salud, un solo dueno', () => {
  it('la tabla de meses solo vive en su dueno', () => {
    const cops = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)
      .flatMap((f) => nameTableOffenders(readFileSync(f, 'utf8'), rel(f), MONTHS_ES, 6, CALENDAR_NAMES_OWNER));
    expect(cops, 'tabla de meses copiada:\n  ' + cops.join('\n  ')).toEqual([]);
  });
  it('la tabla de dias solo vive en su dueno', () => {
    const cops = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)
      .flatMap((f) => nameTableOffenders(readFileSync(f, 'utf8'), rel(f), DAYS_ES, 5, CALENDAR_NAMES_OWNER));
    expect(cops, 'tabla de dias copiada:\n  ' + cops.join('\n  ')).toEqual([]);
  });
  it('la lista de componentes monitoreados solo vive en su dueno', () => {
    const cops = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)
      .flatMap((f) => monitoredComponentsOffenders(readFileSync(f, 'utf8'), rel(f)));
    expect(cops, 'lista de componentes copiada:\n  ' + cops.join('\n  ')).toEqual([]);
  });
  it('los consumidores importan en vez de recopiar', () => {
    for (const p of ['src/App.tsx', 'src/core/autonomy/useAutonomyIntegration.ts']) {
      expect(readFileSync(join(ROOT, p), 'utf8'), p + ' no importa DEFAULT_MONITORED_COMPONENTS')
        .toContain('DEFAULT_MONITORED_COMPONENTS');
    }
    const usuarios = [
      'src/core/agenda/agendaCommandParser.ts',
      'src/core/agenda/agendaShared.ts',
      'src/core/reminders/nlDateParser.ts',
      'src/core/branding/seasonalCalendar.ts',
      'src/components/AgendaPanel.tsx',
    ];
    for (const p of usuarios) {
      expect(readFileSync(join(ROOT, p), 'utf8'), p + ' no importa calendarNames')
        .toContain('temporal/calendarNames');
    }
  });
});

describe('P4.x duplicacion - el detector de tablas no es decorativo', () => {
  const copiaMeses = "const months = ['enero','febrero','marzo','abril','mayo','junio'];";
  it('marca una tabla de meses recopiada; no marca al dueno ni una alternancia', () => {
    expect(nameTableOffenders(copiaMeses, 'src/otro.ts', MONTHS_ES, 6, CALENDAR_NAMES_OWNER)).toHaveLength(1);
    expect(nameTableOffenders(copiaMeses, CALENDAR_NAMES_OWNER, MONTHS_ES, 6, CALENDAR_NAMES_OWNER)).toEqual([]);
    const alternancia = 'const RE = /(enero|febrero|marzo|abril|mayo|junio)/;';
    expect(nameTableOffenders(alternancia, 'src/otro.ts', MONTHS_ES, 6, CALENDAR_NAMES_OWNER)).toEqual([]);
  });
  it('marca la lista de componentes recopiada y no marca al dueno ni a quien solo nombra ids', () => {
    const copiaSalud = "monitoredComponents: ['ai-service','indexed-db','network']";
    expect(monitoredComponentsOffenders(copiaSalud, 'src/otro.ts')).toHaveLength(1);
    expect(monitoredComponentsOffenders(copiaSalud, MONITORED_COMPONENTS_OWNER)).toEqual([]);
    // Reglas de recuperacion por componente: nombran ids, NO recopian la lista.
    const reglas = "recoveryRules: [{ component: 'ai-service' }, { component: 'indexed-db' }, { component: 'network' }]";
    expect(monitoredComponentsOffenders(reglas, 'src/core/autonomy/autoRecovery.ts')).toEqual([]);
  });
});
