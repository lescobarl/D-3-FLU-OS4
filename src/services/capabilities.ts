// ============================================================
// capabilities.ts — Catálogo honesto y estático de capacidades de FLU
// Fuente única de verdad para el prompt de sistema. Al ser un módulo
// TS estático NO invalida el cache de system prompt de 5 min del proxy.
// Importa la playlist desde musicPlayer (sin dependencia circular).
// ============================================================
import { FLU_PLAYLIST } from './musicPlayer'

export interface CapabilityDef {
  id: string
  label: string
  descriptionEs: string
  descriptionEn: string
}

export const FLU_CAPABILITIES: CapabilityDef[] = [
  {
    id: 'play_music',
    label: 'Reproducir música',
    descriptionEs:
      'Reproduce, pausa o detiene música real usando el campo "musica" del contrato. Elige "cancion" del playlist (suena al instante) o cualquier canción (FLU la busca en línea).',
    descriptionEn:
      'Play, pause or stop real music using the "musica" contract field. Pick "cancion" from the playlist (plays instantly) or any song (FLU searches online).',
  },
  {
    id: 'buscar_cancion',
    label: 'Buscar canción en línea',
    descriptionEs:
      'Busca y reproduce EN LÍNEA (Deezer, vista previa ~30s) cualquier canción que no esté en el playlist, indicándola en "musica.cancion".',
    descriptionEn:
      'Search and play ONLINE (Deezer, ~30s preview) any song not in the playlist by naming it in "musica.cancion".',
  },
  {
    id: 'navegar',
    label: 'Navegar pantallas',
    descriptionEs:
      'Cambia de pestaña o pantalla dentro de FLU usando el campo "navegacion" del contrato (inmobiliarias, autos, aviones...).',
    descriptionEn:
      'Switch tabs or screens inside FLU using the "navegacion" contract field (inmobiliarias, autos, aviones...).',
  },
  {
    id: 'generar_workspace',
    label: 'Generar workspace',
    descriptionEs:
      'Crea contenido de workspace (puntos clave, análisis) usando el campo "workspace" del contrato.',
    descriptionEn: 'Generate workspace content (key points, analysis) using the "workspace" contract field.',
  },
  {
    id: 'set_config',
    label: 'Cambiar configuración',
    descriptionEs:
      'Ajusta configuración de la sesión (idioma, rol, velocidad, colores) usando el campo "configuracion" del contrato.',
    descriptionEn:
      'Adjust session settings (language, role, speed, colors) using the "configuracion" contract field.',
  },
  {
    id: 'set_branding',
    label: 'Cambiar marca',
    descriptionEs:
      'Cambia temporada, modo o cumpleaños de la marca usando el campo "configuracion" (set_branding).',
    descriptionEn: 'Change season, mode or birthday branding using the "configuracion" field (set_branding).',
  },
  {
    id: 'animar',
    label: 'Animar al avatar',
    descriptionEs:
      'Mueve al avatar con animaciones físicas y estados emocionales usando los campos "animacion" y "emocion" del contrato.',
    descriptionEn:
      'Move the avatar with physical animations and emotional states using the "animacion" and "emocion" contract fields.',
  },
]

/** Nombre (id) de las capacidades, útil para validación y tests. */
export const CAPABILITY_IDS: readonly string[] = FLU_CAPABILITIES.map((c) => c.id)

function trackListFor(language: 'es' | 'en'): string {
  if (language === 'es') {
    return FLU_PLAYLIST.map((t) => `- ${t.id}: ${t.title}`).join('\n')
  }
  return FLU_PLAYLIST.map((t) => `- ${t.id}: ${t.title}`).join('\n')
}

/**
 * Construye el bloque de capacidades honestas para el system prompt.
 * Regla clave: el modelo NO debe inventar capacidades ni rutas; solo
 * puede usar las listadas y sus campos de contrato.
 */
export function buildCapabilitiesPrompt(language: 'es' | 'en' = 'es'): string {
  const isEnglish = language === 'en'
  const head = isEnglish
    ? 'FLU CAPABILITIES (you can ONLY use these; do NOT invent others):'
    : 'CAPACIDADES DE FLU (solo puedes usar estas; NO inventes otras):'
  const lines = FLU_CAPABILITIES.map(
    (c) => `- ${c.id}: ${isEnglish ? c.descriptionEn : c.descriptionEs}`,
  )
  const music = isEnglish
    ? 'MUSIC PLAYLIST (use "musica.cancion" with one of these ids or titles; any other song will be searched online):\n' +
      trackListFor('en')
    : 'PLAYLIST DE MÚSICA (usa "musica.cancion" con uno de estos ids o títulos; cualquier otra canción se buscará en línea):\n' +
      trackListFor('es')
  const musicRule = isEnglish
    ? 'MANDATORY MUSIC RULE: whenever the user asks you to play, sing, put on or start a song (e.g. "sing La Bamba", "play Las Mañanitas", "put on Cumpleaños Feliz"), you MUST emit the "musica" contract field with accion="play_music" and cancion="<song name>". Emitting "musica" is mandatory; answering with text only is NOT enough. To pause or stop, emit accion="pause_music" or accion="stop_music".'
    : 'REGLA DE MÚSICA OBLIGATORIA: cuando el usuario te pida poner, cantar, tocar o reproducir una canción (ej. "canta La Bamba", "pon Las Mañanitas", "toca Cumpleaños Feliz"), DEBES emitir el campo "musica" del contrato con accion="play_music" y cancion="<nombre de la canción>". Emitir "musica" es obligatorio; responder solo con texto NO es suficiente. Para pausar o detener emite accion="pause_music" o accion="stop_music".'
  const honest = isEnglish
    ? 'IMPORTANT: you cannot browse the web, call external APIs, or create files on your own; everything you do is expressed through the "contrato" JSON fields below. Music exception: FLU performs the online song search (Deezer) when you emit "musica.cancion" — you do not browse, you only name the song. For music use "musica.cancion": if it is in the playlist it plays instantly; otherwise FLU searches it online (Deezer).'
    : 'IMPORTANTE: no puedes navegar por internet, llamar APIs externas ni crear archivos por tu cuenta; todo lo que haces se expresa con los campos JSON del "contrato" de abajo. Excepción música: FLU realiza la búsqueda en línea (Deezer) cuando emites "musica.cancion" — tú no navegas, solo indicas la canción. Para música usa "musica.cancion": si es del playlist suena al instante; si no, FLU la busca en línea (Deezer).'
  return [head, ...lines, '', music, '', musicRule, '', honest].join('\n')
}
