// ============================================================
// capabilities.ts — Catálogo honesto y estático de capacidades de FLU
// Fuente única de verdad para el prompt de sistema. Al ser un módulo
// TS estático NO invalida el cache de system prompt de 5 min del proxy.
// Importa la playlist desde musicPlayer (sin dependencia circular).
// ============================================================
import { FLU_PLAYLIST } from './musicPlayer'
import { GAME_CATALOG, gameDisplayName } from '../core/games/gameCatalog'
import { CONTRACT_ACTION_DOMAINS } from '../core/agenda/domainScopedIntent'

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
  {
    id: 'acciones',
    label: 'Crear recordatorios, notas, diario, compras, alarmas y horario',
    descriptionEs:
      'Crea o consulta recordatorios, lista de compras, alarmas, temporizadores, notas, diario y horario usando el campo "acciones" del contrato. Cada acción lleva {dominio, texto} con el mandato tal como lo dijo el usuario.',
    descriptionEn:
      'Create or query reminders, shopping list, alarms, timers, notes, diary and schedule using the "acciones" contract field. Each action carries {dominio, texto} with the command as the user said it.',
  },
  {
    id: 'juego',
    label: 'Jugar a los juegos de FLU',
    descriptionEs:
      'Inicia o continua un juego del catalogo con el campo "juego" del contrato: {gameId, action}. Con una partida activa, la respuesta del jugador se emite como action="turn" con playerText.',
    descriptionEn:
      'Starts or continues a game from the catalog with the "juego" contract field: {gameId, action}. While a game is active, the player answer is emitted as action="turn" with playerText.',
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
  const domainList = CONTRACT_ACTION_DOMAINS.join(' | ')
  const accionesRule = isEnglish
    ? 'ACCIONES RULE (MANDATORY): when the user conversationally asks you to create, add, set, remove, list or check a reminder, shopping item, alarm, timer, diary entry, note or schedule class (e.g. "remind me to buy milk at 7", "add milk to the shopping list", "set an alarm for 7 in the morning", "set a 5 minute timer", "write in my diary today was a great day", "note down buy bread", "add math on Monday at 8 to my schedule"), you MUST emit the "acciones" array with one object per requested action: { "dominio": ' + domainList + ', "texto": "<the user\'s own command fragment, verbatim, without the wake word>" }. DOMAIN MAPPING (usa SOLO estos valores): shopping-list requests (add/remove/toggle/list an item) use "shopping"; alarms and timers use "alarma"; diary entries use "diary"; notes use "note"; schedule classes use "horario"; meetings use "junta"; appointments with someone use "cita". Emitting "acciones" is mandatory for these requests; answering with text only is NOT enough. Keep your respuesta_voz natural and conversational (confirm what you will do). NEVER state in "respuesta_voz" that it is already done or that the event already exists: FLU executes it and confirms only after it is created. Do NOT emit "acciones" for ordinary conversation, questions, navigation, music, images or configuration.'
    : 'REGLA DE ACCIONES (OBLIGATORIA): cuando el usuario te pida de forma conversacional crear, agregar, poner, quitar, listar o consultar un recordatorio, artículo de compras, alarma, temporizador, entrada de diario, nota o clase del horario (ej. "recuérdame comprar leche a las 7", "agrega leche a la lista de compras", "pon una alarma a las 7 de la mañana", "pon un temporizador de 5 minutos", "escribe en el diario hoy fue un gran día", "apunta comprar pan", "agrega matemáticas el lunes a las 8 al horario"), DEBES emitir el arreglo "acciones" con un objeto por cada acción pedida: { "dominio": ' + domainList + ', "texto": "<el fragmento del mandato tal como lo dijo el usuario, sin la wake word>" }. MAPEO DE DOMINIOS (usa SOLO estos valores): las peticiones de lista de compras (agregar/quitar/marcar/listar un artículo) usan "shopping"; las alarmas y temporizadores usan "alarma"; las entradas de diario usan "diary"; las notas usan "note"; las clases del horario usan "horario"; las reuniones y juntas usan "junta"; las citas con alguien usan "cita". Emitir "acciones" es obligatorio para estas peticiones; responder solo con texto NO es suficiente. Mantén tu respuesta_voz natural y conversacional (confirma lo que harás). NUNCA afirmes en "respuesta_voz" que ya lo hiciste ni que el evento ya existe: FLU lo ejecuta y confirma solo despues de crearlo. NO emitas "acciones" para conversación normal, preguntas, navegación, música, imágenes ni configuración.'
  const gameMenuList = GAME_CATALOG.map((g) => `${g.id} (${gameDisplayName(g)})`).join(', ')
  const juegoRule = isEnglish
    ? 'MANDATORY GAME RULE: when the user asks to play or start a game (e.g. "play the lottery", "put on the lottery", "I want to play riddles"), you MUST emit the "juego" contract field with { "gameId": "<catalog id>", "action": "start" }. gameId MUST be one of: ' + gameMenuList + '. Answering with text only is NOT enough. WHILE A GAME IS ACTIVE the player answer is NOT conversation: you MUST emit "juego" with { "gameId": "<active game>", "action": "turn", "playerText": "<what the player said>" } so the local engine evaluates it. Use "action": "end" to stop the game and "action": "menu" to ask for the game menu.'
    : 'REGLA DE JUEGOS OBLIGATORIA: cuando el usuario te pida jugar o empezar un juego (ej. "juguemos a la loteria", "pon la loteria", "quiero jugar a las adivinanzas"), DEBES emitir el campo "juego" del contrato con { "gameId": "<id del catalogo>", "action": "start" }. gameId DEBE ser uno de: ' + gameMenuList + '. Responder solo con texto NO es suficiente. MIENTRAS HAYA UNA PARTIDA ACTIVA la respuesta del jugador NO es conversacion: DEBES emitir "juego" con { "gameId": "<el juego activo>", "action": "turn", "playerText": "<lo que dijo el jugador>" } para que el motor local la evalue. Usa "action": "end" para terminar la partida y "action": "menu" para pedir el menu de juegos.'
  const honest = isEnglish
    ? 'IMPORTANT: you cannot browse the web, call external APIs, or create files on your own; everything you do is expressed through the "contrato" JSON fields below. Music exception: FLU performs the online song search (Deezer) when you emit "musica.cancion" — you do not browse, you only name the song. For music use "musica.cancion": if it is in the playlist it plays instantly; otherwise FLU searches it online (Deezer).'
    : 'IMPORTANTE: no puedes navegar por internet, llamar APIs externas ni crear archivos por tu cuenta; todo lo que haces se expresa con los campos JSON del "contrato" de abajo. Excepción música: FLU realiza la búsqueda en línea (Deezer) cuando emites "musica.cancion" — tú no navegas, solo indicas la canción. Para música usa "musica.cancion": si es del playlist suena al instante; si no, FLU la busca en línea (Deezer).'
  return [head, ...lines, '', music, '', musicRule, '', accionesRule, '', juegoRule, '', honest].join('\n')
}
