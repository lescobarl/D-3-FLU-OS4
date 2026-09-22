// ============================================================
// musicPlayer.ts — Reproductor de música REAL para FLU OS4
// Singleton HTMLAudio (modelado sobre localTts.ts). Sin rutas de
// red ni backend: el audio se reproduce 100% en el navegador
// (streaming en línea). La playlist estática es la fuente para el
// catálogo común; si la canción no está, playSong() la busca en
// línea (Deezer, vista previa ~30s) vía musicSearch.
// ============================================================
import {
  searchSongOnline,
  DEFAULT_MUSIC_SEARCH_CLIENT as DEFAULT_SEARCH_CLIENT,
  type MusicSearchClient,
  type StreamProbe,
  probeStream,
} from './musicSearch'
import { MUSIC_CATALOG } from '../core/config/musicCatalog'
import { normalizeForMatchExact as normalizeForMatch } from '../lib/textUtils'
import { logCaughtError } from '../lib/caughtError';

export interface MusicTrack {
  id: string
  title: string
  url: string
  /** Fuente/licencia honesta (dominio público / muestra gratuita). */
  source?: string
}

export interface MusicOptions {
  /** id o título parcial de una pista; si se omite usa la primera. */
  trackId?: string
  loop?: boolean
  volume?: number
}

// Playlist centralizada: 4 pistas instrumentales de muestra (SoundHelix,
// libres para demo/offline) + 5 canciones comunes de dominio público
// (Internet Archive / Great 78 Project). NOTA: los enlaces de archive.org
// pueden dejar de responder en algunas redes; playSong() los verifica con
// la sonda y, si fallan, cae a la búsqueda en línea (Deezer).
// Catálogo estático y honesto — solo listamos pistas reales y verificadas.
// Playlist: la fuente de datos vive en config (src/core/config/musicCatalog.ts).
// Este servicio solo la expone y la reproduce (Rule #1: NO HARDCODE).
export const FLU_PLAYLIST: MusicTrack[] = MUSIC_CATALOG

const DEFAULT_VOLUME = 0.6

let audioRef: HTMLAudioElement | null = null

/**
 * Modo "keep-alive" (activado por playSong): si el stream se corta a mitad
 * (error/stall de red, vista previa cortada por el CDN), el reproductor se
 * auto-recupera reiniciando la fuente para que la canción no se interrumpa.
 * stopMusic() lo desactiva para que "para la música" sí detenga todo.
 */
let keepAlive = false
let lastRestartAt = 0
const MIN_RESTART_GAP_MS = 3000

function getAudio(): HTMLAudioElement {
  if (!audioRef) {
    audioRef = new Audio()
    audioRef.preload = 'auto'
    audioRef.volume = DEFAULT_VOLUME
    // Auto-recuperación del stream (guard: algunos mocks no implementan eventos).
    if (typeof audioRef.addEventListener === 'function') {
      const restartStream = () => {
        if (!keepAlive) return
        const now = Date.now()
        if (now - lastRestartAt < MIN_RESTART_GAP_MS) return
        lastRestartAt = now
        console.warn('[musicPlayer] stream interrumpido → reiniciando para seguir cantando')
        try {
          audioRef!.currentTime = 0
          audioRef!.play().catch(() => {})
        } catch {
        logCaughtError('[catch] src/services/musicPlayer.ts');
          /* ignore */
        }
      }
      audioRef.addEventListener('error', restartStream)
      audioRef.addEventListener('stalled', restartStream)
    }
  }
  return audioRef
}

function startAudio(url: string, loop: boolean, volume?: number): void {
  const audio = getAudio()
  if (volume != null) audio.volume = volume
  audio.loop = loop
  if (audio.src !== url) audio.src = url
  audio.play().catch((err) => {
    console.warn('[musicPlayer] no se pudo reproducir:', err)
  })
}

/** Devuelve una copia inmutable de la playlist. */
export function getPlaylist(): MusicTrack[] {
  return FLU_PLAYLIST.map((t) => ({ ...t }))
}

// Fuente única: src/lib/textUtils.ts. Re-exportado para no duplicar el algoritmo.
export { normalizeForMatch }

/**
 * Busca una pista del catálogo por id o título (insensible a acentos y
 * mayúsculas). Devuelve undefined si NO hay coincidencia (sin fallback).
 */
export function findTrack(trackId?: string): MusicTrack | undefined {
  if (!trackId) return undefined
  const needle = normalizeForMatch(trackId)
  const byId = FLU_PLAYLIST.find((t) => normalizeForMatch(t.id) === needle)
  if (byId) return byId
  return FLU_PLAYLIST.find((t) => normalizeForMatch(t.title).includes(needle))
}

/**
 * Resuelve una pista por id exacto o por coincidencia parcial de título,
 * insensible a acentos y mayúsculas. Sin argumento (o sin coincidencia)
 * devuelve la primera pista.
 */
