#!/usr/bin/env node
/**
 * Guardian — Puerta 1 para hosts SIN hooks (Cline y cualquier host sin API de
 * hooks). Los hosts con hooks pasan por el prehook ANTES de escribir; los que
 * no, escriben y el guardian los alcanza JUSTO DESPUÉS. Vigila `src/` y ante
 * cada archivo de código NUEVO corre las dos puertas sobre el disco:
 *
 *   owner-gate --pretende-nuevo  → ¿dueño declarado en docs/OWNERS.md?
 *   revisor-prehook --desde-vacio → ¿alguna función nueva clona una existente?
 *
 * Si una puerta bloquea (exit 2), BORRA el archivo al instante y pega el
 * informe del gate con el protocolo para reintentar. Si el gate FALLA sin
 * veredicto (crash, timeout), no borra nada: avisa y pide verificación
 * manual — borrar el trabajo del host por un fallo propio sería peor. El
 * reintento del host vuelve a pasar por las dos puertas.
 *
 * El guardian no sustituye el protocolo manual de `.clinerules`: es la red
 * que lo hace REAL cuando el host no tiene puerta propia.
 *
 * Uso:
 *   node scripts/guardian.mjs                   # vigilar src/ (hasta Ctrl+C)
 *   node scripts/guardian.mjs --una-vez <rel>  # verificar un archivo ya escrito
 *   npm run guardiano -- --una-vez src/x.ts
 *
 * Salida de `--una-vez`: 0 permite, 2 bloquea (y borró el archivo), 1 uso.
 */
import { existsSync, readFileSync, readdirSync, unlinkSync, watch } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT =
  process.env.CLAUDE_PROJECT_DIR ||
  resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Los hosts corren sobre Bun: node del PATH (o FLU_NODE), nunca execPath.
const NODE = process.env.FLU_NODE || 'node'
const SRC_DIR = 'src'
const CODE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i
// El evento de creación llega con el archivo a medio escribir: se espera.
const ESPERA = 600
const LIMITE_GATE = 30000

const OWNER_GATE = resolve(ROOT, 'scripts', 'owner-gate.mjs')
const REVISOR = resolve(ROOT, 'scripts', 'revisor-prehook.mjs')

/** Ruta relativa al repo, con `/`. */
function relKey(abs) {
  return relative(ROOT, abs).split(sep).join('/')
}

/**
 * Corre una puerta por subproceso. `status === null` = el proceso no llegó a
 * salir (crash o timeout); `error` trae el detalle. Con `raiz` la puerta corre
 * con `CLAUDE_PROJECT_DIR` apuntando ahí (las pruebas usan un repo temporal:
 * un probe bajo el `src/` real chocaría con los guards que lo caminan).
 * @param {string} script Puerta a ejecutar.
 * @param {string[]} args Argumentos de la puerta.
 * @param {string} stdin Entrada estándar (el payload del hook).
 * @param {string} [raiz] Raíz del proyecto para la puerta.
 * @returns {{status: number|null, stdout: string, stderr: string, error?: Error}}
 */
function correrPuerta(script, args, stdin = '', raiz = undefined) {
  const resultado = spawnSync(NODE, [script, ...args], {
    cwd: ROOT,
    input: stdin,
    encoding: 'utf8',
    timeout: LIMITE_GATE,
    windowsHide: true,
    env: raiz ? { ...process.env, CLAUDE_PROJECT_DIR: resolve(raiz) } : process.env,
  })
  return {
    status: resultado.status,
    stdout: String(resultado.stdout ?? ''),
    stderr: String(resultado.stderr ?? ''),
    error: resultado.error,
  }
}

/** Bloqueo de una puerta: borra el archivo y devuelve el informe. */
function bloquear(rel, absoluta, resultado) {
  let borrado = true
  try {
    unlinkSync(absoluta)
  } catch {
    // El host aún lo tiene abierto; se dice y se pide borrarlo a mano.
    borrado = false
  }
  const reporte = [
    `[guardian] BLOQUEADO${borrado ? ' y BORRADO' : ''}: ${rel}`,
    ...resultado.stderr.split(/\r?\n/),
    '',
    borrado
      ? 'El guardian ya borró el archivo. Para reintentar:'
      : 'No pude borrar el archivo (lo tiene abierto el host); bórralo a mano. Para reintentar:',
    '1. Declara el dueño en docs/OWNERS.md o el veredicto @revisor en el JSDoc.',
    '2. Vuelve a escribir el archivo (pasará de nuevo por las dos puertas).',
  ].join('\n')
  return { rel, permitido: false, borrado, fallo: false, reporte }
}

/** La puerta falló sin veredicto: no se borra nada, se exige verificación. */
function falloDeGate(rel, nombre, resultado) {
  const detalle = resultado.error?.message ?? resultado.stderr ?? ''
  return {
    rel,
    permitido: false,
    borrado: false,
    fallo: true,
    reporte: [
      `[guardian] ${nombre} FALLÓ sin veredicto para ${rel}; no borro nada, verifícalo a mano:`,
      detalle,
      `  node scripts/owner-gate.mjs --path ${rel} --pretende-nuevo`,
      `  node scripts/revisor-prehook.mjs --desde-vacio < <payload Write>`,
    ].join('\n'),
  }
}

