// ============================================================
// FLU OS4 — Resolución determinista de comandos de configuración por voz
// ============================================================
// Complemento 100% local y determinista del flujo `configuracion`:
// cuando el modelo solo verbaliza (o emite `configuracion` incompleto),
// este módulo deriva el contrato a partir del texto transcrito.
//
// - Única fuente de verdad: VOICE_CONFIG_CATALOG + catálogo fusionado de paletas (data-driven).
// - Sin rutas dobles: el resultado se inyecta como `contract.configuracion`
//   y se despacha por la ÚNICA ruta existente (App.tsx applyConfigAction).
// - Guardia estricta (sin afectación): requiere verbo de directiva + clave
//   de configuración + valor resoluble antes de emitir una acción, para no
//   dispararse en conversación casual.
// ============================================================

import { stripDiacritics } from './audioMath.js'
import { getFusedPalettes } from '../../core/branding/seasonalPalettes'
import { VOICE_CONFIG_CATALOG } from '../../core/config/voiceConfigCatalog'
import { isGameId } from '../../core/games/gameCatalog'

// ------------------------------------------------------------
// Normalización de texto
// ------------------------------------------------------------

/** Normaliza un texto para comparación: minúsculas, sin acentos, espacios colapsados. */
export function normalizeForMatch(text = '') {
  return stripDiacritics(text).replace(/\s+/g, ' ').trim()
}

/**
 * Localiza `phrase` como token independiente (con límites de palabra) dentro
 * de `normalized` y devuelve el índice de la coincidencia, o `null` si no
 * aparece. Evita coincidencias parciales tipo "activa" dentro de "desactiva"
 * o "set" dentro de "settings". La posición permite priorizar el sustantivo
 * principal (el que aparece primero en la frase) de forma determinista.
 */
