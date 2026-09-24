/**
 * Ledger de pendientes: fuente UNICA de lo que falta y de lo cerrado.
 *
 * El chat (y su resumen) se compactan y descartan; el repo no. Por eso los
 * pendientes viven en `plans/ledger.json`, versionado, y esta puerta impide
 * cerrar con el ledger desincronizado de git.
 *
 * Invariantes que verifica (`check`):
 *   I1  Todo commit de cierre (scope === codigo `C##`/`T##`) esta en `done`.
 *   I1b Todo codigo de cierre declarado en git tiene entrada en `done`, o la
 *       cubre su familia (`P3` lo cubren `P3.1`/`P3.2`/`P3.3`).
 *   I2  Todo `done` apunta a un commit que EXISTE en git.
 *   I3  Todo pendiente (todo|in_progress|blocked) cita evidencia (comando o archivo:linea).
 *   I4  `id` unicos y `estado` valido.
 *   I5  Todo `done` esta JUSTIFICADO por su commit: el mensaje nombra el id (o su
 *       familia: `P3` justifica `P3.1`), o el commit toco el archivo que el item
 *       cita como evidencia.
 *   I6  Todo item `done` tiene cierre en `done[]` o un cierre por VEREDICTO escrito.
 *   I7  Un `decision` (decision ABIERTA, no cierre) cita su evidencia y no cuenta
 *       como pendiente; el VEREDICTO de un decision lo exige decisionVerdictGuard.
 *
 * NOTA MEDIDA (2026-09-23) - `done[].id` NO es una clave unica y no debe serlo:
 * es el CODIGO del hallazgo, y un mismo codigo aparece en varios commits porque
 * el arreglo se hizo en tandas: `fix(C54): paridad de normalizeForMatch` y
 * `fix(C54): utilidades de texto unicas` son los dos cierres de C54. Exigir ids
 * unicos en `done[]` contradiria a I1 (los dos commits tienen que estar). Lo que
 * si es unico es el par (id, commit): medido, 0 repetidos en 117 entradas.
 *
 * Uso:  node scripts/task-ledger.mjs list | check
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const LEDGER_PATH = 'plans/ledger.json';
const CLOSURE_RE = /^(fix|feat|test|refactor|chore|docs|perf)\(([^)]*)\):\s*(.*)$/;
const CODE_RE = /^[A-Za-z]{1,3}\d+$/;
/** Codigos citados en el parentesis FINAL: `... (C53)` o `... (C7,C9)`. */
const CODES_FINALES_RE = /\(((?:[CT]\d+)(?:[,+] ?(?:[CT]\d+))*)\)\s*$/;
export const ESTADOS = ['todo', 'in_progress', 'blocked', 'done', 'decision'];
/** Marca de un cierre por veredicto escrito (ver tests/decisionVerdictGuard.test.ts). */
export const MARCA_VEREDICTO = 'VEREDICTO:';

/**
 * Extrae, de lineas `<hash>\x1f<subject>`, los commits cuyo scope es un codigo.
 *
 * El codigo tambien cuenta si va en el parentesis FINAL del asunto, no solo en el
 * scope: `chore(P6.9): auditoria de higiene medida (C53)` era invisible para la
 * barrera (C53 no aparecia en el ledger y nadie lo iba a reclamar nunca). Solo se
 * miran los parentesis del final a proposito: un codigo citado en medio de la
 * prosa (`... durante el cierre de T1`) no es una declaracion de cierre.
 *
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
    const finales = subject.match(CODES_FINALES_RE);
    const codes = [
      ...m[2].split(',').map((c) => c.trim()),
      ...(finales ? finales[1].split(/[,+]/).map((c) => c.trim()) : []),
    ].filter((c) => CODE_RE.test(c));
    const unicos = [...new Set(codes)];
    if (!unicos.length) continue;
    out.push({ hash, codes: unicos, subject: m[3] });
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
 * Sujetos y archivos tocados por commit: es lo que permite comprobar que un
 * cierre esta JUSTIFICADO por su commit (I5) sin creerle nada al ledger.
 *
 * Una sola llamada a git para todo el historial, por el mismo motivo que
 * `existentesEnLote` (ver su comentario): el ledger tiene 100+ cierres.
 *
 * @param {string} [cwd]
 * @returns {{subjects: Map<string,string>, files: Map<string,Set<string>>}}
 */
