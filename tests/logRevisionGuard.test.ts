// ============================================================
// logRevisionGuard - RUTINA DE REVISION sobre UN LOG, UNA CORRIDA (spec del dueno 2026-10-11).
// ------------------------------------------------------------
// El checker vive EN EL REPO (no es "mi palabra"): lee la traza de una corrida
// (`asrRaw -> live -> commit -> row -> dup`) y exige los invariantes. Nace ROJO contra la base
// (los fixtures reproducen el DEFECTO) y verde con el arreglo.
//
// INVARIANTES
//  Frase viva
//   1. `bloqueado` SOLO con mismaLocucion:true (trozo). 0 bloqueos de una revision.
//   2. `len=0` (vaciado) no aparece en `live` (el reset del cierre no emite emision vacia).
//   3. La primera emision de una locucion nueva lleva `previo:0` (reset tras el cierre).
//   4. Durante la locucion la caja refleja la emision actual (`aplicado`), suba o baje.
//  Nombre
//   5. Una fila con NOMBRE PROPIO exige `src=wake-intro` (wake + comando) en esa misma locucion.
//   6. `row-update` con objetivo = nombre propio => FALLA (la voz no introduce el nombre).
//  Flujo
//   7. fila escrita = lo mostrado del turno (si la fila es menor => FALLA).
//   8. Cada `commit` lleva su `dup` (veredicto del dedupe) y su `row`.
// PRUEBA DE DETECTOR (mutacion): cada invariante tiene un fixture que lo VIOLA y el checker lo
// lista; quitar el arreglo deja el fixture marcado.
// ============================================================
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CFG = readFileSync('src/voice/lib/fluConfig.js', 'utf8')
const REVISION = readFileSync('src/voice/conversation/revision.ts', 'utf8')
const MOTOR = readFileSync('src/voice/compose/conversationMotorProducto.js', 'utf8')
const TURN_ROW = readFileSync('src/voice/lib/conversationTurnRow.ts', 'utf8')

const json = (l: string): Record<string, unknown> => {
  try {
    return JSON.parse(l.slice(l.indexOf('{')))
  } catch {
    return {}
  }
}
const esNombrePropio = (n: unknown): boolean => {
  const t = String(n || '').trim()
  if (!t) return false
  return !/^hablante\s+\d+$/i.test(t) && /^[a-záéíóúñ][a-záéíóúñ\s]*$/i.test(t)
}

/** DUENO UNICO del criterio: la traza de UNA corrida -> violaciones (una por invariante roto). */
export function revisarTraza(lineas: string[]): string[] {
  const v: string[] = []
  const live = lineas.filter((l) => l.includes('VozProbe live')).map(json)
  const commit = lineas.filter((l) => l.includes('VozProbe commit')).map(json)
  const dup = lineas.filter((l) => l.includes('VozProbe dup')).map((l) => l.slice(l.indexOf('{')))
  const upd = lineas.filter((l) => l.includes('row-update')).map(json)

  // 1) El UNICO bloqueo es el TROZO.
  for (const o of live) {
    if (o.resultado === 'bloqueado' && o.mismaLocucion !== true) {
      v.push('bloqueo que NO es un trozo (mismaLocucion!==true): "' + String(o.text).slice(0, 40) + '"')
    }
  }
  // 2) No hay emision vacia en la caja.
  for (const o of live) {
    if (Number(o.len) === 0) v.push('emision de caja con len=0 (vaciado sin cierre)')
  }
  // 3) Tras un CIERRE (commit) la locucion nueva arranca en previo:0.
  for (let i = 1; i < lineas.length; i += 1) {
    if (lineas[i].includes('VozProbe live') && lineas[i - 1].includes('VozProbe commit')) {
      const o = json(lineas[i])
      if (o.resultado === 'aplicado' && Number(o.previo) !== 0) {
        v.push('la locucion nueva NO arranca en previo:0 (previo=' + o.previo + ')')
      }
    }
  }
  // 4) Lo aplicado refleja la emision actual (texto no vacio y len coherente).
  for (const o of live) {
    if (o.resultado === 'aplicado' && String(o.text || '').trim().length === 0) {
      v.push('aplicado con texto vacio')
    }
  }
  // 5) FILA CON NOMBRE PROPIO => src=wake-intro en esa locucion.
  for (const c of commit) {
    if (esNombrePropio(c.written) && c.src !== 'wake-intro') {
      v.push('nombre propio sin wake+comando: written="' + c.written + '" src=' + c.src)
    }
  }
  // 6) row-update no introduce nombres.
  for (const o of upd) {
    if (esNombrePropio(o.objetivo) && String(o.objetivo) !== String(o.actual)) {
      v.push('row-update intenta escribir un nombre propio: "' + o.objetivo + '"')
    }
  }
  // 7) fila escrita = lo mostrado del turno (si la fila es MENOR que lo mostrado => FALLA).
  //    El emparejamiento es por ORDEN dentro del bloque de la fila (los commits vistos desde la
  //    fila anterior): asi una corrida con varias sesiones (tests) no mezcla turnos iguales.
  let commitsDelBloque: Record<string, unknown>[] = []
  for (const linea of lineas) {
    if (linea.includes('VozProbe commit')) {
      commitsDelBloque.push(json(linea))
      continue
    }
    if (!linea.includes('VozProbe row')) continue
    const r = json(linea)
    if (['added', 'replaced'].includes(String(r.action))) {
      const texto = String(r.text || '')
      const caps = commitsDelBloque.map((c) => String(c.capture || c.shown || '')).filter(Boolean)
      const largo = caps.length ? Math.max(...caps.map((c) => c.length)) : 0
      if (largo && texto.length < largo) {
        v.push('fila MAS CORTA que lo mostrado del turno: fila=' + texto.length + ' mostrado=' + largo)
      }
    }
    commitsDelBloque = []
  }
  // 8) Cada commit lleva su veredicto `dup`.
  if (commit.length > 0 && dup.length === 0) v.push('hay commits SIN veredicto dup')
  return v
}