function findTokenIndex(normalized = '', phrase = '') {
  const clean = normalizeForMatch(phrase)
  if (!clean || !normalized) return null
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(^|\\s)${escaped}($|\\s|[.,;!?¡¿])`, 'i').exec(normalized)
  return match ? match.index : null
}

/**
 * Verifica que `phrase` aparezca como token independiente (con límites de
 * palabra) dentro de `normalized`. Evita coincidencias parciales tipo
 * "activa" dentro de "desactiva" o "set" dentro de "settings".
 */
export function hasToken(normalized = '', phrase = '') {
  return findTokenIndex(normalized, phrase) != null
}

// ------------------------------------------------------------
// Verbos de directiva (guardia principal)
// ------------------------------------------------------------
// No se incluye conversación casual: solo imperativos/instrucciones explícitas
// de configuración. El guardia real de «sin afectación» es que además debe
// aparecer un sustantivo de configuración y un valor resoluble.

const DIRECTIVE_VERBS = Object.freeze([
  // Español
  'cambia', 'cambie', 'cambias', 'cambiar', 'cambio', 'cambiemos',
  'pon', 'ponle', 'ponme', 'poner', 'ponga', 'pongas', 'ponla', 'ponlo', 'ponlos', 'ponlas',
  'activa', 'activen', 'activar', 'activemos', 'activame',
  'desactiva', 'desactiven', 'desactivar', 'desactivame',
  'deshabilita', 'deshabilitar', 'deshabilitame',
  'configura', 'configurame', 'configurar', 'configures', 'configurarme',
  'ajusta', 'ajustar', 'ajustame',
  'selecciona', 'seleccionar', 'seleccioname',
  'fija', 'fijar', 'fijame',
  'establece', 'establecer', 'estableceme',
  'usa', 'usas', 'usar', 'use', 'usame',
  'sube', 'subir', 'baja', 'bajar',
  'enciende', 'encender', 'apaga', 'apagar',
  'muestra', 'mostrar', 'oculta', 'ocultar',
  'aplica', 'aplicar', 'aplicame',
  'quita', 'quitar', 'quitame', 'quitale',
  'elimina', 'eliminar', 'borra', 'borrar', 'remueve', 'remover', 'saca',
  'agrega', 'agregar', 'anade', 'anadir', 'crea', 'crear', 'guarda', 'guardar', 'registra', 'registrar', 'adiciona', 'adicionar',
  'limpia', 'limpiar',
  'restablece', 'restablecer', 'restablecerme', 'resetea', 'resetear', 'reinicia', 'reiniciar',
  // English
  'change', 'changes', 'changed', 'set', 'sets', 'setting', 'settings', 'switch', 'switches', 'put',
  'activate', 'activated', 'enable', 'enabled', 'disable', 'disabled', 'turn', 'make', 'select', 'adjust',
  'add', 'create', 'register', 'save', 'remove', 'delete', 'clean', 'clear',
])

// ------------------------------------------------------------
// Verbos de encendido/apagado del branding (toggle genérico)
// ------------------------------------------------------------
// Cuando se dice "activa/desactiva la estación/branding" SIN nombrar una
// temporada concreta, se interpreta como encender (→ auto, detecta por
// calendario) o apagar (→ disabled) el branding estacional global.

/** Verbos que ENCIENDEN el branding estacional (genérico → auto). */
const BRANDING_ON_VERBS = Object.freeze([
  'activa', 'activen', 'activar', 'activemos', 'activame',
  'enciende', 'encender',
  'activate', 'enable', 'enabled', 'turn on',
])

/** Verbos que APAGAN el branding estacional (→ disabled). */
const BRANDING_OFF_VERBS = Object.freeze([
  'desactiva', 'desactiven', 'desactivar', 'desactivame',
  'apaga', 'apagar',
  'quita', 'quitar', 'quitame', 'quitale', 'quitemos',
  'elimina', 'eliminar', 'eliminame',
  'borra', 'borrar', 'borrame',
  'remueve', 'remover', 'saca', 'sacar',
  'deshabilita', 'deshabilitar', 'deshabilitame',
  'disable', 'disabled', 'turn off', 'off', 'remove', 'delete', 'clear',
])

/** ¿El texto contiene alguno de los verbos de la lista dada? */
function hasBrandingIntent(normalized = '', verbs = []) {
  return verbs.some((verb) => hasToken(normalized, verb))
}

// ------------------------------------------------------------
// Sustantivos de configuración → clave del catálogo (data-driven)
// ------------------------------------------------------------
// Cuando varios sustantivos coinciden en una frase, la selección es
// determinista por POSICIÓN (el primero es el sujeto principal, como en
// "pon el branding de cumpleaños" → branding/activeSeason), no por longitud.

const CONFIG_NOUNS = Object.freeze({
  activeSeason: ['tema visual', 'temporada', 'season', 'theme', 'estacion', 'paleta de colores', 'paleta', 'branding', 'decoracion', 'tema'],
  mode: ['modo', 'mode'],
  birthday: ['cumpleanos', 'birthday', 'fecha de cumpleanos'],
  customEvent: ['festividad personalizada', 'aniversario personalizado', 'evento personalizado', 'evento especial', 'custom festivity', 'custom event', 'special event', 'anniversary', 'festividad', 'aniversario', 'evento'],
  celebrateAchievements: ['celebracion de logros', 'celebrar logros', 'celebraciones', 'celebrate achievements', 'logros'],
  language: ['idioma', 'language'],
  sessionRole: ['rol de sesion', 'session role', 'rol'],
  voiceSpeed: ['velocidad de voz', 'velocidad de habla', 'voice speed', 'speed'],
  pitch: ['tono de voz', 'pitch'],
  volume: ['volumen', 'volume'],
  traits: ['rasgos de personalidad', 'rasgo de personalidad', 'rasgos', 'rasgo', 'personality traits', 'traits', 'personalidad'],
  tone: ['tono de comunicacion', 'communication tone', 'tone'],
  customInstructions: ['instrucciones personalizadas', 'custom instructions', 'instrucciones'],
  proactivity: ['proactividad', 'proactivity'],
  defaultEmotion: ['emocion por defecto', 'default emotion', 'emocion'],
  animationSpeed: ['velocidad de animacion', 'animation speed'],
  emotionalReactivity: ['reactividad emocional', 'emotional reactivity'],
  creativity: ['creatividad', 'creativity'],
  emotionMinConfidence: ['confianza minima', 'minimum confidence'],
  emotionBaseDetectionConfidence: ['confianza base', 'base confidence'],
  emotionTopicChangeOverlapRatio: ['cambio de tema', 'topic change'],
  emotionTopicChangeMinWords: ['palabras minimas', 'minimum words'],
  emotionShortUtteranceWordCount: ['frase corta', 'short utterance'],
  tomMaxParticipants: ['maximo de participantes', 'max participants', 'participantes'],
  tomMaxTopicsPerParticipant: ['maximo de temas por participante', 'topics per participant'],
  tomParticipantInactivityMs: ['minutos de inactividad', 'inactividad', 'inactivity'],
  tomSummaryDisplayLimit: ['limite del resumen', 'summary limit'],
  systemEventWindowMs: ['ventana de eventos', 'event window'],
  systemEventDedupBucketMs: ['deduplicacion de eventos', 'dedup bucket'],
  capVisible: ['gorra', 'gorro', 'cap'],
  hairVisible: ['cabello', 'pelo', 'hair'],
  avatarColor: ['color del avatar', 'avatar color'],
  pantsColor: ['color del pantalon', 'pants color'],
  bodyColor: ['color del cuerpo', 'body color'],
  faceColor: ['color de la cara', 'face color'],
  resetAvatarColors: [
    'restablecer colores del avatar',
    'restablece los colores del avatar',
    'restablecer los colores del avatar',
    'resetear colores del avatar',
    'resetea los colores del avatar',
    'restablecer colores',
    'restablece los colores',
    'restablecer colores de flu',
    'resetear colores',
    'colores por defecto',
    'default colors',
  ],
  aiProvider: ['proveedor de ia', 'motor de ia', 'motor de inteligencia artificial', 'ai provider', 'provider', 'proveedor'],
  profile: ['perfil', 'profile'],
  textModel: ['modelo de texto', 'text model', 'modelo'],
  textApiUrl: ['url del texto', 'text api url', 'url de texto'],
  imageModel: ['modelo de imagen', 'image model'],
  imageApiUrl: ['url de la imagen', 'image api url', 'url de imagen'],
  ocrApiKey: ['clave de ocr', 'ocr api key'],
  ocrModel: ['modelo de ocr', 'ocr model'],
  ocrApiUrl: ['url de ocr', 'ocr api url'],
  voice: ['voz', 'voice'],
  wakeWords: ['palabra de activacion', 'palabras de activacion', 'wake word', 'wake words'],
  debugLogs: ['logs de depuracion', 'debug logs'],
  clearCache: ['limpiar la cache', 'limpia la cache', 'limpiar cache', 'limpiar la caché', 'limpia la caché', 'clear cache', 'cache'],
})

/** Pares [clave, sustantivo] del catálogo (data-driven). */
const NOUN_PAIRS = Object.entries(CONFIG_NOUNS).flatMap(([clave, nouns]) =>
  nouns.map((noun) => [clave, noun]),
)

/**
 * Busca la entrada del catálogo cuyo sustantivo aparezca en el texto.
 * Cuando varios sustantivos de configuración coinciden, gana el que aparece
 * PRIMERO en la frase (el sujeto principal precede al complemento). Esto hace
 * determinista "pon el branding de cumpleaños" → activeSeason=cumpleanos: si
 * ganara por longitud, el sustantivo 'cumpleanos' (9) robaría el comando a
 * 'branding' (8) y lo enrutaría a birthday (fecha sin resolvedor) → no-op.
 */
function findConfigEntry(normalized = '') {
  let best = null
  for (const [clave, noun] of NOUN_PAIRS) {
    const index = findTokenIndex(normalized, noun)
    if (index == null) continue
    const entry = VOICE_CONFIG_CATALOG.find((e) => e.clave === clave)
    if (!entry || entry.handler === 'unsupported') continue
    if (best == null || index < best.index) best = { entry, index }
  }
  return best ? best.entry : null
}

// ------------------------------------------------------------
// Resolución de valores (selects)
// ------------------------------------------------------------

/** Construye el mapa de sinónimos de temporadas desde el catálogo fusionado de paletas. */
function buildSeasonAliases() {
  const aliases = []
  const extra = {
    default: ['original', 'normal', 'basico', 'clasico', 'por defecto'],
    navidad: ['nochebuena', 'christmas'],
    muertos: ['dia de muertos', 'dia de los muertos'],
    patrio: ['independencia', 'patria', 'septiembre', 'dieciseis de septiembre'],
    infantil: ['ninos', 'ninas'],
    maestro: ['dia del maestro', 'teachers day'],
    cumpleanos: ['cumple', 'birthday'],
    ano_nuevo: ['ano nuevo', 'new year', 'fin de ano'],
    reyes: ['reyes magos', 'dia de reyes', 'three kings'],
    san_valentin: ['san valentin', 'valentin', 'valentines', '14 de febrero', 'dia del amor'],
    primavera: ['primavera', 'spring'],
    san_patricio: ['san patricio', 'st patrick', 'patrick'],
    tierra: ['dia de la tierra', 'earth day'],
    trabajo: ['dia del trabajo', 'labor day', 'trabajador'],
    madres: ['dia de las madres', 'mothers day', 'madre'],
    verano: ['verano', 'summer'],
    padres: ['dia del padre', 'fathers day', 'padre'],
    otono: ['otono', 'fall', 'autumn'],
    halloween: ['halloween'],
    invierno: ['invierno', 'winter'],
    ecologico: ['ecologico', 'eco', 'ecologia'],
  }
  for (const palette of getFusedPalettes()) {
    aliases.push([normalizeForMatch(palette.id), palette.id])
    const name = normalizeForMatch(palette.name || '')
    if (name && name !== normalizeForMatch(palette.id)) aliases.push([name, palette.id])
  }
  for (const [key, syns] of Object.entries(extra)) {
    for (const syn of syns) aliases.push([normalizeForMatch(syn), key])
  }
  return aliases.sort((a, b) => b[0].length - a[0].length)
}

/** Resuelve una temporada del branding (clave de paleta) desde el texto. */
export function matchSeason(text = '') {
  const normalized = normalizeForMatch(text)
  for (const [syn, key] of buildSeasonAliases()) {
    if (hasToken(normalized, syn)) return key
  }
  return null
}

const MODE_SYNONYMS = {
  auto: ['auto', 'automatico', 'automatica', 'automatic'],
  manual: ['manual', 'manualmente'],
  disabled: ['desactivado', 'desactivada', 'apagado', 'apagada', 'off', 'disabled', 'deshabilitado', 'deshabilitada'],
}

const LANGUAGE_SYNONYMS = {
  es: ['espanol', 'castellano', 'spanish'],
  en: ['ingles', 'english'],
  both: ['ambos', 'both', 'bilingue', 'bilingual'],
}

const PROVIDER_SYNONYMS = {
  openrouter: ['openrouter', 'open router'],
  gemini: ['gemini', 'google'],
  deepseek: ['deepseek', 'deep seek'],
  local: ['local', 'offline', 'servidor local'],
}

const EMOTION_SYNONYMS = {
  neutral: ['neutral', 'normal', 'neutro'],
  happy: ['feliz', 'contento', 'alegre'],
  sad: ['triste'],
  curious: ['curioso', 'curiosa'],
  thoughtful: ['pensativo', 'pensativa'],
  surprised: ['sorprendido', 'sorprendida'],
  excited: ['emocionado', 'emocionada', 'animado', 'animada'],
}

function resolveFromSynonyms(text = '', map = {}) {
  const normalized = normalizeForMatch(text)
  const pairs = []
  for (const [key, syns] of Object.entries(map)) {
    for (const syn of syns) pairs.push([syn, key])
  }
  pairs.sort((a, b) => b[0].length - a[0].length)
  for (const [syn, key] of pairs) {
    if (hasToken(normalized, syn)) return key
  }
  return null
}

export function matchMode(text = '') {
  return resolveFromSynonyms(text, MODE_SYNONYMS)
}

export function matchLanguage(text = '') {
  return resolveFromSynonyms(text, LANGUAGE_SYNONYMS)
}

export function matchProvider(text = '') {
  return resolveFromSynonyms(text, PROVIDER_SYNONYMS)
}

export function matchEmotion(text = '') {
  return resolveFromSynonyms(text, EMOTION_SYNONYMS)
}

/** Resuelve un valor select del catálogo (usa matchers específicos y opciones genéricas). */
export function resolveSelectValue(text = '', entry = {}) {
  const normalized = normalizeForMatch(text)
  if (entry.clave === 'activeSeason') return matchSeason(normalized)
  if (entry.clave === 'mode') return matchMode(normalized)
  if (entry.clave === 'language') return matchLanguage(normalized)
  if (entry.clave === 'aiProvider') return matchProvider(normalized)
  if (entry.clave === 'defaultEmotion') return matchEmotion(normalized)
  for (const opt of entry.opciones || []) {
    if (hasToken(normalized, String(opt))) return String(opt)
  }
  return null
}

// ------------------------------------------------------------
// Resolución de valores (boolean y number)
// ------------------------------------------------------------

const BOOLEAN_TRUE = ['si', 'activar', 'activa', 'activado', 'activada', 'encender', 'enciende', 'mostrar', 'muestra', 'visible', 'pon', 'on', 'true', 'verdadero', 'habilitar', 'habilita', 'yes']
const BOOLEAN_FALSE = ['no', 'desactivar', 'desactiva', 'desactivado', 'desactivada', 'apagar', 'apaga', 'ocultar', 'oculta', 'oculto', 'invisible', 'quita', 'quitar', 'off', 'false', 'falso', 'deshabilitar', 'deshabilita']

/** Resuelve un valor booleano ('true' | 'false') desde el texto (los negativos dominan). */
export function resolveBooleanValue(text = '') {
  const normalized = normalizeForMatch(text)
  for (const tok of BOOLEAN_FALSE) {
    if (hasToken(normalized, tok)) return 'false'
  }
  for (const tok of BOOLEAN_TRUE) {
    if (hasToken(normalized, tok)) return 'true'
  }
  return null
}

/** Resuelve un valor numérico (string) respetando min/max y porcentajes. */
export function resolveNumberValue(text = '', entry = {}) {
  const normalized = normalizeForMatch(text)
  const pct = normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:%|por ciento|porciento)/)
  const raw = pct ? pct[1] : normalized.match(/(\d+(?:[.,]\d+)?)/)?.[1]
  if (raw == null) return null
  let value = Number.parseFloat(String(raw).replace(',', '.'))
  if (!Number.isFinite(value)) return null
  if (pct && entry.max != null && entry.max <= 1) value = value / 100
  if (entry.min != null && value < entry.min) return null
  if (entry.max != null && value > entry.max) return null
  return String(value)
}

// ------------------------------------------------------------
// Resolución de fechas (cumpleaños) y festividades personalizadas
// ------------------------------------------------------------

/** Valida una fecha por construcción con Date.UTC y retorna 'YYYY-MM-DD' o null. */
function buildIsoDate(month, day, year = 2000) {
  const m = Number(month)
  const d = Number(day)
  const y = Number(year)
  if (!Number.isInteger(m) || !Number.isInteger(d) || !Number.isInteger(y)) return null
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const MONTHS_ES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
}
const MONTHS_EN = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}
const MONTHS_ES_SHORT = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12,
}
const MONTHS_EN_SHORT = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

const NUMBERS_ES = {
  uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23,
  veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28,
  veintinueve: 29, treinta: 30,
}
const NUMBERS_EN = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, twentyone: 21, twentytwo: 22,
  twentythree: 23, twentyfour: 24, twentyfive: 25, twentysix: 26, twentyseven: 27,
  twentyeight: 28, twentynine: 29, thirty: 30,
}

/** Convierte un token de día (número o palabra) a entero, o null. */
function resolveDayToken(token = '') {
  if (!token) return null
  if (/^\d{1,2}$/.test(token)) return Number(token)
  const word = normalizeForMatch(token)
  if (NUMBERS_ES[word] != null) return NUMBERS_ES[word]
  if (NUMBERS_EN[word] != null) return NUMBERS_EN[word]
  return null
}

/** Convierte un token de mes (palabra o número) a entero 1-12, o null. */
function resolveMonthToken(token = '') {
  if (!token) return null
  if (/^\d{1,2}$/.test(token)) {
    const n = Number(token)
    return n >= 1 && n <= 12 ? n : null
  }
  const word = normalizeForMatch(token)
  if (MONTHS_ES[word] != null) return MONTHS_ES[word]
  if (MONTHS_EN[word] != null) return MONTHS_EN[word]
  if (MONTHS_ES_SHORT[word] != null) return MONTHS_ES_SHORT[word]
  if (MONTHS_EN_SHORT[word] != null) return MONTHS_EN_SHORT[word]
  return null
}

/**
 * Resuelve una fecha desde el texto. Soporta:
 *  - ISO: 1995-03-10 / 1995/3/10 (año real)
 *  - MM-DD / MM/DD (año por defecto 2000, bisiesto → 29 feb válido)
 *  - "14 de febrero", "the 14 of february"
 *  - "marzo 10", "march 10th"
 *  - "diez de mayo", "may ten"
 * Itera TODAS las coincidencias por patrón (no solo la primera) porque en
 * "agrega la festividad del día de la madre el 10 de mayo" el primer match
 * ("festividad del dia") no resuelve día, pero "10 de mayo" sí.
 */
export function resolveDateValue(text = '') {
  const normalized = normalizeForMatch(text)
  if (!normalized) return null

  const patterns = [
    // ISO con año real
    { re: /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/g, pick: (m) => buildIsoDate(m[2], m[3], m[1]) },
    // MM-DD / MM/DD
    { re: /(\d{1,2})[-/](\d{1,2})/g, pick: (m) => buildIsoDate(m[1], m[2]) },
    // "14 de febrero", "the 14 of february", "el 10 de mayo"
    { re: /(?:^|\s)(?:el |dia |the )?([a-z0-9]+) (?:de|of|del) ([a-z]+)(?:$|\s)/g, pick: (m) => { const day = resolveDayToken(m[1]); const month = resolveMonthToken(m[2]); return day && month ? buildIsoDate(month, day) : null } },
    // "marzo 10", "march 10"
    { re: /(?:^|\s)([a-z]+) (\d{1,2})(?:$|\s)/g, pick: (m) => { const month = resolveMonthToken(m[1]); const day = resolveDayToken(m[2]); return month && day ? buildIsoDate(month, day) : null } },
    // "may ten" (palabra + palabra)
    { re: /(?:^|\s)([a-z]+) ([a-z]+)(?:$|\s)/g, pick: (m) => { const month = resolveMonthToken(m[1]); const day = resolveDayToken(m[2]); return month && day ? buildIsoDate(month, day) : null } },
  ]

  for (const { re, pick } of patterns) {
    let match
    while ((match = re.exec(normalized)) !== null) {
      const iso = pick(match)
      if (iso) return iso
    }
  }
  return null
}

// Verbos que indican intención de mutación de festividades personalizadas.
// Los verbos de REMOVE se comprueban ANTES para que "quita la festividad que
// agregué" resuelva a remove.
const MUTATION_ADD_VERBS = ['agrega', 'agregar', 'anade', 'anadir', 'crea', 'crear', 'guarda', 'guardar', 'registra', 'registrar', 'adiciona', 'adicionar', 'add', 'create', 'register', 'save']
const MUTATION_REMOVE_VERBS = ['quita', 'quitar', 'elimina', 'eliminar', 'borra', 'borrar', 'remueve', 'remover', 'saca', 'remove', 'delete']

/** Deriva el subvalor ("add" | "remove") para entradas que lo requieren. */
export function resolveConfigSubvalor(text = '', entry = {}) {
  if (!entry.requiereSubvalor) return undefined
  const normalized = normalizeForMatch(text)
  if (MUTATION_REMOVE_VERBS.some((v) => hasToken(normalized, v))) return 'remove'
  if (MUTATION_ADD_VERBS.some((v) => hasToken(normalized, v))) return 'add'
  return undefined
}

/**
 * Extrae el nombre de la festividad personalizada.
 * 1) Con marcador explícito: "llamada/llamado/nombre/called/named ...".
 * 2) Fallback: texto después del sustantivo de festividad hasta la fecha.
 */
function extractCustomEventName(normalized = '') {
  const named = normalized.match(/(?:llamada|llamado|nombre|called|named)\s+([a-z0-9 ]+?)\s+(?:(?:el |la |al |a la |el dia |dia |en el |para el |para la |for |on |the ))?(?:\d|[a-z]+\s+\d)/)
  if (named && named[1]) return normalizeForMatch(named[1])

  const nouns = CONFIG_NOUNS.customEvent || []
  let cut = -1
  let bestLen = 0
  for (const noun of nouns) {
    const idx = normalized.indexOf(noun)
    if (idx === -1) continue
    const end = idx + noun.length
    if (end > cut && noun.length > bestLen) { cut = end; bestLen = noun.length }
  }
  if (cut === -1) return null
  const rest = normalized.slice(cut)
  const m = rest.match(/^\s*(?:el |la |de |del |mi |mis |nuestra |nuestro |nuestras |nuestros )*([a-z0-9 ]+?)\s+(?:\d|[a-z]+\s+\d)/)
  return m && m[1] ? normalizeForMatch(m[1]) : null
}

/**
 * Resuelve el valor empaquetado de una festividad personalizada:
 * "nombre|MM-DD|paleta". Para "remove" la fecha NO es necesaria (el handler
 * empareja por nombre). Para "add" sin fecha no es resoluble.
 */
export function resolveCustomEventValue(text = '') {
  const normalized = normalizeForMatch(text)
  const subvalor = resolveConfigSubvalor(normalized, { requiereSubvalor: true })
  if (!subvalor) return null

  const date = resolveDateValue(normalized)
  if (subvalor === 'add' && !date) return null

  const palette = matchSeason(normalized) || 'cumpleanos'
  const name = extractCustomEventName(normalized) || palette
  const mmdd = date ? date.slice(5) : ''
  return `${name}|${mmdd}|${palette}`
}

// ------------------------------------------------------------
// Extracción de valores para tipos text / voice / color
// ------------------------------------------------------------

// Stopwords que pueden abrir el texto a extraer ("pon mi rol a profesor" → "profesor").
const TEXT_LEAD_STOPWORDS = ['a la', 'al', 'el', 'la', 'los', 'las', 'mi', 'mis', 'un', 'una', 'unos', 'unas', 'de', 'del', 'en', 'para', 'por', 'a', 'que', 'se', 'con']

/** Recorta tras el sustantivo de configuración más largo presente en el texto. */
function cutAfterLongestNoun(normalized = '', entry = {}) {
  const nouns = CONFIG_NOUNS[entry.clave] || []
  let best = null
  for (const noun of nouns) {
    const idx = normalized.indexOf(noun)
    if (idx >= 0 && (best == null || noun.length > best.noun.length)) {
      best = { noun, index: idx + noun.length }
    }
  }
  return best
}

/** Elimina stopwords iniciales del resto ("a se amable" → "amable"). */
function stripLeadingStopwords(rest = '') {
  let prev = null
  while (prev !== rest) {
    prev = rest
    for (const w of TEXT_LEAD_STOPWORDS) {
      if (rest === w) return ''
      if (rest.startsWith(`${w} `)) {
        rest = rest.slice(w.length + 1).trim()
        break
      }
    }
  }
  return rest
}

/** Extrae el valor textual tras el sustantivo ("pon la voz a esperanza" → "esperanza"). */
function extractTextValue(text = '', entry = {}) {
  const normalized = normalizeForMatch(text)
  const cut = cutAfterLongestNoun(normalized, entry)
  if (!cut) return null
  const rest = stripLeadingStopwords(normalized.slice(cut.index).trim())
  return rest || null
}

// Alias de componente del avatar para avatarColor ("pantalon" → "Bunny_pants").
const AVATAR_COMPONENT_ALIASES = {
  pantalon: 'Bunny_pants',
  pantalones: 'Bunny_pants',
  pantaloneta: 'Bunny_pants',
  cuerpo: 'Bunny_body',
  cara: 'Bunny_face',
}

// Nombres de color → hexadecimal (sin prefijo # para evitar falsos positivos tipo "cafe").
const COLOR_NAME_HEX = {
  rojo: '#FF0000', red: '#FF0000',
  verde: '#00FF00', green: '#00FF00',
  azul: '#0000FF', blue: '#0000FF',
  amarillo: '#FFFF00', yellow: '#FFFF00',
  blanco: '#FFFFFF', white: '#FFFFFF',
  negro: '#000000', black: '#000000',
  gris: '#808080', gray: '#808080', grey: '#808080',
  naranja: '#FFA500', orange: '#FFA500',
  morado: '#800080', purple: '#800080',
  rosa: '#FFC0CB', pink: '#FFC0CB',
  cafe: '#8B4513', marron: '#8B4513', brown: '#8B4513',
  turquesa: '#40E0D0', celeste: '#87CEEB', aqua: '#00FFFF', cyan: '#00FFFF',
  lima: '#32CD32', dorado: '#FFD700', gold: '#FFD700', plata: '#C0C0C0', silver: '#C0C0C0',
}

/**
 * Resuelve un valor de color: acepta "#RRGGBB"/"#RGB" o un nombre de color.
 * Para avatarColor empaqueta "componente:color" (p. ej. "Bunny_pants:#FF0000").
 */
function resolveColorValue(text = '', entry = {}) {
  const normalized = normalizeForMatch(text)
  const hexMatch = normalized.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i)
  let hex = null
  if (hexMatch) {
    hex = hexMatch[1].toUpperCase()
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
    hex = `#${hex}`
  } else {
    for (const name of Object.keys(COLOR_NAME_HEX)) {
      if (hasToken(normalized, name)) {
        hex = COLOR_NAME_HEX[name]
        break
      }
    }
  }
  if (!hex) return null
  if (entry.clave === 'avatarColor') {
    let component = 'Bunny_body'
    for (const alias of Object.keys(AVATAR_COMPONENT_ALIASES)) {
      if (hasToken(normalized, alias)) {
        component = AVATAR_COMPONENT_ALIASES[alias]
        break
      }
    }
    return `${component}:${hex}`
  }
  return hex
}