export function resolveTrack(trackId?: string): MusicTrack | undefined {
  if (!FLU_PLAYLIST.length) return undefined
  if (!trackId) return FLU_PLAYLIST[0]
  return findTrack(trackId) || FLU_PLAYLIST[0]
}

/** Inicia (o cambia a) una pista del catálogo. Sin hardcode de URL en el consumidor. */
export function playMusic(options: MusicOptions = {}): void {
  const track = resolveTrack(options.trackId)
  if (!track) return
  startAudio(track.url, options.loop ?? false, options.volume)
}

/** Reproduce una URL directa en línea (p. ej. resultado de la búsqueda). */
export function playMusicUrl(url: string, options: { loop?: boolean; volume?: number } = {}): void {
  if (!url) return
  startAudio(url, options.loop ?? false, options.volume)
}

export function pauseMusic(): void {
  audioRef?.pause()
}

export function resumeMusic(): void {
  audioRef
    ?.play()
    .catch((err) => {
      console.warn('[musicPlayer] no se pudo reanudar:', err)
    })
}

export function stopMusic(): void {
  keepAlive = false
  if (audioRef) {
    audioRef.pause()
    audioRef.currentTime = 0
  }
}

export function isMusicPlaying(): boolean {
  return audioRef ? !audioRef.paused && !audioRef.ended : false
}

export function setMusicVolume(volume: number): void {
  if (audioRef) audioRef.volume = volume
}

export type SongSource = 'catalog' | 'online' | 'fallback' | 'not_found'

export interface PlaySongResult {
  /** Título de la canción que quedó sonando (vacío si no se encontró nada). */
  title: string
  /**
   * De dónde salió:
   * - 'catalog'   → pista del catálogo estático (suena al instante).
   * - 'online'    → canción encontrada en línea que sí transmite.
   * - 'fallback'  → música ambiental por defecto (solo petición genérica).
   * - 'not_found' → canción ESPECÍFICA pedida que no pudo reproducirse.
   *   Nunca se sustituye una canción concreta por una pista aleatoria.
   */
  source: SongSource
}

/**
 * Orquesta la reproducción con catálogo honesto:
 * - Sin canción concreta → música ambiental (primera pista del catálogo).
 * - Canción del catálogo → se verifica su URL con la sonda; si transmite
 *   suena al instante (source 'catalog'); si no (enlace muerto, p. ej.
 *   archive.org caído en la red del usuario), cae a la búsqueda en línea.
 * - Canción desconocida → búsqueda en línea (Deezer); solo se reproduce si
 *   su preview transmite de verdad (source 'online').
 * - Canción ESPECÍFICA no encontrada/transmisible → NO reproduce nada y
 *   responde 'not_found' (nunca una pista aleatoria en su lugar).
 * El cliente de búsqueda y la sonda son inyectables (tests usan fakes).
 */
export async function playSong(
  query?: string,
  searchClient: MusicSearchClient = DEFAULT_SEARCH_CLIENT,
  probe: StreamProbe = probeStream,
): Promise<PlaySongResult> {
  const normalized = query?.trim()
  if (!normalized) {
    const ambient = FLU_PLAYLIST[0]
    if (ambient) startAudio(ambient.url, false, undefined)
    return { title: ambient?.title ?? '', source: 'fallback' }
  }
  const local = findTrack(normalized)
  if (local) {
    // La URL del catálogo puede haber muerto (archive.org deja de responder
    // en algunas redes). Solo se reproduce si la sonda confirma que transmite;
    // si no, se cae a la búsqueda en línea (Deezer).
    const streamable = await probe(local.url).catch(() => false)
    if (streamable) {
      keepAlive = true
      // El gap anti-bucle se mide desde el inicio de la reproducción.
      lastRestartAt = Date.now()
      startAudio(local.url, false, undefined)
      return { title: local.title, source: 'catalog' }
    }
  }
  const found = await searchSongOnline(normalized, searchClient, probe).catch(() => null)
  if (found?.url) {
    keepAlive = true
    // El gap anti-bucle se mide desde el inicio de la reproducción.
    lastRestartAt = Date.now()
    // Vista previa de Deezer (~30s): se reproduce UNA vez y termina sola
    // (loop=false). Así la canción suena COMPLETA y, al acabar, el poller de
    // sustain (checkSong) ve isMusicPlaying()===false y detiene el baile junto
    // con la música (ambos terminan juntos). FIX 2026-08-17: antes iba en loop
    // infinito → "la música nunca terminaba". Los cortes de red a mitad se
    // siguen recuperando con keepAlive/restartStream (eventos error/stalled).
    startAudio(found.url, false, undefined)
    return { title: found.title, source: 'online' }
  }
  return { title: '', source: 'not_found' }
}
