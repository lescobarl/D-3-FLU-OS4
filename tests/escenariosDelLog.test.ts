// ============================================================
// escenariosDelLog - REINYECCION de los datos del log para RECREAR los escenarios reportados
// ------------------------------------------------------------
// Reconstruye, con las lineas del log del dueno (sin tocar audio ni pedir nada), los TRES
// escenarios reportados y los mide:
//   E1 CAJA congelada por bloques / duplicada / con perdida  -> sondas `live` (resultado/text) + tiempos
//   E2 CONVERSACION (filas) en bloques / duplicada / perdida -> sondas `row` + `dup` + `asrFinal`
//   E3 HABLANTE batido (Luis vs Hablante 1)                  -> `commit` (written) vs `identity` (name) + `clusters`
// Los tiempos son los REALES del log (cada linea trae su marca).
// ============================================================
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const TEMP = process.env.TEMP || process.env.TMP || '/tmp'

type Linea = { t: number; tipo: string; datos: Record<string, unknown> }

/** Lineas del log con su instante y su payload JSON (solo las sondas `VozProbe`). */
export function sondas(texto: string): Linea[] {
  const out: Linea[] = []
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^\[flu-client (\d\d):(\d\d):(\d\d\.\d+)\][^\n]*VozProbe (\w+) (\{.*\})\s*$/.exec(linea)
    if (!m) continue
    try {
      const datos = JSON.parse(m[5] || '{}') as Record<string, unknown>
      out.push({ t: (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000, tipo: m[4], datos })
    } catch { /* linea corrupta: se ignora */ }
  }
  return out
}

const palabras = (t: string) => t.trim().split(/\s+/).filter(Boolean)

/** 6-gramas repetidos de un texto (duplicacion medida). */
export function repetidos6(texto: string): number {
  const w = palabras(texto)
  const vistas = new Map<string, number>()
  for (let i = 0; i + 6 <= w.length; i += 1) {
    const clave = w.slice(i, i + 6).join(' ').toLowerCase()
    vistas.set(clave, (vistas.get(clave) || 0) + 1)
  }
  return [...vistas.values()].filter((n) => n > 1).length
}

type Caso = {
  log: string
  // E1 caja
  cajaFinal: number
  cajaAplicados: number
  cajaBloqueados: number
  cajaReemplazos: number
  cajaRepetidos: number
  cajaGapMaxMs: number
  cajaGolpeChars: number
  // E2 filas
  filas: number
  filasDuplicadas: number
  filasGapMaxMs: number
  filasFueraDeCaja: number
  dupDetector: number
  // E3 hablante
  etiquetas: string[]
  turnosEscritos: number
  batidoTurnos: number
  clusters: string[]
}

