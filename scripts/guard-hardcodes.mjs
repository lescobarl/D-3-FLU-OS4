#!/usr/bin/env node
/**
 * Trinquete de hardcodes fuera de config (URLs/modelos).
 *
 * El detector es de `scripts/auditoria-codigo.mjs` (dueño unico). Aqui se
 * compara con el dictamen versionado: lo aceptado declara motivo; cualquier
 * hardcode nuevo rompe el commit. Un dictamen que ya no aparece tambien rompe
 * (la lista solo se recorta: si se arregla el codigo, se borra la entrada).
 *
 * Exit: 0 sin deriva, 1 deriva, 2 no se puede medir.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildReport } from './auditoria-codigo.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const DICTAMEN = join(ROOT, 'scripts', 'hardcode-dictamen.json')
const MIN_SOURCES = 400

process.chdir(ROOT)
const { aceptados } = JSON.parse(readFileSync(DICTAMEN, 'utf8'))
const report = buildReport('src')

if (report.files < MIN_SOURCES) {
  console.error(`[hardcodes] escaneo vacuo: ${report.files} archivos (< ${MIN_SOURCES}). Abortado.`)
  process.exit(2)
}

/** La linea del hallazgo cambia al editar; la clave es archivo + tipo + texto. */
const normalizar = (hallazgo) => hallazgo.replace(/^(.+?):\d+:/, '$1:')
const actuales = new Set(report.hardcodedOutsideConfig.map(normalizar))
const aceptadas = new Set(aceptados.map((a) => a.clave))

const nuevos = [...actuales].filter((h) => !aceptadas.has(h)).sort()
const viejos = [...aceptadas].filter((h) => !actuales.has(h)).sort()

if (nuevos.length > 0 || viejos.length > 0) {
  if (nuevos.length > 0) {
    console.error(`[hardcodes] ${nuevos.length} hardcode(s) NUEVO(s) fuera de config:`)
    for (const h of nuevos) console.error(`  - ${h}`)
  }
  if (viejos.length > 0) {
    console.error(
      `[hardcodes] ${viejos.length} entrada(s) del dictamen ya no aparecen: ` +
        'borralas de scripts/hardcode-dictamen.json en este mismo commit',
    )
    for (const h of viejos) console.error(`  - ${h}`)
  }
  console.error('Mueve el valor a config o justificalo con motivo. Anadir uno exige aprobacion del dueno (CODEOWNERS).')
  process.exit(1)
}

console.log(`[hardcodes] OK: ${actuales.size} aceptados con motivo, 0 sin dictaminar (${report.files} archivos).`)
