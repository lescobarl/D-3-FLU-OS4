// ============================================================
// musicCatalog.ts — Catálogo de pistas (CONFIG, no servicio).
// Rule #1 (NO HARDCODE): las URLs viven en config; el servicio
// (src/services/musicPlayer.ts) solo las consume.
// ============================================================

export interface MusicCatalogTrack {
  id: string
  title: string
  url: string
  /** Fuente/licencia honesta (dominio público / muestra gratuita). */
  source?: string
}

// Base URL de las muestras SoundHelix (uso libre para demo).
const SOUNDHELIX_BASE_URL = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-'

export const MUSIC_CATALOG: MusicCatalogTrack[] = [
  // --- Muestras instrumentales (SoundHelix, uso libre para demo) ---
  { id: 'sueño', title: 'Sueño de Bunny', url: `${SOUNDHELIX_BASE_URL}1.mp3` },
  { id: 'baila', title: 'Baila Bunny', url: `${SOUNDHELIX_BASE_URL}2.mp3` },
  { id: 'canta', title: 'Canta Bunny', url: `${SOUNDHELIX_BASE_URL}3.mp3` },
  { id: 'fiesta', title: 'Fiesta Bunny', url: `${SOUNDHELIX_BASE_URL}4.mp3` },
  // --- Canciones comunes de dominio público (Internet Archive, EN LÍNEA) ---
  {
    id: 'cumpleaños',
    title: 'Cumpleaños Feliz',
    url: 'https://archive.org/download/78_happy-birthday-song_gbia0534279/01%20-%20HAPPY%20BIRTHDAY%20SONG%20-%20Part%201.mp3',
    source: 'Internet Archive (Great 78 Project, dominio público)',
  },
  {
    id: 'mañanitas',
    title: 'Las Mañanitas',
    url: 'https://archive.org/download/78_las-mananitas_lola-beltran-los-charros-de-ameca-de-roman-palomar_gbia0020855b/Las%20Mananitas%20-%20Lola%20Beltran%20-%20Los%20Charros%20de%20Ameca%20de%20Roman%20Palomar-restored.mp3',
    source: 'Internet Archive (Great 78 Project, dominio público)',
  },
  {
    id: 'estrellita',
    title: 'Estrellita',
    url: 'https://archive.org/download/TwinkleTwinkleLittleStarPlain/Twinkle_Twinkle_Little_Star_plain.mp3',
    source: 'Internet Archive (dominio público)',
  },
  {
    id: 'elisa',
    title: 'Para Elisa',
    url: 'https://archive.org/download/BeethovenFrElise-Schnabel/Beethoven-FrEliseWoo59.mp3',
    source: 'Internet Archive (dominio público)',
  },
  {
    id: 'cielito',
    title: 'Cielito Lindo',
    url: 'https://archive.org/download/dussolina-gianini-cielito-lindo-mexicanfolksong-victor-1195/DussolinaGianini%2CCielitoLindo%2CMexicanfolksong%2CVictor1195.mp3',
    source: 'Internet Archive (Great 78 Project, dominio público)',
  },
]
