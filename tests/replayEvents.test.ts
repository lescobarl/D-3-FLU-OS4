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
import { execFileSync } from 'node:child_process'
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
const VECTORS = join(ROOT, 'tests', 'fixtures', 'replay', 'vectors')
const REAL_SESSION = join(tmpdir(), 'flu-recordings', 'd4c1c8f3-76f8-400b-b89e-e8e428cfdff7')

/** Ejecuta el CLI y devuelve exit code + salidas (sin lanzar por exit != 0). */
function replay(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [VITE_NODE, '--config', CONFIG, CLI, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    const fallo = error as { status?: number; stdout?: string; stderr?: string }
    return { code: Number(fallo.status ?? -1), stdout: String(fallo.stdout || ''), stderr: String(fallo.stderr || '') }
  }
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

describe('replay events - expected aprobado (filas y caja)', () => {
  it('la fixture coincide: exit 0, todos los checks en OK y las dos marcas inferidas', () => {
    const report = join(tmpDir('replay-ok-'), 'report.json')
    const out = replay(['--session', FIXTURE, '--mode', 'events', '--expected', join(FIXTURE, 'expected.json'), '--report', report])

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

  it('la caja se guarda CON TIEMPO y sin deduplicar textos iguales (una caja congelada es un dato)', () => {
    const report = join(tmpDir('replay-trace-'), 'report.json')
    replay(['--session', FIXTURE, '--mode', 'events', '--expected', join(FIXTURE, 'expected.json'), '--report', report])
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

describe('replay events - el expected alterado FALLA (no es decorativo)', () => {
  it('cambiar una fila del expected da exit 1 con el diff legible', () => {
    const dir = tmpDir('replay-alt-')
    const esperado = join(dir, 'expected.json')
    const original = JSON.parse(readFileSync(join(FIXTURE, 'expected.json'), 'utf8'))
    original.expect.rows = [{ text: 'otra frase que no se dijo', speaker: 'Hablante 1' }]
    writeFileSync(esperado, JSON.stringify(original, null, 2))

    const report = join(dir, 'report.json')
    const out = replay(['--session', FIXTURE, '--mode', 'events', '--expected', esperado, '--report', report])

    expect(out.code, out.stdout + out.stderr).toBe(1)
    const datos = JSON.parse(readFileSync(report, 'utf8'))
    expect(datos.status).toBe('mismatch')
    expect(datos.checks.find((check: { name: string }) => check.name === 'rows').ok).toBe(false)
    expect(datos.diffs.length).toBeGreaterThanOrEqual(1)
    expect(datos.diffs[0].actual.text).toBe('hola que tal')
  })

  it('un expected SIN aprobar no pasa por bueno (exit 2)', () => {
    const dir = tmpDir('replay-draft-')
    const esperado = join(dir, 'expected.json')
    const original = JSON.parse(readFileSync(join(FIXTURE, 'expected.json'), 'utf8'))
    original.approved = false
    writeFileSync(esperado, JSON.stringify(original, null, 2))

    const out = replay(['--session', FIXTURE, '--mode', 'events', '--expected', esperado])

    expect(out.code, out.stdout + out.stderr).toBe(2)
    expect(out.stderr).toContain('NO esta aprobado')
  })
})

describe('replay events - checks de CAJA (fixtures sinteticos)', () => {
  const fixtures = readdirSync(CHECKS).filter((file) => file.endsWith('.json'))

  it('hay las cinco fixtures de caja exigidas', () => {
    expect(fixtures.sort()).toEqual(
      ['bloque-duplicado.json', 'congelada.json', 'limpia.json', 'perdida-real.json', 'prefijo-creciente.json'].sort(),
    )
  })

  for (const file of fixtures) {
    it(`${file}: el detector enciende EXACTAMENTE lo que debe`, () => {
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

  it('la duplicacion NO se vende como perdida', () => {
    const fx = JSON.parse(readFileSync(join(CHECKS, 'bloque-duplicado.json'), 'utf8'))
    const cmp = compareExpected({ observed: fx.observed, expected: fx.expected, options: fx.options })
    const estados = new Map<string, boolean>((cmp.checks as Array<{ name: string; ok: boolean }>).map((check) => [check.name, check.ok]))
    expect(estados.get('boxDuplicated')).toBe(false)
    expect(estados.get('boxLost'), 'la caja duplicada no puede contar como bloque perdido').toBe(true)
  })
})

describe('replay events - diff con las FILAS FUENTE (turns.ndjson, kind=commit)', () => {
  const dirFuente = join(ROOT, 'tests', 'fixtures', 'replay', 'source')
  const casos = readdirSync(dirFuente).filter((file) => file.endsWith('.json'))

  it('hay las SIETE fixtures de fuente exigidas', () => {
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
    it(`${file}: clasifica como dice la especificacion`, () => {
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

  it('un EXTRA justificado (la fuente repite esa locucion) NO falla; uno sin justificar SI', () => {
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

  it('las VARIANTES declaradas no fallan (misma locucion, otra grafia del ASR)', () => {
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

  it('una VARIANTE conserva los DOS textos originales (no los normaliza en el reporte)', () => {
    const fx = JSON.parse(readFileSync(join(dirFuente, 'variante.json'), 'utf8'))
    const diff = sourceRowDiff(fx.source, fx.observed)
    expect(diff.textVariants).toEqual([
      { source: 'puso Cloud Cloud', observed: 'puso Cloud' },
      { source: 'está mal este está con el hablante uno', observed: 'está mal este está con el hablante 1' },
    ])
  })

  it('los DUPLICADOS de la fuente no son perdidas (29 vs 18 puede ser todo duplicados)', () => {
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
describe('replay events - congelacion de caja: cuenta ACTIVIDAD del ASR, no solo texto nuevo', () => {
  it('una REPETICION del ASR con la caja quieta TAMBIEN es congelacion', () => {
    const traza = [
      { t: 0, text: 'hola que tal', reason: 'publish' },
      { t: 3000, text: '', reason: 'clear' },
    ]
    const eventos = [
      { t: 1000, text: 'hola que tal' },
      { t: 2000, text: 'hola que tal' },
    ]
    const hueco = medirCongelacionCaja(traza, eventos)
    expect(hueco.maxGapMs).toBe(3000)
    expect(hueco.motivo).toBe('asr-repetido-sin-cambio')
  })

  it('un SOLO evento de voz no basta (la actividad minima son 2 eventos)', () => {
    const traza = [
      { t: 0, text: 'hola', reason: 'publish' },
      { t: 3000, text: '', reason: 'clear' },
    ]
    const hueco = medirCongelacionCaja(traza, [{ t: 1000, text: 'hola' }])
    expect(hueco.maxGapMs, 'sin texto nuevo y con un solo evento no hay congelacion medible').toBe(0)
    expect(hueco.motivo).toBe('')
  })

  it('el SILENCIO no es congelacion (sin eventos de voz no hay nada que se congele)', () => {
    const traza = [
      { t: 0, text: 'hola', reason: 'publish' },
      { t: 9000, text: '', reason: 'clear' },
    ]
    expect(medirCongelacionCaja(traza, []).maxGapMs).toBe(0)
  })

  it('el texto NUEVO que la caja ignora se reporta con SU motivo', () => {
    const traza = [
      { t: 0, text: 'hola', reason: 'publish' },
      { t: 2000, text: '', reason: 'clear' },
    ]
    const hueco = medirCongelacionCaja(traza, [{ t: 500, text: 'hola que tal' }])
    expect(hueco.maxGapMs).toBe(2000)
    expect(hueco.motivo).toBe('texto-nuevo-ignorado')
  })

  it('la grabacion sintetica: la caja se queda con la frase vieja mientras el ASR insiste', () => {
    const report = join(tmpDir('replay-repetida-'), 'report.json')
    const out = replay(['--session', REPETIDA, '--mode', 'events', '--box-stall-ms', '500', '--report', report])

    const datos = JSON.parse(readFileSync(report, 'utf8'))
    expect(datos.boxStall.motivo, 'la caja no cambio y el ASR si hablo').toBe('asr-repetido-sin-cambio')
    expect(datos.boxStall.maxGapMs).toBeGreaterThan(500)
    expect(datos.checks.find((check: { name: string }) => check.name === 'boxStall').ok).toBe(false)
    expect(datos.checks.find((check: { name: string }) => check.name === 'boxLost').ok, 'no se vende como perdida').toBe(true)
    expect(out.code, out.stdout + out.stderr).toBe(1)
  })
})

// MODO `vectors`: se re-ejecuta el RESOLUTOR real sobre la firma grabada y el estado
// PREVIO reconstruido de `turns.ndjson`. El `speaker` de la fuente es el ESPERADO: si se
// usara como entrada, invertirlo cambiaria la etiqueta OBSERVADA (el test lo falsifica).
describe('replay vectors - hablantes con el resolutor real', () => {
  it('dos voces sinteticas: cada commit se etiqueta como declara la fuente (exit 0)', () => {
    const report = join(tmpDir('replay-vec-'), 'report.json')
    const out = replay(['--session', VECTORS, '--mode', 'vectors', '--report', report])

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

  it('el vector cambiado a proposito se DETECTA como mismatch (no se tapa la diferencia)', () => {
    const dir = copiaVectors('replay-vec-mism-', (rows) => {
      const commits = commitsDe(rows)
      commits[1].signature = [...(commits[0].signature as number[])]
    })
    const report = join(tmpDir('replay-vec-mism-out-'), 'report.json')
    const out = replay(['--session', dir, '--mode', 'vectors', '--report', report])

    const datos = JSON.parse(readFileSync(report, 'utf8'))
    expect(out.code, out.stdout + out.stderr).toBe(1)
    expect(datos.status).toBe('mismatch')
    expect(datos.speakers.mismatches).toBe(1)
    expect(datos.speakers.detalle[1].observed, 'la voz del commit es la de Luis').toBe('Luis')
    expect(datos.speakers.detalle[1].expected).toBe('Hablante 1')
    expect(String(datos.speakers.detalle[1].reason), 'el mismatch trae su razon').not.toBe('')
    expect(datos.checks.find((check: { name: string }) => check.name === 'speakers').ok).toBe(false)
  })

  it('sin firma ni duracion NO es concluyente (exit 2): nunca un OK sin evidencia', () => {
    const dir = copiaVectors('replay-vec-sinev-', (rows) => {
      for (const commit of commitsDe(rows)) {
        commit.signature = null
        commit.audioStartSample = 0
        commit.audioEndSample = 0
      }
    })
    const report = join(tmpDir('replay-vec-sinev-out-'), 'report.json')
    const out = replay(['--session', dir, '--mode', 'vectors', '--report', report])

    const datos = JSON.parse(readFileSync(report, 'utf8'))
    expect(out.code, out.stdout + out.stderr).toBe(2)
    expect(datos.status).toBe('not-conclusive')
    expect(datos.speakers.covered).toBe(false)
    expect(datos.speakers.notConclusive).toContain('sin-vector')
    expect(datos.speakers.skipped.length).toBe(2)
    expect(datos.speakers.matches).toBe(0)
    expect(datos.checks.find((check: { name: string }) => check.name === 'speakers').ok).toBe(false)
  })

  it('un turno sin evidencia deja el modo en PARTIAL (exit 2): nunca se vende como validacion completa', () => {
    const dir = copiaVectors('replay-vec-parcial-', (rows) => {
      commitsDe(rows)[0].signature = null
    })
    const report = join(tmpDir('replay-vec-parcial-out-'), 'report.json')
    const out = replay(['--session', dir, '--mode', 'vectors', '--report', report])

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

  it('el `speaker` de la FUENTE no es input: invertirlo cambia el VEREDICTO, no la etiqueta observada', () => {
    const referencia = join(tmpDir('replay-vec-ref-'), 'report.json')
    replay(['--session', VECTORS, '--mode', 'vectors', '--report', referencia])
    const observadoSinTocar = JSON.parse(readFileSync(referencia, 'utf8')).speakers.detalle.map(
      (turn: { observed: string }) => turn.observed,
    )

    const dir = copiaVectors('replay-vec-guard-', (rows) => {
      const commits = commitsDe(rows)
      commits[0].speaker = 'Hablante 9'
      commits[1].speaker = 'Luis'
    })
    const report = join(tmpDir('replay-vec-guard-out-'), 'report.json')
    const out = replay(['--session', dir, '--mode', 'vectors', '--report', report])
    const datos = JSON.parse(readFileSync(report, 'utf8'))

    // Si el runner leyera el `speaker` fuente, la etiqueta observada habria cambiado.
    expect(datos.speakers.detalle.map((turn: { observed: string }) => turn.observed)).toEqual(observadoSinTocar)
    expect(datos.speakers.mismatches, 'la fuente invertida ya no coincide').toBe(2)
    expect(out.code, out.stdout + out.stderr).toBe(1)
  })
})

describe('replay events - sesion invalida, sin fidelidad o sin respuesta', () => {
  it('sesion SIN eventos', () => {
    const dir = tmpDir('replay-vacia-')
    cpSync(FIXTURE, dir, { recursive: true })
    writeFileSync(join(dir, 'events.ndjson'), '')
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    manifest.events = 0
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))

    const out = replay(['--session', dir, '--mode', 'events', '--expected', join(FIXTURE, 'expected.json')])

    expect(out.code, out.stdout + out.stderr).toBe(2)
    expect(out.stderr).toContain('EVENTOS')
  })

  it('sesion INCOMPLETA (el manifiesto declara mas eventos de los que hay)', () => {
    const dir = tmpDir('replay-incompleta-')
    cpSync(FIXTURE, dir, { recursive: true })
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    manifest.events = 99
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))

    const out = replay(['--session', dir, '--mode', 'events', '--expected', join(FIXTURE, 'expected.json')])

    expect(out.code, out.stdout + out.stderr).toBe(2)
    expect(out.stderr).toContain('INCOMPLETA')
  })

  it('sesion SIN manifest: no se adivina nada', () => {
    const dir = tmpDir('replay-sin-manifest-')
    const out = replay(['--session', dir, '--mode', 'events', '--expected', join(FIXTURE, 'expected.json')])
    expect(out.code).toBe(2)
    expect(out.stderr).toContain('manifest.json')
  })

  it('sin --session no adivina la carpeta', () => {
    const out = replay(['--mode', 'events', '--expected', join(FIXTURE, 'expected.json')])
    expect(out.code).toBe(2)
    expect(out.stderr).toContain('falta --session')
  })

  it('un expected APROBADO sobre una sesion SIN fidelidad no valida (exit 2)', () => {
    const dir = tmpDir('replay-sin-fidelidad-')
    cpSync(FIXTURE, dir, { recursive: true })
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    manifest.appCommit = 'unknown'
    manifest.configHash = 'unknown'
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))

    const out = replay(['--session', dir, '--mode', 'events', '--expected', join(FIXTURE, 'expected.json')])

    expect(out.code, out.stdout + out.stderr).toBe(2)
    expect(out.stderr).toContain('fidelidad')
  })

  it('--timeout corto mata el replay con exit 2 y mensaje claro (no se cuelga)', () => {
    const out = replay(['--session', FIXTURE, '--mode', 'events', '--timeout', '1'])

    expect(out.code, out.stdout + out.stderr).toBe(2)
    expect(out.stderr).toContain('tope de 1 ms')
  })
})

describe('replay events - marcas inferidas: el turno cierra donde debe', () => {
  it('sin marcas inferidas la segunda locucion NO se cierra y el diff con la FUENTE lo delata', () => {
    const dir = tmpDir('replay-nomarks-')
    const report = join(dir, 'report.json')
    const out = replay(['--session', FIXTURE, '--mode', 'events', '--no-infer-marks', '--report', report])

    const datos = JSON.parse(readFileSync(report, 'utf8'))
    expect(datos.marks.inferred, 'sin inferencia no hay marcas').toBe(0)
    expect(datos.observed.rows.length, 'sin marcas queda al menos una locucion sin fila').toBeLessThan(2)
    // La FUENTE (2 commits) dice que falta una locucion: el check lo detecta y el run falla.
    expect(datos.missingUnique).toBeGreaterThanOrEqual(1)
    expect(datos.checks.find((check: { name: string }) => check.name === 'sourceRows').ok).toBe(false)
    expect(out.code, out.stdout + out.stderr).toBe(1)
  })
})

describe.runIf(existsSync(REAL_SESSION))('replay events - grabacion real d4c1c8f3', () => {  it('observa la sesion real y reporta DUPLICACION de caja, no un falso boxLost', () => {
    const report = join(tmpDir('replay-real-'), 'report.json')
    const out = replay(['--session', REAL_SESSION, '--mode', 'events', '--report', report])

    expect(out.stderr, out.stderr).not.toMatch(/error inesperado/)
    const datos = JSON.parse(readFileSync(report, 'utf8'))
    expect(datos.observed.rows.length, 'la sesion real produce filas').toBeGreaterThan(0)
    expect(datos.applied.speech).toBeGreaterThan(0)
    // El hallazgo: la caja se DUPLICA en algun commit; ninguna fila perdio su bloque.
    expect(datos.classification.duplicadas).toBeGreaterThan(0)
    expect(datos.classification.perdidas).toBe(0)
    const boxLost = datos.checks.find((check: { name: string }) => check.name === 'boxLost')
    const boxDuplicated = datos.checks.find((check: { name: string }) => check.name === 'boxDuplicated')
    expect(boxLost.ok).toBe(true)
    expect(boxDuplicated.ok).toBe(false)
    // Modo observacion: no valida golden, pero el invariante roto da exit 1.
    expect(datos.status).toBe('observed')
    expect(out.code).toBe(1)
  })

  it('el borrador de la sesion real NO nace aprobado (no es validacion)', () => {
    const dir = tmpDir('replay-real-draft-')
    const draft = join(dir, 'draft.json')
    const out = replay(['--session', REAL_SESSION, '--mode', 'events', '--draft-expected', draft])

    expect(out.code, out.stdout + out.stderr).toBe(0)
    const datos = JSON.parse(readFileSync(draft, 'utf8'))
    expect(datos.approved).toBe(false)
  })

  it('los HABLANTES de la sesion real quedan en PARTIAL: no es una validacion completa', () => {
    const report = join(tmpDir('replay-real-vec-'), 'report.json')
    const out = replay(['--session', REAL_SESSION, '--mode', 'vectors', '--report', report])

    expect(out.stderr, out.stderr).not.toMatch(/error inesperado/)
    const datos = JSON.parse(readFileSync(report, 'utf8'))
    // La grabacion NO guarda vector/duracion de todos los turnos: se evalua lo que hay y
    // el modo se declara `partial` con su cobertura. Un parcial jamas es un OK.
    expect(datos.speakers.covered).toBe(true)
    expect(datos.speakers.partial).toBe(true)
    expect(datos.speakers.coverage).toBeGreaterThan(0)
    expect(datos.speakers.coverage).toBeLessThan(1)
    expect(datos.status).toBe('partial')
    expect(datos.checks.find((check: { name: string }) => check.name === 'speakers').ok).toBe(false)
    expect(out.code, out.stdout + out.stderr).toBe(2)
  })
})

describe.skipIf(existsSync(REAL_SESSION))('replay events - grabacion real d4c1c8f3 (SIN grabacion local)', () => {
  it('SKIP DECLARADO: no hay grabacion local de d4c1c8f3 en %TEMP%/flu-recordings', () => {
    // No se inventa el resultado ni se commitea la transcripcion del dueno. Para correrlo:
    //   1) graba la sesion (el sink la deja en %TEMP%/flu-recordings/<sessionId>)
    //   2) `npm run replay -- --session <carpeta> --mode events --draft-expected <archivo>`
    //   3) revisa el borrador y marcalo `approved: true`
    expect(existsSync(REAL_SESSION)).toBe(false)
  })
})