// ------------------------------------------------------------
// Resolución del contrato desde el texto transcrito
// ------------------------------------------------------------

function resolveValueForEntry(text = '', entry = {}) {
  switch (entry.tipo) {
    case 'boolean':
      return resolveBooleanValue(text)
    case 'number':
      return resolveNumberValue(text, entry)
    case 'select':
    case 'list':
      return resolveSelectValue(text, entry)
    case 'color':
      return resolveColorValue(text, entry)
    case 'text':
    case 'voice':
      return extractTextValue(text, entry)
    case 'action':
      // resetAvatarColors / clearCache: el despachador actúa; el valor es un marcador.
      return 'reset'
    case 'date':
      return resolveDateValue(text)
    case 'custom':
      return resolveCustomEventValue(text)
    default:
      return null
  }
}

/**
 * Deriva un contrato `configuracion` determinista a partir del texto transcrito.
 * Retorna `null` si no hay un comando de configuración explícito y resoluble
 * (guardia triple: verbo de directiva + sustantivo de configuración + valor).
 */
export function resolveConfigCommandFromText(text = '', _options = {}) {
  const normalized = normalizeForMatch(text)
  if (!normalized) return null

  const hasDirective = DIRECTIVE_VERBS.some((verb) => hasToken(normalized, verb))
  if (!hasDirective) return null

  const entry = findConfigEntry(normalized)
  if (!entry) return null

  // Toggle genérico del branding estacional (sustantivo estación/branding):
  //   "apaga/desactiva la estación/branding" → mode=disabled (apagado)
  //   "activa la estación de X"               → activeSeason=X (manual)
  //   "activa/enciende la estación/branding"  → mode=auto (detecta por calendario)
  if (entry.clave === 'activeSeason') {
    if (hasBrandingIntent(normalized, BRANDING_OFF_VERBS)) {
      return { accion: 'set_branding', componente: 'branding', clave: 'mode', valor: 'disabled' }
    }
    const season = matchSeason(normalized)
    if (season) {
      return { accion: 'set_branding', componente: 'branding', clave: 'activeSeason', valor: season }
    }
    if (hasBrandingIntent(normalized, BRANDING_ON_VERBS)) {
      return { accion: 'set_branding', componente: 'branding', clave: 'mode', valor: 'auto' }
    }
    return null
  }

  const valor = resolveValueForEntry(normalized, entry)
  if (valor == null) return null

  const result = {
    accion: entry.accion,
    componente: entry.accion === 'set_branding' ? 'branding' : 'config',
    clave: entry.clave,
    valor,
  }
  const subvalor = resolveConfigSubvalor(normalized, entry)
  if (subvalor) result.subvalor = subvalor
  return result
}