/**
 * Verifica un archivo de código NUEVO ya escrito, con las MISMAS dos puertas
 * del prehook: dueño declarado y funciones clonadas. Si una bloquea, borra el
 * archivo (la escritura no debió existir) y devuelve el informe.
 * @param {string} rel Ruta relativa al repo, con `/`.
 * @param {{soloRevisor?: boolean, raiz?: string}} [opciones]
 *   `soloRevisor` salta owner-gate (pruebas del revisor); `raiz` evalúa contra
 *   un repo temporal (pruebas: un probe bajo el `src/` real chocaría con los
 *   guards que lo caminan en paralelo).
 * @returns {{rel: string, permitido: boolean, borrado: boolean, fallo: boolean, reporte: string}}
 */
export function verificarArchivoNuevo(rel, opciones = {}) {
  const raiz = opciones.raiz ? resolve(opciones.raiz) : ROOT
  const absoluta = resolve(raiz, rel)
  if (!existsSync(absoluta)) {
    return {
      rel,
      permitido: true,
      borrado: false,
      fallo: false,
      reporte: `[guardian] ${rel} ya no existe; nada que verificar.`,
    }
  }
  const content = readFileSync(absoluta, 'utf8')

  if (!opciones.soloRevisor) {
    const dueno = correrPuerta(OWNER_GATE, ['--path', rel, '--pretende-nuevo'], '', raiz)
    if (dueno.error || dueno.status !== 0) {
      return dueno.status === 2
        ? bloquear(rel, absoluta, dueno)
        : falloDeGate(rel, 'owner-gate', dueno)
    }
  }

  const payload = JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: rel, content },
  })
  const clon = correrPuerta(REVISOR, ['--desde-vacio'], payload, raiz)
  if (clon.error || clon.status !== 0) {
    return clon.status === 2
      ? bloquear(rel, absoluta, clon)
      : falloDeGate(rel, 'revisor-prehook', clon)
  }

  return {
    rel,
    permitido: true,
    borrado: false,
    fallo: false,
    reporte: `[guardian] OK: ${rel} pasó las dos puertas.`,
  }
}

/** Todos los directorios bajo `dir`, incluido él. */
function directoriosBajo(dir) {
  const salida = [dir]
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (entrada.isDirectory()) salida.push(...directoriosBajo(join(dir, entrada.name)))
  }
  return salida
}

/**
 * Vigila src/: ante cada archivo de código NUEVO espera a que el host termine
 * de escribirlo y corre las dos puertas. Portable: fs.watch por directorio
 * (el modo recursive no existe en Linux) y los directorios nuevos se
 * incorporan al vuelo; un archivo bloqueado y borrado sale del censo para que
 * el reintento del host vuelva a pasar por las puertas.
 */
export function vigilar() {
  const conocidos = new Set()
  const pendientes = new Map()

  const programar = (absoluta) => {
    if (pendientes.has(absoluta)) return
    pendientes.set(
      absoluta,
      setTimeout(() => {
        pendientes.delete(absoluta)
        const resultado = verificarArchivoNuevo(relKey(absoluta))
        process.stdout.write(`${resultado.reporte}\n`)
        if (!resultado.permitido && resultado.borrado) conocidos.delete(absoluta)
      }, ESPERA),
    )
  }

  const verEvento = (dir, nombre) => {
    if (!nombre || !CODE_EXT.test(nombre)) return
    const absoluta = join(dir, nombre)
    if (!existsSync(absoluta)) return
    if (conocidos.has(absoluta)) return
    conocidos.add(absoluta)
    programar(absoluta)
  }

  const vigilarDirectorio = (dir) => {
    watch(dir, (evento, nombre) => {
      if (!nombre) return
      const completo = join(dir, nombre)
      // Directorio nuevo: sus archivos YA escritos también son nuevos; se
      // verifican, y el directorio queda vigilado para los que vengan.
      if (evento === 'rename' && !CODE_EXT.test(nombre) && existsSync(completo)) {
        try {
          for (const sub of directoriosBajo(completo)) {
            for (const entrada of readdirSync(sub, { withFileTypes: true })) {
              if (entrada.isFile() && CODE_EXT.test(entrada.name)) {
                const absoluta = join(sub, entrada.name)
                conocidos.add(absoluta)
                programar(absoluta)
              }
            }
            watch(sub, (ev, n) => verEvento(sub, n))
          }
        } catch {
          // El host sigue creando el directorio; el próximo evento lo reintenta.
        }
        return
      }
      verEvento(dir, nombre)
    })
  }

  for (const dir of directoriosBajo(resolve(ROOT, SRC_DIR))) {
    // Censo de inicio: lo que ya existía no es nuevo y no se verifica.
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      if (entrada.isFile() && CODE_EXT.test(entrada.name)) conocidos.add(join(dir, entrada.name))
    }
    vigilarDirectorio(dir)
  }
  process.stdout.write(
    '[guardian] vigilando src/: cada archivo de código NUEVO pasa por owner-gate y revisor; si bloquea, lo BORRO. Ctrl+C para salir.\n',
  )
}

const directo = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (directo) {
  const indice = process.argv.indexOf('--una-vez')
  if (indice !== -1) {
    const rel = process.argv[indice + 1]
    if (!rel) {
      process.stderr.write('Uso: node scripts/guardian.mjs --una-vez <ruta-relativa>\n')
      process.exit(1)
    }
    const resultado = verificarArchivoNuevo(relKey(resolve(ROOT, rel)))
    process.stdout.write(`${resultado.reporte}\n`)
    process.exit(resultado.permitido ? 0 : 2)
  }
  // Sin process.exit: los watchers mantienen el proceso vivo hasta Ctrl+C.
  vigilar()
}
