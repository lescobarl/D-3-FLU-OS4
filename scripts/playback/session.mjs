/**
 * FLU Playback - cargador de sesion y argumentos.
 *
 * No es producto: es la base de la herramienta de soporte. Lee una carpeta
 * producida por `sessionRecorder`/`recorderSink` y valida lo minimo para
 * reproducir el audio como microfono virtual.
 */
import { readNdjson as readNdjsonStrict, readSessionManifest } from '../replay/loadSession.mjs';
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

export const DEFAULT_PORT = 5173
export const DEFAULT_URL = `http://localhost:${DEFAULT_PORT}`
export const DEFAULT_TAIL_MS = 5000
export const DEFAULT_TIMEOUT_MS = 600000

/**
 * Lector NDJSON de playback: DELEGA en el del replay (dueno unico del parseo).
 * Contrato propio: archivo ausente o vacio => [] (el replay devuelve null).
 * @param {string} file
 * @returns {any[]}
 */
export function readNdjson(file) {
  return readNdjsonStrict(file) ?? []
}

/**
 * Lee la cabecera de un WAV PCM simple (RIFF/WAVE) sin dependencias.
 * @param {string} file
 * @returns {{sampleRate:number, channels:number, bitsPerSample:number, dataBytes:number, seconds:number}}
 */
export function readWavInfo(file) {
  const buffer = readFileSync(file)
  if (buffer.length < 44) throw new Error(`WAV demasiado corto: ${file}`)
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`No es un WAV RIFF/WAVE: ${file}`)
  }
  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bitsPerSample = 0
  let dataBytes = 0
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ' && body + 16 <= buffer.length) {
      channels = buffer.readUInt16LE(body + 2)
      sampleRate = buffer.readUInt32LE(body + 4)
      bitsPerSample = buffer.readUInt16LE(body + 14)
    } else if (id === 'data') {
      dataBytes = Math.min(size, buffer.length - body)
      break
    }
    offset = body + size + (size % 2)
  }
  if (!sampleRate || !channels || !bitsPerSample || !dataBytes) {
    throw new Error(`WAV sin fmt/data validos: ${file}`)
  }
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8)
  return {
    sampleRate,
    channels,
    bitsPerSample,
    dataBytes,
    seconds: dataBytes / bytesPerSecond,
  }
}

/**
 * Lee la sesion y valida lo imprescindible.
 * @param {string} input
 * @returns {any}
 */
export function loadSession(input) {
  const dir = resolve(input)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`Sesion no encontrada: ${input}`)
  }
  // MANIFIESTO: dueno unico en el replay (auditoria 2026-10-23). Antes playback tenia su
  // propia copia del conjunto de versiones y de la validacion (ruta doble de la misma regla).
  const { manifest, schemaVersion, meta } = readSessionManifest(dir)
  const manifestPath = join(dir, 'manifest.json')
  const metaPath = join(dir, 'meta.json')

  const declaredAudio = manifest.audioFile ? resolve(dir, String(manifest.audioFile)) : join(dir, 'audio.wav')
  const pcmPath = join(dir, 'audio.pcm')
  const audioPath = existsSync(declaredAudio) ? declaredAudio : existsSync(pcmPath) ? pcmPath : ''
  if (!audioPath) throw new Error(`Falta audio.wav/audio.pcm en ${dir}`)
  const audio = audioPath.toLowerCase().endsWith('.wav')
    ? readWavInfo(audioPath)
    : {
        sampleRate: Number(manifest.sampleRate) || 0,
        channels: 1,
        bitsPerSample: 16,
        dataBytes: statSync(audioPath).size,
        seconds: Number(manifest.seconds) || 0,
      }
  if (!audio.sampleRate || !audio.seconds) throw new Error(`Audio sin sampleRate/duracion: ${audioPath}`)

  const turnsPath = join(dir, 'turns.ndjson')
  const eventsPath = join(dir, 'events.ndjson')
  const turns = readNdjson(turnsPath)
  const events = readNdjson(eventsPath)

  const sourceRows = turns
    .filter((turn) => turn?.kind === 'commit' && typeof turn.text === 'string')
    .map((turn) => ({
      text: String(turn.text),
      speaker: String(turn.speaker || turn.speakerName || ''),
      signature: Array.isArray(turn.signature) ? turn.signature : null,
      t: turn.t ?? turn.timestamp ?? null,
    }))

  // El base FINAL no se usa para sembrar. Solo un snapshot marcado al inicio.
  const baseStart = turns.find(
    (turn) =>
      turn?.kind === 'base-start' ||
      (turn?.kind === 'base' &&
        (turn.phase === 'start' || turn.initial === true || turn.reason === 'session-start')),
  )
  const baseStartParticipants = Array.isArray(baseStart?.participants) ? baseStart.participants : []

  return {
    dir,
    manifest,
    manifestPath,
    meta,
    metaPath,
    schemaVersion,
    sessionId: String(manifest.sessionId || basename(dir)),
    audioPath,
    audio,
    turnsPath,
    eventsPath,
    turns,
    events,
    sourceRows,
    baseStartParticipants,
    hasBaseStart: Boolean(baseStart),
    fidelity: {
      complete:
        Boolean(manifest.appCommit && manifest.configHash && manifest.appCommit !== 'unknown' && manifest.configHash !== 'unknown'),
      appCommit: manifest.appCommit || 'unknown',
      configHash: manifest.configHash || 'unknown',
      modelIds: Array.isArray(manifest.modelIds) ? manifest.modelIds : [],
      language: manifest.language || meta.language || '',
      sampleRate: audio.sampleRate,
    },
  }
}

export function parseArgs(argv) {
  const options = {
    session: '',
    leadIn: 0,
    tail: DEFAULT_TAIL_MS,
    url: DEFAULT_URL,
    headed: false,
    timeout: DEFAULT_TIMEOUT_MS,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = () => {
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) throw new Error(`Falta valor para ${arg}`)
      i += 1
      return next
    }
    switch (arg) {
      case '--session':
        options.session = value()
        break
      case '--lead-in':
        options.leadIn = Number(value())
        break
      case '--tail':
        options.tail = Number(value())
        break
      case '--url':
        options.url = value()
        break
      case '--headed':
        options.headed = true
        break
      case '--timeout':
        options.timeout = Number(value())
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        throw new Error(`Argumento desconocido: ${arg}`)
    }
  }
  if (options.help) return options
  if (!options.session) throw new Error('Falta --session <carpeta>')
  if (!Number.isFinite(options.leadIn) || options.leadIn < 0) throw new Error('--lead-in invalido')
  if (!Number.isFinite(options.tail) || options.tail < 0) throw new Error('--tail invalido')
  if (!Number.isFinite(options.timeout) || options.timeout < 1000) throw new Error('--timeout invalido')
  return options
}

export function usage() {
  return [
    'FLU Playback - reproduce una sesion grabada como microfono',
    '',
    'Uso:',
    '  npm run playback -- --session <carpeta> [opciones]',
    '',
    'Opciones:',
    '  --lead-in <ms>                    Espera extra tras LISTENING (default: 0)',
    '  --tail <ms>                       Margen tras el audio (default: 5000)',
    '  --url <url>                       App (default: http://localhost:5173)',
    '  --headed                          Navegador visible',
    '  --timeout <ms>                    Limite total (default: 600000)',
    '  --help                            Esta ayuda',
  ].join('\n')
}

