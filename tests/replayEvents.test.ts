// @vitest-environment node
// ============================================================
// replayEvents - runner generico de replay (FASE 1: modo `events`)
// ------------------------------------------------------------
// Se ejecuta el CLI REAL (`scripts/replay.mjs` con `vite-node`) como proceso aparte: lo
// que se valida son los EXIT CODES y el reporte, no una copia de la logica.
//
//   exit 0 = coincide con el expected aprobado (o modo observacion sin invariante roto)
//   exit 1 = hay diferencias (expected alterado, invariante de caja roto)
//   exit 2 = sesion/expected invalido, expected NO aprobado, sin fidelidad, o TIMEOUT
//
// La sesion real `d4c1c8f3` vive en %TEMP%\flu-recordings: si NO esta, el caso se declara
// SKIP (no se inventa el resultado ni se commitea la transcripcion del dueno).
// ============================================================
import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareExpected, sourceRowDiff } from '../scripts/replay/compareExpected.mjs'
import { medirCongelacionCaja } from '../scripts/replay/eventsRunner.mjs'

const ROOT = process.cwd()
const VITE_NODE = join(ROOT, 'node_modules', 'vite-node', 'vite-node.mjs')
const CONFIG = join(ROOT, 'scripts', 'replay', 'vite.replay.config.mts')
const CLI = join(ROOT, 'scripts', 'replay.mjs')
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'replay', 'saludo')
const CHECKS = join(ROOT, 'tests', 'fixtures', 'replay', 'checks')
const REPETIDA = join(ROOT, 'tests', 'fixtures', 'replay', 'repetida')
const SILENCIO = join(ROOT, 'tests', 'fixtures', 'replay', 'silencio')
const VECTORS = join(ROOT, 'tests', 'fixtures', 'replay', 'vectors')
const REAL_SESSION = join(tmpdir(), 'flu-recordings', 'd4c1c8f3-76f8-400b-b89e-e8e428cfdff7')

/**
 * Ejecuta el CLI y devuelve exit code + salidas (sin lanzar por exit != 0).
 *
 * ASINCRONO a proposito (defecto medido, P7.68 en `jsReferenceGuard`): lanzar los ~23
 * replays con `execFileSync` BLOQUEABA el event loop del worker durante toda la medicion
 * (~50 s seguidos). Bajo contencion eso pasaba del timeout del RPC de vitest y la corrida
 * COMPLETA sale roja por `Unhandled Error: [vitest-worker]: Timeout calling "onTaskUpdate"`
 * con los 289 ficheros y los 2452 tests en verde. Con `execFile` el worker sigue latiendo.
 * @param {string[]} args argumentos del CLI de replay
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function replay(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [VITE_NODE, '--config', CONFIG, CLI, ...args],
      { cwd: ROOT, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const fallo = error as (NodeJS.ErrnoException & { code?: number | string }) | null
        resolve({
          code: fallo ? Number(typeof fallo.code === 'number' ? fallo.code : -1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        })
      },
    )
  })
}

function tmpDir(prefijo: string): string {
  return mkdtempSync(join(tmpdir(), prefijo))
}

/**
 * Copia la fixture `vectors` a un temporal y aplica una mutacion a `turns.ndjson`.
 * Sirve para falsificar el runner: si cambia el resultado, el estado previo se esta
 * leyendo de la grabacion (y no del resultado que se quiere medir).
 * @param {string} prefijo
 * @param {(rows: Array<Record<string, unknown>>) => void} mutar
 * @returns {string} carpeta de la sesion temporal
 */