// ------------------------------------------------------------
// Sanitización del `configuracion` emitido por el modelo
// ------------------------------------------------------------

/**
 * Normaliza el `configuracion` crudo del modelo (objeto o JSON string) al
 * contrato estricto esperado por applyConfigAction. Retorna `null` si no es
 * válido, la clave no existe en el catálogo o el handler no está soportado.
 * @param {*} raw Configuración cruda del modelo (objeto, JSON string o null).
 */
export function normalizeConfiguracion(raw = null) {
  if (raw == null) return null

  let parsed = raw
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return null
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return null
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const accion = String(parsed.accion || '').trim()
  if (accion !== 'set_branding' && accion !== 'set_config') return null

  const clave = String(parsed.clave || '').trim()
  if (!clave) return null

  const entry = VOICE_CONFIG_CATALOG.find((e) => e.clave === clave)
  if (!entry || entry.handler === 'unsupported') return null

  const rawValor = parsed.valor
  if (rawValor == null) return null

  let valor
  if (typeof rawValor === 'boolean') {
    valor = String(rawValor)
  } else if (typeof rawValor === 'number') {
    if (!Number.isFinite(rawValor)) return null
    valor = String(rawValor)
  } else {
    valor = String(rawValor).trim()
    if (!valor) return null
  }

  const subvalor = parsed.subvalor != null ? String(parsed.subvalor).trim() : ''
  if (entry.requiereSubvalor && !subvalor) return null

  const result = {
    accion: entry.accion,
    componente: entry.accion === 'set_branding' ? 'branding' : 'config',
    clave: entry.clave,
    valor,
  }
  if (subvalor) result.subvalor = subvalor
  return result
}