export function readGitEvidence(cwd = process.cwd()) {
  const raw = execFileSync('git', ['log', '--pretty=format:\x01%h\x1f%s', '--name-only'], {
    cwd,
    encoding: 'utf8',
  });
  const subjects = new Map();
  const files = new Map();
  let hash = null;
  for (const linea of raw.split('\n')) {
    if (linea.startsWith('\x01')) {
      const [h, s = ''] = linea.slice(1).split('\x1f');
      hash = h;
      subjects.set(h, s);
      files.set(h, new Set());
    } else if (hash && linea.trim()) {
      files.get(hash).add(linea.trim());
    }
  }
  return { subjects, files };
}

/**
 * Existe el commit en git?
 *
 * RENDIMIENTO (medido 2026-09-22): el ledger tiene 100+ cierres y esta funcion
 * hacia un `git cat-file` POR HASH: ~115 procesos por validacion. Bajo carga
 * (suite completa con 10 workers) el guard del ledger pasaba de los 15 s de
 * timeout y se caia en rojo de forma intermitente con el ledger correcto. Ahora
 * la primera llamada resuelve TODO el ledger con un solo `git cat-file
 * --batch-check` y el resto son consultas a un Map. Misma semantica: un commit
 * del ledger solo cuenta si git lo resuelve como objeto de tipo commit.
 *
 * @param {string} hash
 * @param {string} [cwd]
 */
let cacheExistentes = null;