export function reinyectar(ruta: string): Caso {
  const ls = sondas(readFileSync(ruta, 'utf8'))
  const live = ls.filter((l) => l.tipo === 'live')
  const rows = ls.filter((l) => l.tipo === 'row')
  const commits = ls.filter((l) => l.tipo === 'commit')
  const identity = ls.filter((l) => l.tipo === 'identity')
  const clusters = ls.filter((l) => l.tipo === 'clusters')
  const dups = ls.filter((l) => l.tipo === 'dup')

  // --- E1 CAJA: la caja que el dueno VIO (los `text` de cada `aplicado`) ------------------------
  let caja = ''
  let turno = -1
  let previoEnTurno = ''
  let reemplazos = 0
  let aplicados = 0
  let bloqueados = 0
  let ultimoAplicadoEn = 0
  let gapMaxMs = 0
  let golpeChars = 0
  for (const l of live) {
    const t = Number(l.datos.turn ?? 0)
    if (t !== turno) { turno = t; previoEnTurno = '' }
    if (String(l.datos.resultado) === 'aplicado') {
      const texto = String(l.datos.text ?? '')
      if (previoEnTurno && !texto.includes(previoEnTurno)) reemplazos += 1
      const delta = Math.abs(texto.length - previoEnTurno.length)
      if (ultimoAplicadoEn) {
        const gap = l.t - ultimoAplicadoEn
        if (gap > gapMaxMs) { gapMaxMs = gap; golpeChars = delta }
      }
      ultimoAplicadoEn = l.t
      previoEnTurno = texto
      caja = texto
      aplicados += 1
    } else bloqueados += 1
  }

  // --- E2 FILAS: lo que la conversacion recibio (los `row`) -------------------------------------
  let filasDuplicadas = 0
  let filasGapMaxMs = 0
  let previa = ''
  let anteriorEn = 0
  const textos: string[] = []
  for (const l of rows) {
    const texto = String(l.datos.text ?? '')
    if (previa && (texto.includes(previa) || previa.includes(texto))) filasDuplicadas += 1
    if (anteriorEn) filasGapMaxMs = Math.max(filasGapMaxMs, l.t - anteriorEn)
    anteriorEn = l.t
    previa = texto
    textos.push(texto)
  }
  const filasFueraDeCaja = textos.filter((t) => !caja.includes(t)).length

  // --- E3 HABLANTE: la etiqueta ESCRITA contra la RESUELTA por la identidad ---------------------
  const escritoPorTurno = new Map<number, string>()
  for (const l of commits) escritoPorTurno.set(Number(l.datos.turn ?? 0), String(l.datos.written ?? ''))
  const resueltoPorTurno = new Map<number, string>()
  for (const l of identity) resueltoPorTurno.set(Number(l.datos.turn ?? 0), String(l.datos.name ?? ''))
  let batidoTurnos = 0
  for (const [turnoId, escrito] of escritoPorTurno) {
    const resuelto = resueltoPorTurno.get(turnoId)
    if (!resuelto) continue
    if (escrito.toLowerCase() !== resuelto.toLowerCase()) batidoTurnos += 1
  }
  const etiquetas = rows.map((l) => String(l.datos.efectivo || l.datos.speaker || '')).filter(Boolean)
  const clustersVistos = [...new Set(clusters.flatMap((l) => (Array.isArray(l.datos.labels) ? l.datos.labels.map(String) : [])))]

  return {
    log: ruta.split(/[\\/]/).pop() || ruta,
    cajaFinal: caja.length,
    cajaAplicados: aplicados,
    cajaBloqueados: bloqueados,
    cajaReemplazos: reemplazos,
    cajaRepetidos: repetidos6(live.filter((l) => String(l.datos.resultado) === 'aplicado').map((l) => String(l.datos.text ?? '')).join(' ')),
    cajaGapMaxMs: gapMaxMs,
    cajaGolpeChars: golpeChars,
    filas: rows.length,
    filasDuplicadas,
    filasGapMaxMs,
    filasFueraDeCaja,
    dupDetector: dups.filter((l) => l.datos.dup === true).length,
    etiquetas: [...new Set(etiquetas)],
    turnosEscritos: escritoPorTurno.size,
    batidoTurnos,
    clusters: clustersVistos,
  }
}

const LOGS = readdirSync(TEMP).filter((f) => f.startsWith('flu-debug-owner-') && f.endsWith('.log')).sort()
  .map((f) => join(TEMP, f))
  .filter((p) => { try { return readFileSync(p, 'utf8').includes('VozProbe ') } catch { return false } })
  .filter((p) => !process.env.FLU_REPLAY_SOLO || p.includes(process.env.FLU_REPLAY_SOLO))

describe('REINYECCION del log: escenarios reportados (caja, conversacion, hablante)', () => {
  it.runIf(LOGS.length > 0)('mide los tres escenarios por corrida', () => {
    for (const ruta of LOGS) {
      const c = reinyectar(ruta)
      console.log(
        `[escenario] ${c.log} | CAJA: final=${c.cajaFinal} chars aplicados=${c.cajaAplicados} bloqueados=${c.cajaBloqueados}` +
        ` reemplazos=${c.cajaReemplazos} repetidos6=${c.cajaRepetidos} congeladoMax=${(c.cajaGapMaxMs / 1000).toFixed(1)}s (de golpe ${c.cajaGolpeChars} chars)` +
        ` | FILAS: ${c.filas} duplicadas=${c.filasDuplicadas} gapMax=${(c.filasGapMaxMs / 1000).toFixed(1)}s fueraDeCaja=${c.filasFueraDeCaja} dupDetector=${c.dupDetector}` +
        ` | HABLANTE: etiquetas=[${c.etiquetas.join(', ')}] turnos=${c.turnosEscritos} batido=${c.batidoTurnos} clusters=[${c.clusters.join(', ')}]`,
      )
    }
    expect(LOGS.length).toBeGreaterThan(0)
  })
})