/**
 * Normaliza el campo `juego` del contrato emitido por el modelo hacia el
 * contrato estricto esperado por applyGameAction. Retorna `null` si no es
 * válido, el gameId no está en el catálogo o la acción no está soportada.
 * @param {*} raw Contrato de juego crudo del modelo (objeto, JSON string o null).
 */
export function normalizeJuego(raw = null) {
  if (raw == null) return null

  let parsed = raw
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return null
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return null
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const gameId = String(parsed.gameId || parsed.juego || '').trim()
  if (!gameId || !isGameId(gameId)) return null

  const action = String(parsed.action || parsed.accion || '').trim()
  if (action !== 'start' && action !== 'turn' && action !== 'end' && action !== 'narrate') return null

  const result = {
    gameId,
    action,
  }

  const playerText = typeof parsed.playerText === 'string' ? parsed.playerText.trim() : ''
  if (action === 'turn') {
    if (!playerText) return null
    result.playerText = playerText
  } else if (playerText) {
    result.playerText = playerText
  }

  if (action === 'narrate') {
    const rawScenes = Array.isArray(parsed.narrative?.scenes) ? parsed.narrative.scenes : []
    const scenes = rawScenes
      .filter((scene) => scene && typeof scene === 'object' && typeof scene.texto === 'string' && scene.texto.trim())
      .map((scene) => {
        const normalizedScene = { texto: scene.texto.trim() }
        if (typeof scene.animacion === 'string' && scene.animacion.trim()) normalizedScene.animacion = scene.animacion.trim()
        if (typeof scene.emocion === 'string' && scene.emocion.trim()) normalizedScene.emocion = scene.emocion.trim()
        return normalizedScene
      })
    if (scenes.length === 0) return null
    result.narrative = { scenes }
  }

  return result
}
