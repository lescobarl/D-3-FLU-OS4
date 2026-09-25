/**
 * P7.20 - El sensor (auditoria.mjs) y el ledger no pueden divergir.
 *
 * POR QUE EXISTE: en esta rama hubo DOS sistemas de seguimiento a la vez
 * (plans/ledger.json y scripts/auditoria.mjs) y el mismo trabajo tenia dos ids
 * (hasToken = D5 = P7.11; "npm run lint no es lint real" = V19 = P7.1). Dos fuentes
 * de verdad es exactamente el defecto que la rama corrige.
 *
 * REPARTO: `scripts/auditoria.mjs` es el SENSOR (mide el codigo, da HOY/META por id);
 * `plans/ledger.json` es la UNICA fuente de ESTADO. Este guard los cose: cada hallazgo
 * abierto del sensor tiene que estar registrado como item de ledger NO cerrado, y
 * ningun item cerrado puede tener su hallazgo aun por encima de META. Sin esto, un
 * hallazgo puede quedar abierto en el sensor e invisible en el ledger (o al reves:
 * marcado done mientras el codigo sigue mal).
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

interface Hallazgo {
  id: string
  info: boolean
  today: number
  target: number
  title: string
}
interface ItemLedger {
  id: string
  estado: string
  auditoria?: string
}

/** Hallazgos NO informativos que superan su META (trabajo real pendiente). */
export function hallazgosAbiertos(audit: Hallazgo[]): Hallazgo[] {
  return audit.filter((f) => !f.info && f.today > f.target)
}

/** Desajustes entre sensor y ledger, en las dos direcciones. */
export function desincronizados(audit: Hallazgo[], items: ItemLedger[]): string[] {
  const out: string[] = []
  for (const f of hallazgosAbiertos(audit)) {
    const cubierto = items.some((i) => i.auditoria === f.id && i.estado !== 'done')
    if (!cubierto) out.push(`${f.id} (hoy=${f.today} meta=${f.target}) abierto en el sensor y sin item de ledger abierto`)
  }
  for (const i of items) {
    const f = i.auditoria ? audit.find((x) => x.id === i.auditoria) : undefined
    if (i.estado === 'done' && f && f.today > f.target) {
      out.push(`${i.id} cerrado pero ${f.id} sigue en hoy=${f.today} meta=${f.target}`)
    }
  }
  return out
}

function leerSensor(): Hallazgo[] {
  const r = spawnSync('node', ['scripts/auditoria.mjs', '--json'], { cwd: ROOT, encoding: 'utf8' })
  if (r.status !== 0) throw new Error('auditoria.mjs fallo: ' + (r.stderr || '').slice(0, 400))
  return JSON.parse(r.stdout)
}

describe('P7.20 - el sensor de auditoria y el ledger no divergen', () => {
  it('todo hallazgo abierto del sensor esta registrado en el ledger', () => {
    const ledger = JSON.parse(readFileSync(join(ROOT, 'plans/ledger.json'), 'utf8'))
    const out = desincronizados(leerSensor(), ledger.items)
    expect(out, 'trabajo invisible (sensor abierto, ledger sin registrar):\n  ' + out.join('\n  ')).toEqual([])
  })

  it('el catalogo completo pasa --strict: el sensor es un gate, no prosa', () => {
    // P7.23: la clasificacion de scripts/auditoria.mjs (ALLOW_COLLISION, KNOWN_GROUPS,
    // META por hallazgo) la aplicaba el auditor A MANO. Sin esto, el catalogo era prosa:
    // nada impedia meter un hallazgo nuevo y no mirarlo. Con --strict dentro de
    // lint:guards (que cuelga de `npm run lint`), un hallazgo por encima de su META
    // rompe el lint.
    const r = spawnSync('node', ['scripts/auditoria.mjs', '--strict'], { cwd: ROOT, encoding: 'utf8' })
    expect(r.status, 'auditoria --strict fallo:\n' + (r.stdout || '') + (r.stderr || '')).toBe(0)
  })

  it('el detector no es decorativo', () => {
    const audit: Hallazgo[] = [
      { id: 'X1', info: false, today: 3, target: 0, title: 'x' },
      { id: 'X2', info: true, today: 9, target: 0, title: 'info no cuenta' },
      { id: 'X3', info: false, today: 1, target: 1, title: 'en meta -> ok' },
    ]
    // X1 abierto y sin item -> desajuste.
    expect(desincronizados(audit, [])).toHaveLength(1)
    expect(desincronizados(audit, [])[0]).toContain('X1')
    // Registrado como no cerrado -> ok (X2 informativo y X3 en meta no cuentan).
    expect(desincronizados(audit, [{ id: 'PX', estado: 'todo', auditoria: 'X1' }])).toEqual([])
    // Cerrado con el hallazgo aun abierto -> mentira, y se reporta por las DOS caras
    // (el hallazgo sigue sin item abierto + el item cerrado no se sostiene).
    const doble = desincronizados(audit, [{ id: 'PX', estado: 'done', auditoria: 'X1' }])
    expect(doble).toHaveLength(2)
    expect(doble.some((m) => m.includes('X1'))).toBe(true)
    expect(doble.some((m) => m.includes('PX'))).toBe(true)
  })
})
