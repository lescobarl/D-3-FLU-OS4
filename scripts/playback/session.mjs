/**
 * FLU Playback - cargador de sesion y argumentos.
 *
 * No es producto: es la base de la herramienta de soporte. Lee una carpeta
 * producida por `sessionRecorder`/`recorderSink` y valida lo minimo para
 * reproducir el audio como microfono virtual.
 */
import { readNdjson as readNdjsonStrict, readSessionManifest } from '../replay/loadSession.mjs';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

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
 * Devuelve `fmt` y `data` de un WAV PCM, para poder reescribirlo.
 * @param {string} file
 */
function wavChunks(file) {
  const buffer = readFileSync(file)
  if (buffer.length < 44) throw new Error(`WAV demasiado corto: ${file}`)
  let offset = 12
  let fmt = null
  let data = null
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') fmt = buffer.subarray(offset, body + size)
    if (id === 'data') {
      data = buffer.subarray(body, Math.min(body + size, buffer.length))
      break
    }
    offset = body + size + (size % 2)
  }
  if (!fmt || !data) throw new Error(`WAV sin fmt/data: ${file}`)
  return { fmt, data }
}

/**
 * Escribe un WAV PCM con silencio al principio y al final. Necesario para el
 * dispositivo falso de Chromium: el audio empieza en el lanzamiento y el pad
 * cubre el arranque de la app.
 *
 * @param {string} source
 * @param {string} dest
 * @param {number} leadInMs
 * @param {number} tailMs
 */
export function writePaddedWav(source, dest, leadInMs, tailMs) {
  const info = readWavInfo(source)
  const { fmt, data } = wavChunks(source)
  const bytesPerSecond = info.sampleRate * info.channels * (info.bitsPerSample / 8)
  const leadBytes = Math.max(0, Math.round((leadInMs / 1000) * bytesPerSecond))
  const tailBytes = Math.max(0, Math.round((tailMs / 1000) * bytesPerSecond))
  const totalData = leadBytes + data.length + tailBytes
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(4 + fmt.length + 8 + totalData, 4)
  header.write('WAVE', 8, 'ascii')
  const dataHeader = Buffer.alloc(8)
  dataHeader.write('data', 0, 'ascii')
  dataHeader.writeUInt32LE(totalData, 4)
  const silence = Buffer.alloc(leadBytes + tailBytes)
  writeFileSync(dest, Buffer.concat([header, fmt, dataHeader, silence.subarray(0, leadBytes), data, silence.subarray(leadBytes)]))
  return {
    path: dest,
    seconds: (totalData / bytesPerSecond),
    sampleRate: info.sampleRate,
    channels: info.channels,
    bitsPerSample: info.bitsPerSample,
    leadInMs,
    tailMs,
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

/**
 * @param {string[]} argv
 * @returns {any}
 */
export function parseArgs(argv) {
  const options = {
    session: '',
    mode: 'clean-room',
    sr: 'mute',
    leadIn: 0,
    tail: DEFAULT_TAIL_MS,
    out: '',
    url: DEFAULT_URL,
    headed: false,
    dryRun: false,
    noCapture: false,
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
      case '--mode':
        options.mode = value()
        break
      case '--sr':
        options.sr = value()
        break
      case '--lead-in':
        options.leadIn = Number(value())
        break
      case '--tail':
        options.tail = Number(value())
        break
      case '--out':
        options.out = value()
        break
      case '--url':
        options.url = value()
        break
      case '--headed':
        options.headed = true
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '--no-capture':
        options.noCapture = true
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
  if (!['clean-room', 'restore-start'].includes(options.mode)) {
    throw new Error(`--mode invalido: ${options.mode} (clean-room|restore-start)`)
  }
  if (!['real', 'mute', 'local'].includes(options.sr)) {
    throw new Error(`--sr invalido: ${options.sr} (real|mute|local)`)
  }
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
    '  --mode clean-room|restore-start  Estado inicial (default: clean-room)',
    '  --sr real|mute|local              Reconocimiento (default: mute)',
    '  --lead-in <ms>                    Espera extra tras LISTENING (default: 0)',
    '  --tail <ms>                       Margen tras el audio (default: 5000)',
    '  --out <carpeta>                   Artefactos (default: playbacks/<stamp>-<id>)',
    '  --url <url>                       App (default: http://localhost:5173)',
    '  --headed                          Navegador visible (recomendado para sr=real)',
    '  --dry-run                         Valida la sesion sin abrir navegador',
    '  --no-capture                      No enciende el recorder de sesion',
    '  --timeout <ms>                    Limite total (default: 600000)',
    '  --help                            Esta ayuda',
  ].join('\n')
}

/**
 * @param {string} out
 * @param {any} session
 * @returns {string}
 */
export function defaultOutDir(out, session) {
  if (out) return resolve(out)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return join(process.cwd(), 'playbacks', `${stamp}-${session.sessionId}`)
}

/**
 * Ruta absoluta segura para el WAV servido al navegador.
 * @param {string} file
 * @returns {string}
 */
export function absolutePath(file) {
  return isAbsolute(file) ? file : resolve(file)
}

/**
 * @param {string} file
 * @returns {string}
 */
export function sourceDirOf(file) {
  return dirname(resolve(file))
}
