/**
 * LOADER UNICO de una sesion grabada (carpeta de `flu-recordings/<sessionId>`).
 *
 * Contrato de entrada (el `--mode` decide que se exige):
 *   manifest.json  OBLIGATORIO, con `schemaVersion` (sin ella no se reinyecta nada)
 *   meta.json      opcional (idioma, tasa, userAgent)
 *   events.ndjson  OBLIGATORIO en `events` y NO vacio (los eventos crudos del ASR y sus marcas)
 *   turns.ndjson   OBLIGATORIO tener >= 1 `commit` en `vectors`; NUNCA es el golden
 *   audio.*        NO se usa en esta fase
 *
 * Una sesion INCOMPLETA falla: si el manifiesto declara N eventos y el fichero no los
 * tiene, no se puede distinguir "no paso nada" de "se perdio el volcado".
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Version de esquema de `expected.json` (la del golden, no la del manifiesto). */
export const EXPECTED_SCHEMA_VERSION = 1
/** Versiones de manifiesto que este loader sabe leer (2 = actual; 1 = sin fidelidad). */
export const SUPPORTED_MANIFEST_VERSIONS = [1, 2]

/**
 * Error de ENTRADA (no de producto): el runner lo reporta como `status: "invalid"`.
 */
export class SessionError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'SessionError'
    this.code = code
    this.details = details
  }
}

function readJson(file, code) {
  if (!existsSync(file)) {
    throw new SessionError(code, `falta ${file}`, { file })
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new SessionError('invalid-json', `JSON invalido en ${file}: ${error.message}`, { file })
  }
}

export function readNdjson(file) {
  if (!existsSync(file)) return null
  const rows = []
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    if (!line.trim()) return
    try {
      rows.push(JSON.parse(line))
    } catch (error) {
      throw new SessionError('invalid-ndjson', `linea ${index + 1} invalida en ${file}: ${error.message}`, { file, line: index + 1 })
    }
  })
  return rows
}

/**
 * Lee y VALIDA el manifiesto de una sesion. DUENO UNICO de "que version es valida" y de
 * "que meta se lee": lo consumen el replay (`loadSession`) y el playback, que antes tenia
 * su propia copia del conjunto de versiones (auditoria 2026-10-23).
 * @param {string} sessionDir
 * @returns {{ manifest: object, schemaVersion: number, meta: object }}
 */
export function readSessionManifest(sessionDir) {
  const manifest = readJson(join(sessionDir, 'manifest.json'), 'missing-manifest')
  const version = Number(manifest?.schemaVersion)
  if (!Number.isFinite(version)) {
    throw new SessionError(
      'missing-schema-version',
      'manifest.json no declara `schemaVersion`: sin version no se sabe como reinyectar la sesion. ' +
        'Vuelve a grabar con el sink actual o marca el manifiesto con `--stamp-manifest`.',
      { dir: sessionDir },
    )
  }
  if (!SUPPORTED_MANIFEST_VERSIONS.includes(version)) {
    throw new SessionError(
      'unsupported-schema-version',
      `schemaVersion ${version} no soportada (soportadas: ${SUPPORTED_MANIFEST_VERSIONS.join(', ')})`,
      { version },
    )
  }
  const meta = existsSync(join(sessionDir, 'meta.json')) ? readJson(join(sessionDir, 'meta.json'), 'invalid-meta') : {}
  return { manifest, schemaVersion: version, meta }
}

/**
 * Carga y VALIDA una sesion.
 *
 * `mode` decide QUE se exige: `events` necesita `events.ndjson` no vacio; `vectors`
 * necesita `turns.ndjson` con al menos un `commit`.
 * @param {{ dir: string, mode?: 'events'|'vectors' }} options
 * @returns {{ dir: string, manifest: object, meta: object, events: object[], turns: object[] }}
 */
export function loadSession({ dir, mode = 'events' } = {}) {
  if (!dir) throw new SessionError('missing-session', 'falta --session <carpeta>')
  const sessionDir = resolve(String(dir))
  if (!existsSync(sessionDir)) {
    throw new SessionError('missing-session', `la carpeta de la sesion no existe: ${sessionDir}`, { dir: sessionDir })
  }

  const { manifest, meta } = readSessionManifest(sessionDir)
  const events = readNdjson(join(sessionDir, 'events.ndjson')) || []
  if (mode === 'events') {
    if (!existsSync(join(sessionDir, 'events.ndjson'))) {
      throw new SessionError('missing-events', `la sesion no tiene events.ndjson: ${sessionDir}`, { dir: sessionDir })
    }
    if (!events.length) {
      throw new SessionError('empty-events', `la sesion no tiene EVENTOS (events.ndjson vacio): ${sessionDir}`, { dir: sessionDir })
    }
    const declaredEvents = Number(manifest?.events)
    if (Number.isFinite(declaredEvents) && declaredEvents > 0 && declaredEvents !== events.length) {
      throw new SessionError(
        'incomplete-session',
        `sesion INCOMPLETA: el manifiesto declara ${declaredEvents} eventos y hay ${events.length}`,
        { declared: declaredEvents, actual: events.length },
      )
    }
  }

  const turns = readNdjson(join(sessionDir, 'turns.ndjson')) || []
  if (mode === 'vectors' && !turns.some((row) => String(row?.kind || '') === 'commit')) {
    throw new SessionError('missing-commits', `la sesion no tiene commits en turns.ndjson: ${sessionDir}`, { dir: sessionDir })
  }
  const declaredTurns = Number(manifest?.turns)
  if (Number.isFinite(declaredTurns) && declaredTurns > 0 && turns.length !== declaredTurns) {
    throw new SessionError(
      'incomplete-session',
      `sesion INCOMPLETA: el manifiesto declara ${declaredTurns} turnos y hay ${turns.length}`,
      { declared: declaredTurns, actual: turns.length },
    )
  }

  return { dir: sessionDir, manifest, meta, events, turns }
}

/**
 * Fidelidad del manifiesto: que se grabe con QUE app/config/modelos/idioma/tasa.
 * @param {object} manifest
 * @returns {{ appCommit: string, configHash: string, modelIds: string[], language: string, sampleRate: number }}
 */
export function manifestFidelity(manifest = {}) {
  const modelIds = Array.isArray(manifest?.modelIds) ? manifest.modelIds.filter((id) => typeof id === 'string') : []
  return {
    appCommit: String(manifest?.appCommit || 'unknown'),
    configHash: String(manifest?.configHash || 'unknown'),
    modelIds,
    language: String(manifest?.language || manifest?.meta?.language || ''),
    sampleRate: Number(manifest?.sampleRate) || 0,
  }
}
