/**
 * Ledger de pendientes: fuente UNICA de lo que falta y de lo cerrado.
 *
 * El chat (y su resumen) se compactan y descartan; el repo no. Por eso los
 * pendientes viven en `plans/ledger.json`, versionado, y esta puerta impide
 * cerrar con el ledger desincronizado de git.
 *
 * Invariantes que verifica (`check`):
 *   I1  Todo commit de cierre (scope === codigo `C##`/`T##`) esta en `done`.
 *   I2  Todo `done` apunta a un commit que EXISTE en git.
 *   I3  Todo pendiente (todo|in_progress|blocked) cita evidencia (comando o archivo:linea).
 *   I4  `id` unicos y `estado` valido.
 *
 * Uso:  node scripts/task-ledger.mjs list | check
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const LEDGER_PATH = 'plans/ledger.json';
const CLOSURE_RE = /^(fix|feat|test|refactor|chore|docs|perf)\(([^)]*)\):\s*(.*)$/;
const CODE_RE = /^[A-Za-z]{1,3}\d+$/;
export const ESTADOS = ['todo', 'in_progress', 'blocked', 'done', 'decision'];

/**
 * Extrae, de lineas `<hash>\x1f<subject>`, los commits cuyo scope es un codigo.
 * @param {string[]} lines
 * @returns {Array<{hash: string, codes: string[], subject: string}>}
 */
export function parseClosureCommits(lines) {
  const out = [];
  for (const line of lines) {
    if (!line) continue;
    const [hash, subject = ''] = line.split('\x1f');
    const m = subject.match(CLOSURE_RE);
    if (!m) continue;
    const codes = m[2]
      .split(',')
      .map((c) => c.trim())
      .filter((c) => CODE_RE.test(c));
    if (!codes.length) continue;
    out.push({ hash, codes, subject: m[3] });
  }
  return out;
}

/** Cierres reales segun git (no confia en el ledger). @param {string} [cwd] */
export function readGitClosures(cwd = process.cwd()) {
  const raw = execFileSync('git', ['log', '--pretty=format:%h%x1f%s'], {
    cwd,
    encoding: 'utf8',
  });
  return parseClosureCommits(raw.split('\n'));
}

/**
 * Existe el commit en git?
 * @param {string} hash
 * @param {string} [cwd]
 */
export function commitExists(hash, cwd = process.cwd()) {
  if (!hash) return false;
  try {
    execFileSync('git', ['cat-file', '-e', `${hash}^{commit}`], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} [path]
 * @returns {any}
 */
export function readLedger(path = LEDGER_PATH) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

/**
 * Valida el ledger contra git. Pura respecto a I/O: recibe closures y exists.
 * @param {any} ledger
 * @param {{closures?: Array<{hash: string, codes: string[], subject: string}>, exists?: (hash: string) => boolean}} [opts]
 * @returns {{ok: boolean, failures: string[]}}
 */
export function validateLedger(ledger, { closures = [], exists = () => true } = {}) {
  const failures = [];
  if (!ledger || !Array.isArray(ledger.items) || !Array.isArray(ledger.done)) {
    return { ok: false, failures: ['schema: faltan arrays "items" y/o "done"'] };
  }

  const ids = new Set();
  for (const it of ledger.items) {
    if (!it.id) failures.push('item sin id');
    else if (ids.has(it.id)) failures.push(`id duplicado: ${it.id}`);
    else ids.add(it.id);
    if (!ESTADOS.includes(it.estado)) {
      failures.push(`estado invalido en ${it.id}: ${JSON.stringify(it.estado)}`);
    }
    if (['todo', 'in_progress', 'blocked'].includes(it.estado) && !String(it.evidencia || '').trim()) {
      failures.push(`pendiente sin evidencia: ${it.id}`);
    }
  }

  const doneHashes = new Set(ledger.done.map((d) => d.commit));
  for (const c of closures) {
    if (!doneHashes.has(c.hash)) {
      failures.push(`commit de cierre sin registrar en ledger: ${c.hash} ${c.subject}`);
    }
  }
  for (const d of ledger.done) {
    if (!d.commit) failures.push(`done sin commit: ${d.id || '(sin id)'}`);
    else if (!exists(d.commit)) failures.push(`commit inexistente en git: ${d.commit} (${d.id})`);
  }

  return { ok: failures.length === 0, failures };
}

function cmdList(ledger) {
  const by = {};
  for (const it of ledger.items) (by[it.estado] ||= []).push(it);
  for (const est of ESTADOS) {
    const arr = by[est] || [];
    if (!arr.length) continue;
    console.log(`\n## ${est} (${arr.length})`);
    for (const it of arr) console.log(`  ${it.id}  ${it.titulo}\n      evidencia: ${it.evidencia}`);
  }
  console.log(`\ndone: ${ledger.done.length} commits de cierre registrados`);
}

function cmdCheck(ledger) {
  const closures = readGitClosures();
  const { ok, failures } = validateLedger(ledger, { closures, exists: commitExists });
  if (ok) {
    console.log(
      `ledger OK: ${ledger.items.length} pendientes, ${ledger.done.length} done, ${closures.length} cierres en git`,
    );
    return 0;
  }
  console.error(`ledger DESINCRONIZADO (${failures.length} fallos):`);
  for (const f of failures) console.error(`  - ${f}`);
  return 1;
}

const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const cmd = process.argv[2] || 'check';
  const ledger = readLedger();
  process.exit(cmd === 'list' ? (cmdList(ledger), 0) : cmdCheck(ledger));
}
