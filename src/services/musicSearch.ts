// ============================================================
// musicSearch.ts — Búsqueda en línea de canciones vía Deezer.
// Permite a FLU reproducir EN LÍNEA cualquier canción que no esté
// en el catálogo estático (FLU_PLAYLIST). El cliente HTTP y la
// sonda de transmisibilidad son inyectables para testear sin red.
// NOTA HONESTA: Deezer devuelve vistas previas (~30s), no la
// canción completa; la fuente anterior (Internet Archive) ya no
// responde en la red del usuario.
// ============================================================

export interface SongSearchResult {
  identifier: string
  title: string
  url: string
}

/** Cliente HTTP inyectable (runtime usa fetch; tests usan un fake). */
export interface MusicSearchClient {
  /** Ejecuta la búsqueda y devuelve los candidatos (id/title/preview). */
  searchJson(query: string): Promise<{ data?: Array<{ id?: string | number; title?: string; preview?: string }> }>
}

/**
 * Sonda de transmisibilidad: comprueba que una URL de audio realmente
 * se puede reproducir (eventos loadedmetadata/canplay del <audio>).
 * Devuelve true solo si la URL es un audio decodificable/streamable.
 */
export type StreamProbe = (url: string, timeoutMs?: number) => Promise<boolean>

import { REQUEST_TIMEOUT_DEFAULTS } from '../core/config/sharedConfig'

const SEARCH_ROWS = 5

/** Timeout por petición (fuente única: config; evita esperas infinitas). */
const requestMs: number = REQUEST_TIMEOUT_DEFAULTS.MUSIC_SEARCH_MS
/** Timeout de la sonda de transmisibilidad (fuente única: config). */
const probeMs: number = REQUEST_TIMEOUT_DEFAULTS.MUSIC_PROBE_MS

/** fetch con timeout (AbortController): sin timeout fetch espera indefinidamente. */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Búsqueda en Deezer a través del proxy same-origin de Vite
 * (`server.proxy['/api/deezer']` → `https://api.deezer.com`). El proxy es
 * imprescindible: la API de Deezer NO envía CORS, así que un fetch directo
 * desde el navegador sería bloqueado.
 */
async function defaultSearchJson(
  query: string,
): Promise<{ data?: Array<{ id?: string | number; title?: string; preview?: string }> }> {
  const url = `/api/deezer/search?q=${encodeURIComponent(query)}&limit=${SEARCH_ROWS}`
  const res = await fetchWithTimeout(url, requestMs)
  if (!res.ok) throw new Error(`deezer search failed: ${res.status}`)
  return res.json()
}

export const DEFAULT_MUSIC_SEARCH_CLIENT: MusicSearchClient = {
  searchJson: defaultSearchJson,
}

/**
 * Sonda de playability vía HTMLAudioElement (navegador). Los CDN de audio
 * no envían CORS, por lo que un fetch-Range puede fallar (bloqueado) aunque
 * el <audio> sí reproduzca; por eso la verificación real es por eventos del
 * elemento de audio (loadedmetadata/canplay), no por HTTP.
 */
function probeWithAudio(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const audio = new Audio()
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = (ok: boolean) => {
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('error', onError)
      if (timer) clearTimeout(timer)
      resolve(ok)
    }
    const onLoaded = () => done(true)
    const onCanPlay = () => done(true)
    const onError = () => done(false)
    timer = setTimeout(() => done(false), timeoutMs)
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('error', onError)
    audio.preload = 'metadata'
    audio.src = url
  })
}

/** Sonda HTTP de respaldo (entornos sin HTMLAudio: Node/jsdom): rango inicial. */
async function probeWithRange(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(url, timeoutMs, {
      headers: { Range: 'bytes=0-1024' },
      redirect: 'follow',
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Sonda real de transmisibilidad. En el navegador usa HTMLAudioElement
 * (verificación real de playability); en entornos sin <audio> (Node/jsdom)
 * usa fetch-Range como respaldo.
 */
export async function probeStream(url: string, timeoutMs = probeMs): Promise<boolean> {
  if (typeof Audio !== 'undefined' && typeof Audio.prototype.addEventListener === 'function') {
    return probeWithAudio(url, timeoutMs)
  }
  return probeWithRange(url, timeoutMs)
}

/**
 * Busca una canción en Deezer y devuelve la primera cuya vista previa
 * REALMENTE transmite (verificada con la sonda). Devuelve null si no se
 * encuentra nada transmisible.
 */
export async function searchSongOnline(
  query: string,
  client: MusicSearchClient = DEFAULT_MUSIC_SEARCH_CLIENT,
  probe: StreamProbe = probeStream,
  probeTimeoutMs = probeMs,
): Promise<SongSearchResult | null> {
  const normalized = query?.trim()
  if (!normalized) return null

  const data = await client.searchJson(normalized)
  const items = data?.data ?? []
  for (const item of items.slice(0, SEARCH_ROWS)) {
    const url = item?.preview
    if (!url) continue
    // Solo se devuelve el candidato si su preview realmente se puede reproducir.
    const streamable = await probe(url, probeTimeoutMs).catch(() => false)
    if (streamable) {
      const id = String(item.id ?? url)
      return { identifier: id, title: item.title || id, url }
    }
  }
  return null
}
