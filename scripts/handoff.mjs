#!/usr/bin/env node
/**
 * HANDOFF · reinicio de sesion sin perder el estado de la auditoria.
 *
 * QUE HACE
 *   1. Refresca el bloque `AUTO:ESTADO` de `docs/HANDOFF-voz-caja.md` con el estado REAL
 *      del arbol (rama, HEAD, modificados, sin trackear, diff --stat).
 *   2. Imprime el recetario de reinicio (reanudar la sesion o abrir una nueva) y el prompt
 *      de arranque que hereda TODO el diagnostico desde el fichero, no desde el chat.
 *
 * POR QUE
 *   El conocimiento de una sesion vive en el chat y muere con ella (las sesiones de goose
 *   estan aisladas; la compactacion solo resume DENTRO de la misma sesion). El estado
 *   durable es el fichero: cualquier sesion nueva lo lee al arrancar.
 *
 * USO
 *   node scripts/handoff.mjs
 *   node scripts/handoff.mjs --check   (no escribe; solo dice si el bloque esta al dia)
 *
 * SALIDA: 0 si el fichero quedo escrito (o al dia con --check), 1 si falta el fichero.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const DOC = join(ROOT, 'docs', 'HANDOFF-voz-caja.md')
const OPEN = '<!-- AUTO:ESTADO -->'
const CLOSE = '<!-- /AUTO:ESTADO -->'
const checkOnly = process.argv.includes('--check')

/**
 * Ejecuta git y devuelve stdout (string vacio si git falla: el script informa, no revienta).
 * @param {string[]} args
 * @returns {string}
 */
function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

/**
 * Bloque de estado legible: rama, HEAD, cambios y conteo por clase.
 * @returns {string}
 */
function estadoDelArbol() {
  const rama = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim() || '(sin rama)'
  const head = git(['log', '-1', '--oneline']).trim() || '(sin commits)'
  const status = git(['status', '--short']).split(/\r?\n/).filter(Boolean)
  const modificados = status.filter((linea) => !linea.startsWith('??'))
  const sinTrackear = status.filter((linea) => linea.startsWith('??'))
  const diffstat = git(['-c', 'core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol', 'diff', '--stat'])
    .split(/\r?\n/)
    .filter(Boolean)
  const resumen = diffstat.length ? diffstat.at(-1).trim() : 'sin cambios en ficheros rastreados'
  const ahora = new Date().toISOString().replace('T', ' ').slice(0, 19)

  const listado = (titulo, filas, tope = 40) => {
    if (!filas.length) return `- ${titulo}: 0`
    const mostradas = filas.slice(0, tope).map((fila) => `  - \`${fila}\``)
    const resto = filas.length > tope ? [`  - … y ${filas.length - tope} mas`] : []
    return [`- ${titulo}: ${filas.length}`, ...mostradas, ...resto].join('\n')
  }

  return [
    `generado: ${ahora}`,
    '',
    `- rama: \`${rama}\``,
    `- HEAD: \`${head}\``,
    `- ${resumen}`,
    listado('modificados', modificados),
    listado('sin trackear', sinTrackear),
    '',
    '> El estado de arriba es el arbol REAL en el momento de generar. Si el dueño no ha',
    '> commiteado, una sesion nueva NO hereda estos cambios: los hereda del disco, no de git.',
  ].join('\n')
}

/**
 * Sustituye el contenido entre marcas. Devuelve el texto nuevo; no escribe.
 * @param {string} texto
 * @param {string} cuerpo
 * @returns {string}
 */
function conEstado(texto, cuerpo) {
  const inicio = texto.indexOf(OPEN)
  const fin = texto.indexOf(CLOSE)
  if (inicio < 0 || fin < 0 || fin < inicio) throw new Error(`marcas ${OPEN} / ${CLOSE} no encontradas`)
  return `${texto.slice(0, inicio + OPEN.length)}\n${cuerpo}\n${texto.slice(fin)}`
}

if (!existsSync(DOC)) {
  console.error(`handoff: falta ${DOC}. El estado de la auditoria vive en ese fichero; sin el no hay nada que heredar.`)
  process.exit(1)
}

const original = readFileSync(DOC, 'utf8')
const actualizado = conEstado(original, estadoDelArbol())

/**
 * Compara ignorando la marca de tiempo: dos corridas seguidas del script no deben
 * declararse "desactualizadas" solo porque cambio `generado:`.
 * @param {string} texto
 * @returns {string}
 */
function sinSello(texto) {
  return texto.replace(/^generado: .*$/m, 'generado: -')
}

if (checkOnly) {
  const alDia = sinSello(actualizado) === sinSello(original)
  console.log(alDia ? 'handoff: AUTO:ESTADO al dia' : 'handoff: AUTO:ESTADO DESACTUALIZADO (ejecuta sin --check)')
  process.exit(0)
}

writeFileSync(DOC, actualizado, 'utf8')

console.log(`
handoff: estado escrito en docs/HANDOFF-voz-caja.md

------------------------------------------------------------
REINICIAR SIN PERDER EL TRABAJO
------------------------------------------------------------
1) Reanudar ESTA sesion (conserva todo el chat, nada que preparar)
     goose session -r
     goose session -r --name <nombre-de-la-sesion>

2) Empezar una sesion NUEVA (recomendado si esta va lenta)
     Ctrl+N   (Desktop: nueva sesion en el directorio actual)

3) Respaldo del historial completo, por si acaso
     goose session export

------------------------------------------------------------
PROMPT PARA LA SESION NUEVA (copiar tal cual)
------------------------------------------------------------
Lee @docs/HANDOFF-voz-caja.md y AGENTS.md.

No ejecutes nada todavia. Confirma en 5 lineas:
  - que esta ACEPTADO del arbol actual,
  - que esta RECHAZADO y en que archivo:linea,
  - cual es el UNICO cambio de producto pendiente (P1),
  - que barreras faltan (P2, P3),
  - que NO se puede tocar.

Despues espera mi orden.

------------------------------------------------------------
`)