function existentesEnLote(cwd) {
  if (cacheExistentes && cacheExistentes.cwd === cwd) return cacheExistentes.set;
  const hashes = [...new Set((readLedger().done || []).map((d) => d.commit).filter(Boolean))];
  const set = new Set();
  if (hashes.length) {
    const salida = execFileSync('git', ['cat-file', '--batch-check=%(objecttype)'], {
      cwd,
      encoding: 'utf8',
      input: hashes.join('\n') + '\n',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    // --batch-check responde una linea por entrada, en el mismo orden
    salida.split('\n').forEach((linea, i) => {
      if (linea.trim() === 'commit' && hashes[i]) set.add(hashes[i]);
    });
  }
  cacheExistentes = { cwd, set };
  return set;
}

/**
 * @param {string} hash
 * @param {string} [cwd]
 */
export function commitExists(hash, cwd = process.cwd()) {
  if (!hash) return false;
  try {
    return existentesEnLote(cwd).has(hash);
  } catch {
    try {
      execFileSync('git', ['cat-file', '-e', `${hash}^{commit}`], { cwd, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
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
 * Familia de un item (`P3.1` -> `P3`): es como los lotes citan en git a los
 * items que cierran juntos (`fix(P2.1+P3): ...`).
 * @param {string} id
 */
export function familiaDe(id) {
  return String(id || '').split('.')[0];
}

/**
 * El commit justifica el cierre? Nombra el id (o su familia) en el mensaje, o
 * toco el archivo que el item cita como evidencia.
 *
 * Los dos caminos salen de datos medidos: los lotes nombran a sus items
 * (`refactor(P4.3+P4.4+P4.5+P4.9+P4.13)`), y los items meta mas antiguos
 * (P0.1/P0.2) se cerraron en el commit que creo su artefacto sin citarlos.
 *
 * @param {{id?: string}} entry
 * @param {string} subject
 * @param {Set<string>} [archivosDelCommit]
 * @param {string} [evidencia]
 */
export function justificaCierre(entry, subject, archivosDelCommit, evidencia) {
  const id = String(entry.id || '');
  // El id casa EXACTO y escapado. Dos defectos medidos de la version anterior:
  //  - SUBCADENA: `C2` lo justificaba un commit que dice `C21`.
  //  - FAMILIA: para un item hijo `\bP1\b` casa tambien con un HERMANO, asi
  //    que P1.8 colgaba de `chore(P1.9)` y P0.4 de un commit que solo dice P0.5
  //    (el punto no es caracter de palabra).
  // Y sin escapar, un id con metacaracteres tumbaba la barrera: `C1)` lanzaba
  // SyntaxError. El id exacto cubre los tres casos y conserva los items META
  // (su id ES la familia, y `\bP3\b` casa con `P3.1`).
  if (id && new RegExp(`\\b${String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(subject)) return true;
  const ruta = String(evidencia || '').split(':')[0].trim();
  return Boolean(ruta && archivosDelCommit && archivosDelCommit.has(ruta));
}

/**
 * Valida el ledger contra git. Pura respecto a I/O: recibe closures, exists,
 * subjects y files.
 * @param {any} ledger
 * @param {{closures?: Array<{hash: string, codes: string[], subject: string}>, exists?: (hash: string) => boolean, subjects?: Map<string,string>, files?: Map<string,Set<string>>}} [opts]
 * @returns {{ok: boolean, failures: string[]}}
 */
export function validateLedger(
  ledger,
  { closures = [], exists = () => true, subjects = new Map(), files = new Map() } = {},
) {
  const failures = [];
  if (!ledger || !Array.isArray(ledger.items) || !Array.isArray(ledger.done)) {
    return { ok: false, failures: ['schema: faltan arrays "items" y/o "done"'] };
  }

  const doneIds = new Set(ledger.done.map((d) => d.id));
  const evidenciaPorId = new Map(ledger.items.map((i) => [i.id, i.evidencia]));
  const ids = new Set();
  for (const it of ledger.items) {
    if (!it.id) failures.push('item sin id');
    else if (ids.has(it.id)) failures.push(`id duplicado: ${it.id}`);
    else ids.add(it.id);
    if (!ESTADOS.includes(it.estado)) {
      failures.push(`estado invalido en ${it.id}: ${JSON.stringify(it.estado)}`);
    }
    if (['todo', 'in_progress', 'blocked', 'decision'].includes(it.estado) && !String(it.evidencia || '').trim()) {
      failures.push(`estado ${it.estado} sin evidencia: ${it.id}`);
    }
    // I6: dar algo por hecho exige registro. Vale un cierre con commit (entrada en
    // done[]) o un cierre por VEREDICTO ESCRITO: el repo decidio asi de forma expresa
    // (tests/decisionVerdictGuard.test.ts, congelado: `decision` es una decision
    // ABIERTA y los veredictos ya resueltos van en `done` citando su motivo). Obligar
    // a todo `done` a citar un commit es lo que hizo que 6 items colgaran del commit
    // ajeno de otro item.
    if (
      it.estado === 'done' &&
      !doneIds.has(it.id) &&
      !String(it.evidencia || '').includes(MARCA_VEREDICTO)
    ) {
      failures.push(`item done sin cierre en done[] ni veredicto: ${it.id}`);
    }
  }

  const doneHashes = new Set(ledger.done.map((d) => d.commit));
  for (const c of closures) {
    if (!doneHashes.has(c.hash)) {
      failures.push(`commit de cierre sin registrar en ledger: ${c.hash} ${c.subject}`);
      continue;
    }
    // I1b: I1 solo miraba el HASH, asi que un commit registrado con OTRO id pasaba
    // por bueno y su codigo quedaba invisible: medido con C53 -> 268e0c7, registrado
    // como P6.9. El codigo declarado en git tiene que existir como entrada, o
    // cubierto por su familia (`P3` lo cubren P3.1/P3.2/P3.3).
    for (const code of c.codes) {
      const cubierto = [...doneIds].some((id) => id === code || String(id).startsWith(`${code}.`));
      if (!cubierto) failures.push(`codigo de cierre sin entrada en done[]: ${code} (${c.hash})`);
    }
  }
  for (const d of ledger.done) {
    if (!d.commit) {
      failures.push(`done sin commit: ${d.id || '(sin id)'}`);
      continue;
    }
    if (!exists(d.commit)) {
      failures.push(`commit inexistente en git: ${d.commit} (${d.id})`);
      continue;
    }
    // I5: el commit tiene que justificar el cierre. Antes bastaba con que el hash
    // estuviera en alguna parte, asi que un item podia colgarse de un commit
    // ajeno: medido, 5 items (P4.11, P4.12, P4.14, P6.5, P6.8) colgaban de
    // e0d5a1c, cuyo asunto es "cierre de P1.5".
    const subject = subjects.get(d.commit);
    if (!subject) continue;
    const evidencia = d.evidencia || evidenciaPorId.get(d.id);
    if (!justificaCierre(d, subject, files.get(d.commit), evidencia)) {
      failures.push(
        `cierre no justificado por su commit: ${d.id} -> ${d.commit} ("${String(subject).slice(0, 60)}")`,
      );
    }
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
  const { subjects, files } = readGitEvidence();
  const { ok, failures } = validateLedger(ledger, { closures, exists: commitExists, subjects, files });
  if (ok) {
    // "pendientes" era `items.length`, que es el TOTAL de items registrados: decia
    // "60 pendientes" habiendo 2. Un mensaje que miente se lee como un aviso y no
    // se revisa; vale mas que diga lo que hay.
    const pendientes = ledger.items.filter((i) => ['todo', 'in_progress', 'blocked'].includes(i.estado));
    const conteo = ESTADOS.map((e) => `${ledger.items.filter((i) => i.estado === e).length} ${e}`).join(', ');
    const primeros = pendientes.map((i) => i.id).join(', ');
    console.log(
      `ledger OK: ${pendientes.length} pendientes (${primeros}) -> items: ${conteo} | ${ledger.done.length} cierres registrados | ${closures.length} cierres en git`,
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