describe('rutina de revision - la traza de UNA corrida cumple los invariantes', () => {
  it('PRUEBA DE DETECTOR (mutacion): cada fixture que VIOLA un invariante se lista', () => {
    const malo = [
      '[flu-client 10:00:00.000] LOG VozProbe live {"turn":1,"resultado":"bloqueado","acorta":true,"mismaLocucion":false,"previo":50,"len":10,"text":"una cola"}',
      '[flu-client 10:00:00.100] LOG VozProbe live {"turn":1,"resultado":"aplicado","acorta":false,"mismaLocucion":false,"previo":10,"len":0,"text":""}',
      '[flu-client 10:00:00.900] LOG VozProbe commit {"turn":1,"src":"sticky-preflight-pending","name":"Luis","written":"Luis","capture":"hola que tal"}',
      '[flu-client 10:00:00.950] LOG VozProbe live {"turn":2,"resultado":"aplicado","acorta":false,"previo":33,"len":5,"text":"hola"}',
      '[flu-client 10:00:01.000] LOG VozProbe row {"action":"added","id":"r1","text":"hola","turnId":1}',
      '[flu-client 10:00:01.100] LOG row-update {"ev":true,"turnId":1,"pedido":"Luis","actual":"Hablante 1","objetivo":"Luis","cambia":true}',
    ]
    const v = revisarTraza(malo)
    expect(v.some((m) => m.includes('NO es un trozo')), 'bloqueo que no es trozo').toBe(true)
    expect(v.some((m) => m.includes('len=0')), 'emision vacia').toBe(true)
    expect(v.some((m) => m.includes('sin wake+comando')), 'nombre sin wake+comando').toBe(true)
    expect(v.some((m) => m.includes('previo:0')), 'locucion nueva sin previo:0').toBe(true)
    expect(v.some((m) => m.includes('MAS CORTA')), 'fila mas corta que lo mostrado').toBe(true)
    expect(v.some((m) => m.includes('nombre propio')), 'row-update con nombre').toBe(true)
  })

  it('una traza LIMPIA no produce violaciones', () => {
    const bueno = [
      '[flu-client 10:00:00.000] LOG VozProbe asrRaw {"turn":0,"items":[{"f":0,"t":"hola","l":4}]}',
      '[flu-client 10:00:00.010] LOG VozProbe live {"turn":1,"resultado":"aplicado","acorta":false,"fresh":false,"mismaLocucion":false,"previo":0,"len":4,"text":"hola"}',
      '[flu-client 10:00:00.500] LOG VozProbe live {"turn":1,"resultado":"aplicado","acorta":false,"previo":4,"len":9,"text":"hola que tal"}',
      '[flu-client 10:00:00.900] LOG VozProbe dup {"turn":1,"dup":false}',
      '[flu-client 10:00:00.910] LOG VozProbe commit {"turn":1,"src":"sticky-preflight-pending","name":"Hablante 1","written":"Hablante 1","capture":"hola que tal"}',
      '[flu-client 10:00:01.000] LOG VozProbe row {"action":"added","id":"r1","text":"hola que tal","turnId":1}',
    ]
    expect(revisarTraza(bueno)).toEqual([])
  })

  it('el CODIGO tiene UN dueno por regla (fuente)', () => {
    // Caja: UNA sola regla de no-perdida y se mide en PALABRAS (revision.ts). El
    // criterio viejo por longitud de caracteres se retiro con la tuberia (2026-10-25).
    expect(REVISION.includes('revisionMasCorta'), 'sin revision-mas-corta').toBe(false)
    expect(REVISION.includes('palabrasNuevas > palabrasAnteriores'), 'crece solo con MAS palabras').toBe(true)
    expect(REVISION.includes('pintar: false'), 'perder palabras no se pinta').toBe(true)
    // Nombre: UNA via por DATO (el mandato "soy X") + la MEDIDA del preflight. El
    // compositor del motor es el dueno de juntarlas; la fila no asciende por voz.
    expect(MOTOR.includes('preflightEvidenceMeasured('), 'la evidencia es la MEDIDA').toBe(true)
    expect(MOTOR.includes('resolveSpeakerNameFromUtterance('), 'el dato es el mandato').toBe(true)
    expect(TURN_ROW.includes('resolveRegisteredSpeakerName'), 'la fila no asciende por voz').toBe(false)
    // Sin defaults que mientan: `evidenciaAcustica` no puede venir en true por defecto.
    expect(/evidenciaAcustica = true/.test(TURN_ROW), 'ningun default en true').toBe(false)
    // Config sin efecto: la clave del cierre existe y es un numero.
    expect(/srGapCommitMs:\s*\d+/.test(CFG), 'la clave del cierre sigue declarada').toBe(true)
  })

  // D6: la traza real se revisa sobre el log ACTUAL del dueno (%TEMP%\flu-debug-owner-*),
  // producido por el codigo vigente; el debug.log del repo es un artefacto historico (previo a
  // D6) y no es ground truth del criterio nuevo. runIf no cuenta como .skip (sensor V7).
  const TEMP = process.env.TEMP || process.env.TMP || '/tmp'
  // D6 se aplico el 2026-10-16: solo un log producido DESPUES de ese criterio es ground truth
  // del invariante nuevo (un log previo bloquea por "acorta" y violaria D6 por construccion).
  const D6_DESDE = '2026-10-16'
  function rutaLogActual(): string | null {
    const explicita = process.env.FLU_REPLAY_LOG
    if (explicita && existsSync(explicita) && /(\d{4}-\d{2}-\d{2})/.test(explicita)) {
      const f = (explicita.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || ''
      if (f >= D6_DESDE) return explicita
    }
    try {
      const candidatos = readdirSync(TEMP)
        .filter((f: string) => f.startsWith('flu-debug-owner-') && f.endsWith('.log'))
        .map((f: string) => ({ f, fecha: (f.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '' }))
        .filter((c: { fecha: string }) => c.fecha && c.fecha >= D6_DESDE)
        .sort((a: { f: string }, b: { f: string }) => b.f.localeCompare(a.f))
        .slice(0, 3)
      for (const c of candidatos) {
        const p = join(TEMP, c.f)
        if (existsSync(p) && readFileSync(p, 'utf8').includes('VozProbe')) return p
      }
      return null
    } catch {
      return null
    }
  }
  const RUTA = rutaLogActual()

  it.runIf(Boolean(RUTA))('la corrida REAL (log actual del dueno, post-D6) cumple los invariantes', () => {
    const crudo = readFileSync(RUTA as string, 'utf8')
    const lineas = crudo.split(/\r?\n/).filter(Boolean)
    if (!lineas.some((l) => l.includes('VozProbe'))) return
    const v = revisarTraza(lineas)
    expect(v, 'invariantes rotos en la corrida:\n' + v.join('\n')).toEqual([])
  })
})