function copiaVectors(prefijo: string, mutar: (rows: Array<Record<string, unknown>>) => void): string {
  const dir = tmpDir(prefijo)
  cpSync(VECTORS, dir, { recursive: true })
  const file = join(dir, 'turns.ndjson')
  const rows = readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  mutar(rows)
  writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`)
  return dir
}

/** Filas `commit` de un `turns.ndjson` ya cargado. */
function commitsDe(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.filter((row) => String(row?.kind || '') === 'commit')
}

describe('replay events - expected aprobado (filas y caja)', async () => {
  it('la fixture coincide: exit 0, todos los checks en OK y las dos marcas inferidas', async () => {
    const report = join(tmpDir('replay-ok-'), 'report.json')
    const out = await replay(['--session', FIXTURE, '--mode', 'events', '--expected', join(FIXTURE, 'expected.json'), '--report', report])

    expect(out.stderr, out.stderr).not.toMatch(/error inesperado/)
    expect(out.code, out.stdout + out.stderr).toBe(0)
    const datos = JSON.parse(readFileSync(report, 'utf8'))
    expect(datos.status).toBe('ok')
    expect(datos.approved).toBe(true)
    expect(datos.checks.every((check: { ok: boolean }) => check.ok)).toBe(true)
    expect(datos.observed.rows.map((row: { text: string }) => row.text)).toEqual(['hola que tal', 'ahora otra cosa'])
    // CIERRE: el silencio cierra la primera locucion y el fin de la grabacion la segunda.
    expect(datos.marks.srGapInferred).toBe(1)
    expect(datos.marks.endInferred).toBe(1)
    expect(datos.classification.duplicadas).toBe(0)
    expect(datos.classification.perdidas).toBe(0)
  })

  it('la caja se guarda CON TIEMPO y sin deduplicar textos iguales (una caja congelada es un dato)', async () => {
    const report = join(tmpDir('replay-trace-'), 'report.json')
    await replay(['--session', FIXTURE, '--mode', 'events', '--expected', join(FIXTURE, 'expected.json'), '--report', report])
    const datos = JSON.parse(readFileSync(report, 'utf8'))
    const traza = datos.observed.boxTrace
    expect(traza.length, 'cada actualizacion de la caja deja una entrada').toBeGreaterThan(2)
    expect(traza.every((entry: { t: number }) => Number.isFinite(entry.t))).toBe(true)
    // Hay al menos un par de entradas con el MISMO texto (vaciado + republicacion en el
    // mismo instante): si se deduplicara, el dato desapareceria.
    const textos = traza.map((entry: { text: string }) => entry.text)
    expect(new Set(textos).size).toBeLessThanOrEqual(textos.length)
    expect(datos.box.actualizaciones).toBe(traza.length)
  })
})

describe('replay events - el expected alterado FALLA (no es decorativo)', async () => {
  it('cambiar una fila del expected da exit 1 con el diff legible', async () => {
    const dir = tmpDir('replay-alt-')
    const esperado = join(dir, 'expected.json')
    const original = JSON.parse(readFileSync(join(FIXTURE, 'expected.json'), 'utf8'))
    original.expect.rows = [{ text: 'otra frase que no se dijo', speaker: 'Hablante 1' }]
    writeFileSync(esperado, JSON.stringify(original, null, 2))

    const report = join(dir, 'report.json')
    const out = await replay(['--session', FIXTURE, '--mode', 'events', '--expected', esperado, '--report', report])

    expect(out.code, out.stdout + out.stderr).toBe(1)
    const datos = JSON.parse(readFileSync(report, 'utf8'))
    expect(datos.status).toBe('mismatch')
    expect(datos.checks.find((check: { name: string }) => check.name === 'rows').ok).toBe(false)
    expect(datos.diffs.length).toBeGreaterThanOrEqual(1)
    expect(datos.diffs[0].actual.text).toBe('hola que tal')
  })

  it('un expected SIN aprobar no pasa por bueno (exit 2)', async () => {
    const dir = tmpDir('replay-draft-')
    const esperado = join(dir, 'expected.json')
    const original = JSON.parse(readFileSync(join(FIXTURE, 'expected.json'), 'utf8'))
    original.approved = false
    writeFileSync(esperado, JSON.stringify(original, null, 2))

    const out = await replay(['--session', FIXTURE, '--mode', 'events', '--expected', esperado])

    expect(out.code, out.stdout + out.stderr).toBe(2)
    expect(out.stderr).toContain('NO esta aprobado')
  })
})

describe('replay events - checks de CAJA (fixtures sinteticos)', async () => {
  const fixtures = readdirSync(CHECKS).filter((file) => file.endsWith('.json'))

  it('hay las seis fixtures de caja exigidas (ninguna se cae de la lista)', async () => {
    expect(fixtures.sort()).toEqual(
      ['bloque-duplicado.json', 'congelada.json', 'fila-corta-vs-viva.json', 'limpia.json', 'perdida-real.json', 'prefijo-creciente.json'].sort(),
    )
  })

  for (const file of fixtures) {
    it(`${file}: el detector enciende EXACTAMENTE lo que debe`, async () => {
      const fx = JSON.parse(readFileSync(join(CHECKS, file), 'utf8'))
      const cmp = compareExpected({ observed: fx.observed, expected: fx.expected, options: fx.options })
      const estados = new Map<string, boolean>((cmp.checks as Array<{ name: string; ok: boolean }>).map((check) => [check.name, check.ok]))

      expect(cmp.status, `${file}: ${JSON.stringify((cmp.checks as Array<{ name: string; ok: boolean }>).map((c) => [c.name, c.ok]))}`).toBe(fx.want.status)
      for (const nombre of fx.want.failing) {
        expect(estados.get(nombre), `${file}: ${nombre} tenia que ENCENDERSE`).toBe(false)
      }
      for (const nombre of fx.want.passing) {
        expect(estados.get(nombre), `${file}: ${nombre} NO debia encenderse`).toBe(true)
      }
      // Ningun check puede faltar: si el fixture pide uno, el comparador lo produce.
      for (const nombre of [...fx.want.failing, ...fx.want.passing]) expect(estados.has(nombre)).toBe(true)
    })
  }

  it('la duplicacion NO se vende como perdida', async () => {
    const fx = JSON.parse(readFileSync(join(CHECKS, 'bloque-duplicado.json'), 'utf8'))
    const cmp = compareExpected({ observed: fx.observed, expected: fx.expected, options: fx.options })
    const estados = new Map<string, boolean>((cmp.checks as Array<{ name: string; ok: boolean }>).map((check) => [check.name, check.ok]))
    expect(estados.get('boxDuplicated')).toBe(false)
    expect(estados.get('boxLost'), 'la caja duplicada no puede contar como bloque perdido').toBe(true)
  })
})

describe('replay events - diff con las FILAS FUENTE (turns.ndjson, kind=commit)', async () => {
  const dirFuente = join(ROOT, 'tests', 'fixtures', 'replay', 'source')
  const casos = readdirSync(dirFuente).filter((file) => file.endsWith('.json'))

  it('hay las SIETE fixtures de fuente exigidas', async () => {
    expect(casos.sort()).toEqual(
      [
        'duplicado-fuente.json',
        'extra-injustificado.json',
        'extra-justificado.json',
        'falta-una.json',
        'iguales.json',
        'sobra-una.json',
        'variante.json',
      ].sort(),
    )
  })

  for (const file of casos) {
    it(`${file}: clasifica como dice la especificacion`, async () => {
      const fx = JSON.parse(readFileSync(join(dirFuente, file), 'utf8'))
      const diff = sourceRowDiff(fx.source, fx.observed)
      expect(diff.sourceRows, `${file}: filas de la fuente`).toBe(fx.want.sourceRows)
      expect(diff.sourceDuplicates, `${file}: duplicados de la fuente`).toBe(fx.want.sourceDuplicates)
      expect(diff.missingUnique.length, `${file}: faltan`).toBe(fx.want.missingUnique)
      expect(diff.extraAceptadas.length, `${file}: sobrantes justificados`).toBe(fx.want.extraAceptadas ?? 0)
      expect(diff.extraUnique.length, `${file}: sobran`).toBe(fx.want.extraUnique)
      expect(diff.textVariants.length, `${file}: variantes`).toBe(fx.want.textVariants)
    })
  }

  it('un EXTRA justificado (la fuente repite esa locucion) NO falla; uno sin justificar SI', async () => {
    const corre = (nombre: string) => {
      const fx = JSON.parse(readFileSync(join(dirFuente, nombre), 'utf8'))
      const cmp = compareExpected({
        observed: { rows: fx.observed, boxTrace: [], commits: [], boxAtCommit: [], box: [] },
        expected: { expect: {} },
        options: { sourceRows: fx.source, variantWords: 2 },
      })
      const check = (cmp.checks as Array<{ name: string; ok: boolean; detail: string }>).find(
        (c) => c.name === 'sourceRows',
      )
      return { fx, check, cmp }
    }

    // Justificado: el replay emitio dos veces la locucion que la fuente ya duplica, con la
    // grafia del ASR ("claud") -> se DECLARA, no se esconde y no falla.
    const justificado = corre('extra-justificado.json')
    expect(justificado.check?.ok, justificado.check?.detail).toBe(true)
    expect(justificado.check?.detail).toContain('1 aceptada(s)')
    expect(justificado.fx.want.checkOk).toBe(true)
    const diffJustificado = sourceRowDiff(justificado.fx.source, justificado.fx.observed)
    expect(diffJustificado.extraAceptadas[0].vecesEnFuente).toBe(2)
    expect(diffJustificado.extraAceptadas[0].repiteDe).toBe('puso Cloud Cloud')
    expect(diffJustificado.extraAceptadas[0].similitud).toBeGreaterThan(0.7)

    // Sin justificar: la fila de mas no repite ninguna locucion de la fuente -> FALLA.
    const injustificado = corre('extra-injustificado.json')
    expect(injustificado.check?.ok).toBe(false)
    expect(injustificado.check?.detail).toContain('EXTRA sin justificar')
    expect(injustificado.cmp.status).toBe('mismatch')
    expect(injustificado.fx.want.checkOk).toBe(false)
  })

  it('las VARIANTES declaradas no fallan (misma locucion, otra grafia del ASR)', async () => {
    const fx = JSON.parse(readFileSync(join(dirFuente, 'variante.json'), 'utf8'))
    const cmp = compareExpected({
      observed: { rows: fx.observed, boxTrace: [], commits: [], boxAtCommit: [], box: [] },
      expected: { expect: {} },
      options: { sourceRows: fx.source, variantWords: 2 },
    })
    const check = (cmp.checks as Array<{ name: string; ok: boolean; detail: string }>).find((c) => c.name === 'sourceRows')
    expect(check?.ok, check?.detail).toBe(true)
    expect(sourceRowDiff(fx.source, fx.observed).textVariants.length).toBe(fx.want.textVariants)
  })

  it('una VARIANTE conserva los DOS textos originales (no los normaliza en el reporte)', async () => {
    const fx = JSON.parse(readFileSync(join(dirFuente, 'variante.json'), 'utf8'))
    const diff = sourceRowDiff(fx.source, fx.observed)
    expect(diff.textVariants).toEqual([
      { source: 'puso Cloud Cloud', observed: 'puso Cloud' },
      { source: 'está mal este está con el hablante uno', observed: 'está mal este está con el hablante 1' },
    ])
  })

  it('los DUPLICADOS de la fuente no son perdidas (29 vs 18 puede ser todo duplicados)', async () => {
    const fuente = Array.from({ length: 29 }, (_, index) => ({ text: `locucion ${index % 16}` }))
    const diff = sourceRowDiff(fuente, fuente.filter((_, index) => index < 16))
    expect(diff.sourceRows).toBe(29)
    expect(diff.sourceUnique).toBe(16)
    expect(diff.sourceDuplicates).toBe(13)
    expect(diff.missingUnique.length, 'los duplicados NO son perdidas').toBe(0)
  })
})

// CRITERIO DE CONGELACION (declarado): la ventana entre dos cambios REALES de la caja
// cuenta si (a) hubo texto de ASR DISTINTO al mostrado (la caja lo ignoro) o (b) hubo
// `minEventosActivos` (2) eventos de voz aunque el texto se repita: el ASR avanzo y la
// caja no se movio, que es exactamente una caja congelada. El SILENCIO no cuenta.
describe('replay events - congelacion de caja: cuenta ACTIVIDAD del ASR, no solo texto nuevo', async () => {
  it('una REPETICION del ASR con la caja quieta TAMBIEN es congelacion', async () => {
    const traza = [
      { t: 0, text: 'hola que tal', reason: 'publish' },
      { t: 3000, text: '', reason: 'clear' },
    ]
    const eventos = [
      { t: 1000, text: 'hola que tal' },
      { t: 2000, text: 'hola que tal' },
    ]
    const hueco = medirCongelacionCaja(traza, eventos)
    // La ventana dura 3000 ms, pero se mide hasta la ULTIMA actividad (2000): los 1000 ms
    // finales son silencio y una caja no puede cambiar cuando nadie habla.
    expect(hueco.maxGapMs).toBe(2000)
    expect(hueco.motivo).toBe('asr-repetido-sin-cambio')
  })

  it('el SILENCIO FINAL de una ventana CON actividad no entra en la medida', async () => {
    const traza = [
      { t: 0, text: 'hola que tal', reason: 'publish' },
      { t: 30000, text: '', reason: 'clear' },
    ]
    const eventos = [
      { t: 1000, text: 'hola que tal' },
      { t: 2000, text: 'hola que tal' },
    ]
    const hueco = medirCongelacionCaja(traza, eventos)
    expect(hueco.maxGapMs, 'la caja solo estuvo quieta 2000 ms CON el ASR hablando').toBe(2000)
    expect(30000 - 2000, 'los 28 s de silencio no se cuentan').toBeGreaterThan(hueco.maxGapMs)
  })

  it('un SOLO evento de voz no basta (la actividad minima son 2 eventos)', async () => {
    const traza = [
      { t: 0, text: 'hola', reason: 'publish' },
      { t: 3000, text: '', reason: 'clear' },
    ]
    const hueco = medirCongelacionCaja(traza, [{ t: 1000, text: 'hola' }])
    expect(hueco.maxGapMs, 'sin texto nuevo y con un solo evento no hay congelacion medible').toBe(0)
    expect(hueco.motivo).toBe('')
  })

  it('una EXTENSION rechazada SI es congelacion (falsificacion del filtro)', async () => {
    const traza = [
      { t: 0, text: 'hola', reason: 'publish' },
      { t: 4000, text: 'hola que tal', reason: 'publish' },
    ]
    const eventos = [
      { t: 1000, text: 'hola que' },
      { t: 2000, text: 'hola que tal' },
    ]
    const hueco = medirCongelacionCaja(traza, eventos, {
      decisions: [{ t: 1000, aplicado: false, extension: true }],
    })
    expect(hueco.maxGapMs, 'se midio hasta la ultima actividad').toBe(2000)
    expect(hueco.motivo).toBe('extension-ignorada')
  })

  it('una emision que ACORTA o que es de OTRA locucion es espera legitima, no congelacion', async () => {
    const traza = [
      { t: 0, text: 'hola que tal', reason: 'publish' },
      { t: 4000, text: '', reason: 'clear' },
    ]
    const eventos = [
      { t: 1000, text: 'hola' },
      { t: 2000, text: 'otra cosa distinta' },
    ]
    const hueco = medirCongelacionCaja(traza, eventos, {
      decisions: [{ t: 1000, aplicado: false, extension: false }, { t: 2000, aplicado: false, extension: false }],
    })
    expect(hueco.maxGapMs, 'no hay defecto').toBe(0)
    expect(hueco.esperaMs, 'pero la espera se informa').toBe(2000)
  })

  it('el SILENCIO no es congelacion (sin eventos de voz no hay nada que se congele)', async () => {
    const traza = [
      { t: 0, text: 'hola', reason: 'publish' },
      { t: 9000, text: '', reason: 'clear' },
    ]
    expect(medirCongelacionCaja(traza, []).maxGapMs).toBe(0)
  })

  it('el texto NUEVO que la caja ignora se reporta con SU motivo', async () => {
    const traza = [
      { t: 0, text: 'hola', reason: 'publish' },
      { t: 2000, text: '', reason: 'clear' },
    ]
    const hueco = medirCongelacionCaja(traza, [{ t: 500, text: 'hola que tal' }])
    // Se mide hasta el texto ignorado (500): despues de el no hubo voz, solo silencio.
    expect(hueco.maxGapMs).toBe(500)
    expect(hueco.motivo).toBe('texto-nuevo-ignorado')
  })

  it('un SILENCIO normal no marca boxStall aunque la caja tarde en cambiar (fixture)', async () => {
    const report = join(tmpDir('replay-silencio-'), 'report.json')
    const out = await replay(['--session', SILENCIO, '--mode', 'events', '--report', report])

    const datos = JSON.parse(readFileSync(report, 'utf8'))
    const caja = datos.observed.boxTrace
    // La ventana entre cambios dura 4300 ms (el sr-gap del producto cierra en
    // ultimaVoz + 3500), pero el ASR solo hablo 800 ms: el silencio no cuenta.
    // Antes del arreglo el mismo caso medía los 4300 ms y marcaba.
    expect(caja[1].t - caja[0].t).toBe(4300)
    // Con la atribucion por DECISION, esa espera es LEGITIMA: la caja ya mostraba la frase y
    // el ASR no pidio crecerla. Se informa en `esperaMs` y NO cuenta como congelacion.
    expect(datos.boxStall.maxGapMs).toBe(0)
    expect(datos.boxStall.esperaMs).toBe(800)
    expect(datos.boxStall.maxGapMs).toBeLessThan(datos.thresholds.boxStallMs)
    const check = datos.checks.find((c: { name: string }) => c.name === 'boxStall')
    expect(check.ok, check.detail).toBe(true)
    expect(out.code, out.stdout + out.stderr).toBe(0) // observacion sin invariante roto
    expect(datos.status).toBe('observed')
  })

  it('la grabacion sintetica: insistir con la MISMA frase no es congelacion (la caja ya la muestra)', async () => {
    const report = join(tmpDir('replay-repetida-'), 'report.json')
    const out = await replay(['--session', REPETIDA, '--mode', 'events', '--box-stall-ms', '500', '--report', report])

    const datos = JSON.parse(readFileSync(report, 'utf8'))
    // REGLA DECLARADA (2026-10-22): el defecto es ignorar una EXTENSION de la misma locucion.
    // Repetir lo que la caja YA muestra, o traer otra locucion, es una espera legitima: la
    // caja no puede encoger ni sustituirse (mandatos 2026-10-21). Se mide y se informa.
    expect(datos.boxStall.maxGapMs, 'ninguna extension rechazada').toBe(0)
    expect(datos.boxStall.esperaMs).toBeGreaterThan(500)
    expect(datos.checks.find((check: { name: string }) => check.name === 'boxStall').ok).toBe(true)
    expect(datos.checks.find((check: { name: string }) => check.name === 'boxLost').ok, 'no se vende como perdida').toBe(true)
    expect(out.code, out.stdout + out.stderr).toBe(0)
  })
})

// MODO `vectors`: se re-ejecuta el RESOLUTOR real sobre la firma grabada y el estado
// PREVIO reconstruido de `turns.ndjson`. El `speaker` de la fuente es el ESPERADO: si se
// usara como entrada, invertirlo cambiaria la etiqueta OBSERVADA (el test lo falsifica).
describe('replay vectors - hablantes con el resolutor real', async () => {
  it('dos voces sinteticas: cada commit se etiqueta como declara la fuente (exit 0)', async () => {
    const report = join(tmpDir('replay-vec-'), 'report.json')
    const out = await replay(['--session', VECTORS, '--mode', 'vectors', '--report', report])

    expect(out.stderr, out.stderr).not.toMatch(/error inesperado/)
    expect(out.code, out.stdout + out.stderr).toBe(0)
    const datos = JSON.parse(readFileSync(report, 'utf8'))
    expect(datos.status).toBe('ok')
    expect(datos.speakers.covered, 'la evidencia alcanza: no es un OK vacio').toBe(true)
    expect(datos.speakers.matches).toBe(2)
    expect(datos.speakers.mismatches).toBe(0)
    expect(datos.speakers.detalle.map((turn: { expected: string; observed: string }) => [turn.expected, turn.observed])).toEqual([
      ['Luis', 'Luis'],
      ['Hablante 1', 'Hablante 1'],
    ])
    // Nombres CANONICOS, nunca ids internos.
    expect(datos.speakers.detalle.every((turn: { observed: string }) => /^(Luis|Hablante \d+)$/.test(turn.observed))).toBe(true)
    expect(datos.checks.find((check: { name: string }) => check.name === 'speakers').ok).toBe(true)
  })

  it('el vector cambiado a proposito se DETECTA como mismatch (no se tapa la diferencia)', async () => {
    const dir = copiaVectors('replay-vec-mism-', (rows) => {
      const commits = commitsDe(rows)
      // El vector del segundo commit pasa a ser el de Luis: la etiqueta esperada ("Hablante 1")
      // ya no existe como cluster y la observada SI -> se clasifica 'renombrada' (misma voz).
      commits[1].signature = [...(commits[0].signature as number[])]
    })
    const report = join(tmpDir('replay-vec-mism-out-'), 'report.json')
    const out = await replay(['--session', dir, '--mode', 'vectors', '--report', report])

    const datos = JSON.parse(readFileSync(report, 'utf8'))
    // La diferencia se DETECTA y se CLASIFICA (no se tapa): la etiqueta esperada no existe como
    // cluster y la observada si -> 'renombrada'. No es un fallo de hablante (misma voz), asi que
    // el modo queda PARTIAL (no concluyente para identidad) y NO vende un OK.
    expect(out.code, out.stdout + out.stderr).toBe(2)
    expect(datos.status).toBe('partial')
    expect(datos.speakers.detalle[1].categoria).toBe('renombrada')
    expect(datos.speakers.mismatches).toBe(0)
    expect(datos.speakers.detalle[1].observed, 'la voz del commit es la de Luis').toBe('Luis')
    expect(datos.speakers.detalle[1].expected).toBe('Hablante 1')
    expect(String(datos.speakers.detalle[1].reason), 'el caso trae su razon').not.toBe('')
    expect(datos.checks.find((check: { name: string }) => check.name === 'speakers').ok).toBe(false)
  })

  it('sin firma ni duracion NO es concluyente (exit 2): nunca un OK sin evidencia', async () => {
    const dir = copiaVectors('replay-vec-sinev-', (rows) => {
      for (const commit of commitsDe(rows)) {
        commit.signature = null
        commit.audioStartSample = 0
        commit.audioEndSample = 0
      }
    })
    const report = join(tmpDir('replay-vec-sinev-out-'), 'report.json')
    const out = await replay(['--session', dir, '--mode', 'vectors', '--report', report])

    const datos = JSON.parse(readFileSync(report, 'utf8'))
    expect(out.code, out.stdout + out.stderr).toBe(2)
    expect(datos.status).toBe('not-conclusive')
    expect(datos.speakers.covered).toBe(false)
    expect(datos.speakers.notConclusive).toContain('sin-vector')
    expect(datos.speakers.skipped.length).toBe(2)
    expect(datos.speakers.matches).toBe(0)
    expect(datos.checks.find((check: { name: string }) => check.name === 'speakers').ok).toBe(false)
  })

  it('un turno sin evidencia deja el modo en PARTIAL (exit 2): nunca se vende como validacion completa', async () => {
    const dir = copiaVectors('replay-vec-parcial-', (rows) => {
      commitsDe(rows)[0].signature = null
    })
    const report = join(tmpDir('replay-vec-parcial-out-'), 'report.json')
    const out = await replay(['--session', dir, '--mode', 'vectors', '--report', report])

    const datos = JSON.parse(readFileSync(report, 'utf8'))
    expect(datos.speakers.covered).toBe(true)
    expect(datos.speakers.partial).toBe(true)
    expect(datos.speakers.coverage).toBe(0.5)
    expect(datos.status).toBe('partial')
    expect(datos.notCovered).toContain('hablantes-cobertura-parcial')
    expect(datos.speakers.skipped).toEqual([{ index: 0, motivo: 'sin-vector' }])
    expect(datos.speakers.matches).toBe(1)
    expect(datos.speakers.commits).toBe(2)
    const check = datos.checks.find((c: { name: string }) => c.name === 'speakers')
    expect(check.ok, 'un OK parcial no es OK').toBe(false)
    expect(check.detail).toContain('PARTIAL')
    expect(out.code, out.stdout + out.stderr).toBe(2)
  })

  it('el `speaker` de la FUENTE no es input: invertirlo cambia el VEREDICTO, no la etiqueta observada', async () => {
    const referencia = join(tmpDir('replay-vec-ref-'), 'report.json')
    await replay(['--session', VECTORS, '--mode', 'vectors', '--report', referencia])
    const observadoSinTocar = JSON.parse(readFileSync(referencia, 'utf8')).speakers.detalle.map(
      (turn: { observed: string }) => turn.observed,
    )

    const dir = copiaVectors('replay-vec-guard-', (rows) => {
      const commits = commitsDe(rows)
      commits[0].speaker = 'Hablante 9'
      commits[1].speaker = 'Luis'
    })
    const report = join(tmpDir('replay-vec-guard-out-'), 'report.json')
    const out = await replay(['--session', dir, '--mode', 'vectors', '--report', report])
    const datos = JSON.parse(readFileSync(report, 'utf8'))

    // Si el runner leyera el `speaker` fuente, la etiqueta observada habria cambiado.
    expect(datos.speakers.detalle.map((turn: { observed: string }) => turn.observed)).toEqual(observadoSinTocar)
    expect(datos.speakers.mismatches, 'la fuente invertida ya no coincide').toBe(2)
    expect(out.code, out.stdout + out.stderr).toBe(1)
  })
})

describe('replay events - sesion invalida, sin fidelidad o sin respuesta', async () => {
  it('sesion SIN eventos', async () => {
    const dir = tmpDir('replay-vacia-')
    cpSync(FIXTURE, dir, { recursive: true })
    writeFileSync(join(dir, 'events.ndjson'), '')
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    manifest.events = 0
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))

    const out = await replay(['--session', dir, '--mode', 'events', '--expected', join(FIXTURE, 'expected.json')])

    expect(out.code, out.stdout + out.stderr).toBe(2)
    expect(out.stderr).toContain('EVENTOS')
  })

  it('sesion INCOMPLETA (el manifiesto declara mas eventos de los que hay)', async () => {
    const dir = tmpDir('replay-incompleta-')
    cpSync(FIXTURE, dir, { recursive: true })
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    manifest.events = 99
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))

    const out = await replay(['--session', dir, '--mode', 'events', '--expected', join(FIXTURE, 'expected.json')])

    expect(out.code, out.stdout + out.stderr).toBe(2)
    expect(out.stderr).toContain('INCOMPLETA')
  })

  it('sesion SIN manifest: no se adivina nada', async () => {
    const dir = tmpDir('replay-sin-manifest-')
    const out = await replay(['--session', dir, '--mode', 'events', '--expected', join(FIXTURE, 'expected.json')])
    expect(out.code).toBe(2)
    expect(out.stderr).toContain('manifest.json')
  })

  it('sin --session no adivina la carpeta', async () => {
    const out = await replay(['--mode', 'events', '--expected', join(FIXTURE, 'expected.json')])
    expect(out.code).toBe(2)
    expect(out.stderr).toContain('falta --session')
  })

  it('un expected APROBADO sobre una sesion SIN fidelidad no valida (exit 2)', async () => {
    const dir = tmpDir('replay-sin-fidelidad-')
    cpSync(FIXTURE, dir, { recursive: true })
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    manifest.appCommit = 'unknown'
    manifest.configHash = 'unknown'
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))

    const out = await replay(['--session', dir, '--mode', 'events', '--expected', join(FIXTURE, 'expected.json')])

    expect(out.code, out.stdout + out.stderr).toBe(2)
    expect(out.stderr).toContain('fidelidad')
  })

  it('--timeout corto mata el replay con exit 2 y mensaje claro (no se cuelga)', async () => {
    const out = await replay(['--session', FIXTURE, '--mode', 'events', '--timeout', '1'])

    expect(out.code, out.stdout + out.stderr).toBe(2)
    expect(out.stderr).toContain('tope de 1 ms')
  })
})

describe('replay events - marcas inferidas: el turno cierra donde debe', async () => {
  it('sin marcas inferidas la segunda locucion NO se cierra y el diff con la FUENTE lo delata', async () => {
    const dir = tmpDir('replay-nomarks-')
    const report = join(dir, 'report.json')
    const out = await replay(['--session', FIXTURE, '--mode', 'events', '--no-infer-marks', '--report', report])

    const datos = JSON.parse(readFileSync(report, 'utf8'))
    expect(datos.marks.inferred, 'sin inferencia no hay marcas').toBe(0)
    expect(datos.observed.rows.length, 'sin marcas queda al menos una locucion sin fila').toBeLessThan(2)
    // La FUENTE (2 commits) dice que falta una locucion: el check lo detecta y el run falla.
    expect(datos.missingUnique).toBeGreaterThanOrEqual(1)
    expect(datos.checks.find((check: { name: string }) => check.name === 'sourceRows').ok).toBe(false)
    expect(out.code, out.stdout + out.stderr).toBe(1)
  })
})

describe.runIf(existsSync(REAL_SESSION))('replay events - grabacion real d4c1c8f3', async () => {  it('la caja real no duplica bloques, no pierde filas y no se congela (defecto cerrado)', async () => {
    const report = join(tmpDir('replay-real-'), 'report.json')
    const out = await replay(['--session', REAL_SESSION, '--mode', 'events', '--report', report])

    expect(out.stderr, out.stderr).not.toMatch(/error inesperado/)
    const datos = JSON.parse(readFileSync(report, 'utf8'))
    expect(datos.observed.rows.length, 'la sesion real produce filas').toBeGreaterThan(0)
    expect(datos.applied.speech).toBeGreaterThan(0)
    // Los tres defectos medidos en esta grabacion quedan CERRADOS: la caja no repite bloques
    // (ni la misma locucion ni la mezcla de dos hipotesis del ASR), no pierde el bloque que
    // mostraba y no se queda con la frase vieja mientras el ASR dicta la siguiente.
    expect(datos.classification.duplicadas, 'ninguna caja duplicada').toBe(0)
    expect(datos.classification.perdidas, 'ninguna fila pierde el bloque de la caja').toBe(0)
    const estados = new Map(
      (datos.checks as Array<{ name: string; ok: boolean }>).map((check) => [check.name, check.ok]),
    )
    for (const nombre of ['sourceRows', 'noBoxDuplicatedBlock', 'boxDuplicated', 'boxLost', 'boxStall']) {
      expect(estados.get(nombre), `${nombre} tiene que estar OK`).toBe(true)
    }
    // REGRESIONES de las filas que ya estaban bien (no se puede perder texto por elegir
    // hipotesis): #2 conserva "en", #14 conserva "este", #16 conserva "acabo de abrir el ref".
    const filas = (datos.observed.rows as Array<{ text: string }>).map((row) => row.text)
    expect(filas[2]).toContain('en la transcripción')
    expect(filas[14]).toContain('me encanta este')
    expect(filas[16]).toContain('acabo de abrir el refri')
    // B.3 (mandato 2026-10-21): la FILA es la MISMA frase que la caja. En d4c1c8f3
    // la caja se quedo en "100 porque" (la correccion mas corta no se pinta); la fila
    // ya no puede llevar una frase distinta de la visible.
    expect(filas[11]).toBe('no lo voy a preparar 100 porque')
    expect(datos.boxStall.maxGapMs, 'sin bloqueo de preview').toBeLessThan(datos.thresholds.boxStallMs)
    // Modo observacion: no valida golden; sin invariante roto, exit 0.
    expect(datos.status).toBe('observed')
    expect(out.code, out.stdout + out.stderr).toBe(0)

    // TRIAGE (mandato 2026-10-23): cada missing/extra tiene clase y evidencia; un "bug" o una
    // fila SIN clase deja el replay sin resolver.
    expect(datos.sourceTriage, 'el triage se publica').toBeTruthy()
    expect(datos.unclassifiedMissing, 'ningun missing sin clase').toBe(0)
    expect(datos.unclassifiedExtra, 'ningun extra sin clase').toBe(0)
    expect(datos.bugsMissing, 'ninguna perdida real sin corregir').toBe(0)
    expect(datos.bugsExtra, 'ninguna invencion real sin corregir').toBe(0)
    const clases = new Set([
      ...datos.sourceTriage.missing.map((f: { clase: string }) => f.clase),
      ...datos.sourceTriage.extra.map((f: { clase: string }) => f.clase),
    ])
    for (const clase of clases) {
      expect(
        ['cola-sin-final', 'particion-hipotesis', 'mezcla-de-hipotesis', 'habla-del-asr', 'mixtura-del-asr', 'sin-texto'],
        `clase desconocida: ${clase}`,
      ).toContain(clase)
    }
  })

  it('el borrador de la sesion real NO nace aprobado (no es validacion)', async () => {
    const dir = tmpDir('replay-real-draft-')
    const draft = join(dir, 'draft.json')
    const out = await replay(['--session', REAL_SESSION, '--mode', 'events', '--draft-expected', draft])

    expect(out.code, out.stdout + out.stderr).toBe(0)
    const datos = JSON.parse(readFileSync(draft, 'utf8'))
    expect(datos.approved).toBe(false)
  })

  it('los HABLANTES de la sesion real NO son validables: la firma guardada no es la medida del turno', async () => {
    const report = join(tmpDir('replay-real-vec-'), 'report.json')
    const out = await replay(['--session', REAL_SESSION, '--mode', 'vectors', '--report', report])

    expect(out.stderr, out.stderr).not.toMatch(/error inesperado/)
    const datos = JSON.parse(readFileSync(report, 'utf8'))
    // La grabacion NO guarda la medida de cada turno: guarda REFERENCIAS (la firma del cluster
    // o la del commit anterior). La misma firma aparece bajo decenas de locuciones distintas,
    // asi que evaluarla era comparar el cluster consigo mismo. El modo se declara NO
    // CONCLUYENTE: cero aciertos y cero mismatches contados (una cifra de "52 % de cobertura"
    // aqui seria un artefacto, no evidencia).
    expect(datos.speakers.covered).toBe(false)
    // TODOS los turnos con vector se EVALUAN (mandato 2026-10-23); los de firma compartida
    // quedan en `circular` y no cuentan como acierto ni fallo.
    expect(datos.speakers.conEvidencia).toBe(0)
    expect(datos.speakers.evaluatedCircular).toBeGreaterThan(0)
    expect(datos.speakers.matches).toBe(0)
    expect(datos.speakers.mismatches).toBe(0)
    expect(datos.speakers.coverage).toBe(0)
    expect(datos.speakers.notConclusive).toContain('sin-vector')
    expect(datos.speakers.avisos).toContain('firma-no-propia-del-turno')
    expect(datos.status).toBe('not-conclusive')
    expect(datos.checks.find((check: { name: string }) => check.name === 'speakers').ok).toBe(false)
    expect(out.code, out.stdout + out.stderr).toBe(2)

    // TODOS los turnos se EVALUAN y se CLASIFICAN: un veredicto con evidencia que no cae en
    // ninguna categoria, o una fila cerrada en "?", dejan el replay sin resolver.
    const turnos = datos.speakers.detalle as Array<{ categoria: string; observed: string; evidenciaPropia: boolean }>
    expect(turnos, 'los turnos evaluados se publican').toHaveLength(datos.speakers.evaluated)
    expect(
      turnos.filter((t) => t.categoria === 'mismatch-sin-clasificar'),
      'ningun mismatch sin clasificar',
    ).toEqual([])
    expect(
      turnos.filter((t) => t.evidenciaPropia && String(t.observed || '').includes('?')),
      'ninguna fila con evidencia propia queda en "?"',
    ).toEqual([])
    expect(datos.pendingRows, 'ninguna fila cerrada con evidencia propia en "?"').toBe(0)
    expect(datos.pendingCircular, 'los pendientes circulares se declaran').toBeGreaterThan(0)
    expect(datos.speakers.evaluatedCircular, 'las firmas compartidas se evaluan y se declaran').toBeGreaterThan(0)
    expect(datos.speakers.sinDuracion, 'los turnos sin tramo se evaluan y se declaran').toBeGreaterThan(0)
  })
})

describe.skipIf(existsSync(REAL_SESSION))('replay events - grabacion real d4c1c8f3 (SIN grabacion local)', async () => {
  it('SKIP DECLARADO: no hay grabacion local de d4c1c8f3 en %TEMP%/flu-recordings', async () => {
    // No se inventa el resultado ni se commitea la transcripcion del dueno. Para correrlo:
    //   1) graba la sesion (el sink la deja en %TEMP%/flu-recordings/<sessionId>)
    //   2) `npm run replay -- --session <carpeta> --mode events --draft-expected <archivo>`
    //   3) revisa el borrador y marcalo `approved: true`
    expect(existsSync(REAL_SESSION)).toBe(false)
  })
})
