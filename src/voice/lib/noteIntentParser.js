// ============================================================
// noteIntentParser.js — Parser ÚNICO de notas por voz
// ============================================================
// Fuente única para convertir una frase de usuario en una etiqueta
// de nota. Antes esta lógica estaba duplicada en deterministicArbiter.js
// y en App.__fluHandleNoteText (ruta doble → riesgo de divergencia).
// Cubre: prefijos de creación ("crea una nota X"), "para el super",
// "en la lista [de] super/mercado", "para recordar X", y
// "apunta/anota/añade/nota {texto}" (sin conectores de relleno).
// ============================================================


import { normalizeSpokenCommand } from './audioMath.js'
import { SUPER_TARGET_LABEL } from '../../core/notes/superNoteTarget'

const NOTE_CREATION_PREFIX =
  /^(?:crea|crear|genera|generar|gen[ée]rame|generame|haz|hazme|hazmelo|hacer|hagame|hágame|pon|poner|guarda|guardar|anota|apunta|quiero\s+(?:crear|hacer|poner|guardar|anotar|apuntar|generar))\s+(?:una\s+|un\s+)?(?:nota|lista)\b\s*(.*)$/i
const NOTE_PARA_SUPER =
  /^nota\s+(?:(?:de|del|para|al|a|el|la|los|las|en|de\s+la|de\s+los|de\s+las|para\s+el|para\s+la|a\s+el|a\s+la)\s+)*(?:lista\s+(?:de\s+|del\s+)?)?(super|supermercado|compras|mercado)\b\s*(.*)$/i
// Sinónimos de AÑADIR a una nota: fuente ÚNICA. Estaban repetidos y
// desalineados en tres regexes, así que añadir un sinónimo en uno dejaba mudos
// los otros: "adiciona en la nota del súper focos" no lo entendía NINGUNO y la
// orden se perdía en silencio (solo entraba el ítem cuyo verbo sí estaba en la
// tabla). Un verbo nuevo se añade AQUÍ y lo ven los tres.
// Los regexes corren sobre texto ya sin acentos (stripAccentsEs), así que la
// forma viva es "anade"; "añade" se conserva por claridad de la tabla.
const NOTE_ADD_VERBS =
  'apunta|anota|anade|añade|agrega|agregar|adiciona|adicionar|incluye|incluir|inclu[ií]|suma|sumar|pon|poner'
const NOTE_SUPER_LIST = new RegExp(
  `^(?:${NOTE_ADD_VERBS})\\s+(?:en\\s+la\\s+|a\\s+la\\s+|una\\s+)?(?:lista\\s+(?:de\\s+|del\\s+|de\\s+la\\s+)?)?(super|supermercado|compras|mercado)\\b\\s*(?:comprar\\s*)?(.*)$`,
  'i',
)
const NOTE_SUPER_APPEND = new RegExp(
  `^(?:${NOTE_ADD_VERBS})\\s+(.+?)\\s+(?:en\\s+la\\s+(?:lista|nota)\\s+del\\s+|a\\s+la\\s+(?:lista|nota)\\s+del\\s+|en\\s+la\\s+(?:lista|nota)\\s+de\\s+(?:la\\s+)?|a\\s+la\\s+(?:lista|nota)\\s+de\\s+(?:la\\s+)?|al\\s+|a\\s+la\\s+|en\\s+el\\s+)(super|supermercado|compras|mercado)\\s*$`,
  'i',
)
// "incluye/agrega/adiciona [en] la NOTA del súper [que también traiga] {ítem}"
// → "Super: {ítem}". Cubre el destino "nota del súper" (no solo "lista"),
// con el ítem ANTES ("incluye X en la nota del super") o DESPUÉS
// ("incluye en la nota del super que también traiga X").
const NOTE_SUPER_NOTA = new RegExp(
  `^(?:${NOTE_ADD_VERBS})\\s+(?:también\\s+|tambien\\s+|adem[áa]s\\s+)?(?:en\\s+la\\s+|a\\s+la\\s+|en\\s+el\\s+|al\\s+|la\\s+|el\\s+)?nota\\s+(?:de\\s+|del\\s+|para\\s+el\\s+|para\\s+la\\s+|para\\s+)?(super|supermercado|compras|mercado)\\b\\s*(.*)$`,
  'i',
)
// Orden DESTINO PRIMERO: "en la nota del súper incluye X" (la frase real pone el
// destino antes que el verbo). El verbo/ítem se limpia con cleanSuperItem.
const NOTE_SUPER_NOTA_DEST_FIRST =
  /^(?:en\s+la\s+|en\s+el\s+|a\s+la\s+|al\s+|de\s+la\s+|del\s+)?nota\s+(?:de\s+|del\s+|para\s+el\s+|para\s+la\s+|para\s+)?(super|supermercado|compras|mercado)\b\s*(.*)$/i
const NOTE_PARA_RECORDAR =
  /^nota\s+(?:para\s+)?(?:recordar|acordarme|acordar)\s+(?:de\s+)?(?:un\s+|una\s+|el\s+|la\s+)?(.*)$/i
// Nota GENERAL con contenido: "nota [que traiga/que contenga/con/sobre/para/de] X".
const NOTE_GENERAL =
  /^nota\s+(?:que\s+)?(?:traiga|trae|contenga|contiene|tenga|tiene|con|sobre|acerca\s+de|para|de)\s+(.+)$/i

// ------------------------------------------------------------
// ALTA GENERAL con destino "nota" (no la lista del súper).
// Faltaba por completo: con la lotería abierta, "agrega guitarra en la nota" NO
// lo reconocía ningún dominio y el JUEGO lo tomaba como jugada (respondía "La
// carta es…"). El verbo sale de NOTE_ADD_VERBS (fuente única) y, para una nota
// general, se excluye "pon/poner" (demasiado amplio: "pon la mesa" no es nota).
// ------------------------------------------------------------
const NOTE_ADD_VERBS_NARROW = NOTE_ADD_VERBS
  .split('|')
  .filter((verbo) => !/^pon/.test(verbo))
  .join('|')
// Relleno entre "nota" y el ítem: "en la nota ADICIONAL guitarra", "en la nota nota X".
const NOTE_FILLER =
  '(?:adicional(?:e)?|extras?|nuev[ao]s?|mism[ao]s?|esa|este?|la|el|nota|notas)'
// Ítem ANTES del destino: "agrega guitarra en la nota [nota]".
const NOTE_GENERAL_APPEND = new RegExp(
  `^(?:${NOTE_ADD_VERBS_NARROW})\\s+(?:el\\s+|la\\s+|los\\s+|las\\s+|un\\s+|una\\s+)?(.+?)\\s+(?:en\\s+la\\s+|a\\s+la\\s+|en\\s+el\\s+|al\\s+)(?:nota|notas)\\b(?:\\s+${NOTE_FILLER})*\\s*$`,
  'i',
)
// Destino PRIMERO: "en la nota [adicional] {ítem}".
const NOTE_GENERAL_DEST_FIRST = new RegExp(
  `^(?:en\\s+la\\s+|en\\s+el\\s+|a\\s+la\\s+|al\\s+)(?:nota|notas)\\b(?:\\s+${NOTE_FILLER})*\\s+(.+)$`,
  'i',
)
// "apunta {texto}" con los MISMOS verbos de alta (antes solo 4 literales, así que
// "agrega guitarra" se perdía). Sin "pon": esa forma va por la creación explícita.
const NOTE_APUNTA_ADD = new RegExp(
  `^(?:${NOTE_ADD_VERBS_NARROW}|nota)\\s*[:,\\-]?\\s+(.+)$`,
  'i',
)

// Borrado de nota por voz: "borra la nota del súper", "elimina la nota X",
// "quita la nota de compras". El destino se normaliza (súper → 'Super').
const NOTE_REMOVE =
  /^(?:borra|borrar|elimina|eliminar|quita|quitar|remueve|remover|saca|sacar|limpia|limpiar|vac[ií]a|vac[ií]ar|delete|remove|clear)\s+(?:todas?\s+las?\s+|la\s+|el\s+|las\s+|los\s+|esa\s+|esta\s+|mi\s+)?(?:notas?|listas?)\s*(?:de\s+|del\s+|de\s+la\s+|de\s+los\s+|de\s+las\s+|para\s+el\s+|para\s+la\s+|con\s+)?(.*)$/i

// Quitar UN ITEM de una nota: "borra el cloro de la nota del súper" y
// "borra de la nota del súper el cloro" (destino primero, ítem al final).
// Capacidad que FALTABA: solo existían alta y borrado de la nota COMPLETA, así
// que esta orden o borraba la lista entera o la secuestraba el juego como
// jugada. El verbo y el destino salen de la MISMA tabla que el resto de notas.
const NOTE_REMOVE_VERBS = 'borra|borrar|elimina|eliminar|quita|quitar|saca|sacar|remueve|remover'
// Ítem ANTES del destino: "quita {ítem} de la nota/lista del {destino}".
const NOTE_ITEM_FIRST = new RegExp(
  `^(?:${NOTE_REMOVE_VERBS})\\s+(?:el\\s+|la\\s+|los\\s+|las\\s+|un\\s+|una\\s+)?(.+?)\\s+de\\s+(?:la\\s+|las\\s+|el\\s+|los\\s+)?(?:notas?|listas?)\\s+(?:de\\s+|del\\s+|de\\s+la\\s+)?([a-z]+)\\s*$`,
  'i',
)
// Destino ANTES del ítem: "borra de la(s) nota(s) del {destino} {ítem}".
const NOTE_ITEM_DEST_FIRST = new RegExp(
  `^(?:${NOTE_REMOVE_VERBS})\\s+de\\s+(?:la\\s+|las\\s+|el\\s+|los\\s+)?(?:notas?|listas?)\\s+(?:de\\s+|del\\s+|de\\s+la\\s+)?([a-z]+)\\s+(?:el\\s+|la\\s+|los\\s+|las\\s+|un\\s+|una\\s+)?(.+?)\\s*$`,
  'i',
)

/** Normaliza el destino: los destinos de compras se llaman 'Super' en las notas. */
function normalizeRemoveTarget(raw = '') {
  const norm = stripAccentsEs(raw).trim()
  if (/^(?:super|supermercado|compras|mercado)\b/.test(norm)) return SUPER_TARGET_LABEL
  return String(raw || '').trim()
}

function stripAccentsEs(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[áàäâ]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/[ñ]/g, 'n')
}

// Verbos/conectores de relleno que pueden preceder al ítem cuando se enuncia
// después del destino: "… la nota del súper QUE TAMBIÉN TRAIGA una computadora".
const SUPER_ITEM_LEAD =
  /^(?:que\s+)?(?:también\s+|tambien\s+|adem[áa]s\s+)?(?:traiga|trae|traer|lleva|llevar|compra|comprar|integra|integrar|mete|meter|agrega|agregar|a[ñn]ade|a[ñn]adir|incluye|incluir|suma|sumar|pon|poner|con)\s+/i

// Fecha relativa que precede al ítem ("para mañana y …", "de hoy …"): no es
// parte del contenido de la nota. Dictado natural de niños.
const SUPER_DATE_LEAD =
  /^(?:para\s+|de\s+|el\s+)?(?:hoy|ma[ñn]ana|pasado\s+ma[ñn]ana|esta\s+(?:tarde|noche)|lunes|martes|mi[eé]rcoles|jueves|viernes|s[áa]bado|domingo)\s*(?:y\s+)?/i

// Destino redundante dentro de la nota ("en las notas que traiga X"): no es
// parte del contenido.
const SUPER_NOTE_DEST_LEAD = /^(?:en\s+las?\s+|a\s+las?\s+)?(?:notas?|listas?)\s*/i

// Marcadores de CONTENIDO: "cuyo contenido sea/contenga/traiga X", "contenido: X",
// "que traiga/contenga/tenga X". Separan el nombre del contenido de la nota.
const SUPER_CONTENT_MARKER = /^(?:(?:cuyo|su)\s+)?(?:contenido|contenidos|art[ií]culos|productos|cosas)\s+(?:sea|es|son|:|contenga|contener|incluya|incluir|traiga|traer|tenga|tener|de)\s*/i

/** Limpia el ítem de una nota "Super": quita fecha relativa y verbos líderes. */
function cleanSuperItem(rest = '') {
  let item = String(rest || '').trim()
  let prev = ''
  while (item !== prev) {
    prev = item
    item = item.replace(SUPER_DATE_LEAD, '').trim()
    item = item.replace(SUPER_NOTE_DEST_LEAD, '').trim()
    item = item.replace(SUPER_CONTENT_MARKER, '').trim()
    const m = SUPER_ITEM_LEAD.exec(item)
    if (m) item = item.slice(m[0].length).trim()
  }
  return item
}

/**
 * Parsea una frase de nota y devuelve { label } o null si no es una nota.
 * Texto esperado SIN el "ok flu" (si llegara con wake, se limpia aquí).
 */
export function parseNoteIntentText(rawText = '') {
  // §9.2: normalización compartida (wake + tartamudeo) en la entrada pública.
  let clean = normalizeSpokenCommand(rawText)
  // Artículo inicial antes de "nota": "una nota del super …" → "nota del super …".
  clean = clean.replace(/^(?:una|un|la|el|mi)\s+(?=notas?\b)/i, '').trim()
  if (!clean) return null

  // 0) Prefijos de creación explícita → forma canónica "nota ...".
  const creationMatch = NOTE_CREATION_PREFIX.exec(clean)
  let normalized = clean
  if (creationMatch) {
    const rest = creationMatch[1] ? creationMatch[1].trim() : ''
    normalized = rest ? `nota ${rest}` : 'nota'
  }
  const norm = stripAccentsEs(normalized)

  // 1) "nota para el super/supermercado/compras/mercado" → nombre "Super" +
  //    contenido (body) separado del título (lista de compras, no un chorizo).
  const paraSuper = NOTE_PARA_SUPER.exec(norm)
  if (paraSuper) {
    const rest = cleanSuperItem(paraSuper[2] ? paraSuper[2].trim() : '')
    return { label: SUPER_TARGET_LABEL, body: rest || undefined }
  }

  // 1b) "apunta/agrega [en la lista [de]] super …" → "Super: {resto}".
  const superList = NOTE_SUPER_LIST.exec(norm)
  if (superList) {
    const rest = superList[2] ? superList[2].trim() : ''
    return { label: SUPER_TARGET_LABEL, body: rest || undefined }
  }

  // 1c) "agrega {ítem} a la lista del super/mercado" (ítem ANTES de la
  // lista) → "Super: {ítem}". Patrón ASR común: "agrega papel de baño a la
  // lista del super".
  const superAppend = NOTE_SUPER_APPEND.exec(norm)
  if (superAppend) {
    const rest = superAppend[1] ? superAppend[1].trim() : ''
    return { label: SUPER_TARGET_LABEL, body: rest || undefined }
  }

  // 1d) "incluye/agrega [en] la NOTA del súper [que también traiga] {ítem}"
  // (destino "nota", no solo "lista"; verbos como "incluye").
  const superNota = NOTE_SUPER_NOTA.exec(norm)
  if (superNota) {
    const item = cleanSuperItem(superNota[2] ? superNota[2].trim() : '')
    return { label: SUPER_TARGET_LABEL, body: item || undefined }
  }

  // 1e) Orden DESTINO PRIMERO: "en la nota del súper incluye {ítem}". Mismo
  // destino "nota", mismo canonical "Super: {ítem}" (append vía el handler).
  const superNotaDestFirst = NOTE_SUPER_NOTA_DEST_FIRST.exec(norm)
  if (superNotaDestFirst) {
    const item = cleanSuperItem(superNotaDestFirst[2] ? superNotaDestFirst[2].trim() : '')
    return { label: SUPER_TARGET_LABEL, body: item || undefined }
  }

  // 2) "nota para recordar/acordarme {X}" → "Recordar: {X}".
  const paraRecordar = NOTE_PARA_RECORDAR.exec(norm)
  if (paraRecordar) {
    const rest = paraRecordar[1] ? paraRecordar[1].trim() : ''
    return { label: rest ? `Recordar: ${rest}` : 'Recordar' }
  }

  // 3) Nota GENERAL con contenido: se evalua ANTES de NOTE_APUNTA. Si no,
  //    "nota que traiga X" lo capturaba NOTE_APUNTA y el nombre quedaba en
  //    "traiga X" (nombre equivocado).
  const general = NOTE_GENERAL.exec(norm)
  if (general) {
    const content = cleanSuperItem(general[1] ? general[1].trim() : '')
    if (!content) return null
    return { label: 'Nota', body: content }
  }
  // 3b) ALTA GENERAL con destino "nota": ítem antes ("agrega guitarra en la nota
  //     [nota]") o destino primero ("en la nota [adicional] guitarra"). Va ANTES
  //     del apunta genérico para que "agrega X en la nota" no deje el destino
  //     dentro del nombre ("guitarra en la nota").
  const generalAppend = NOTE_GENERAL_APPEND.exec(norm)
  if (generalAppend) {
    const item = cleanSuperItem(generalAppend[1] ? generalAppend[1].trim() : '')
    if (item) return { label: 'Nota', body: item }
  }
  const generalDestFirst = NOTE_GENERAL_DEST_FIRST.exec(norm)
  if (generalDestFirst) {
    const item = cleanSuperItem(generalDestFirst[1] ? generalDestFirst[1].trim() : '')
    if (item) return { label: 'Nota', body: item }
  }
  // 4) "apunta/anota/anade/agrega/adiciona {texto}" -> el texto (sin relleno).
  const apunta = NOTE_APUNTA_ADD.exec(clean)
  if (apunta) {
    const label = apunta[1]
      ? apunta[1]
          .trim()
          .replace(/^que\s+tengo\s+que\s+/i, '')
          .replace(/^que\s+/i, '')
          .trim()
      : ''
    if (!label) return null
    return { label }
  }
  // 5) Prefijo de CREACION explicito sin rama especifica: "crea/guarda una nota
  //    X" -> nota general "Nota" con contenido X. El prefijo YA declara la
  //    intencion (verbo + nota/lista): no hay sobrecaptura, solo cubre lo que el
  //    propio prefijo prometia y antes se perdia (devolvia null).
  if (creationMatch) {
    const content = cleanSuperItem(creationMatch[1] ? creationMatch[1].trim() : '')
    if (content) return { label: 'Nota', body: content }
  }
  return null
}


/**
 * Parsea una frase de BORRADO de nota y devuelve { target, all } o null.
 * - { target, all:false } → borrar UNA nota por destino.
 * - { target:null, all:true } → borrar TODAS las notas.
 * Fuente única del reconocimiento de "borra/elimina/quita la nota X".
 */
export function parseNoteRemoveIntentText(rawText = '') {
  // §9.2: normalización compartida (wake + tartamudeo) en la entrada pública.
  const clean = normalizeSpokenCommand(rawText)
  if (!clean) return null
  const m = NOTE_REMOVE.exec(clean)
  if (!m) return null
  const target = normalizeRemoveTarget(m[1] ? m[1].trim() : '')
  if (target) return { target, all: false }
  // Sin destino: vaciado SOLO si es inequívoco:
  //   - marcador de totalidad ("todas/todo/completa/entera"), o
  //   - verbo de vaciado ("limpia/vacía/clear"), o
  //   - verbo destructivo sobre el PLURAL ("borra/elimina/quita las notas").
  // El singular sin destino ("borra la nota") sigue siendo ambiguo → null.
  const pluralNotes = /\b(?:notas|listas)\b/i.test(clean)
  const destructiveVerb =
    /\b(?:borra|borrar|elimina|eliminar|quita|quitar|remueve|remover|saca|sacar|delete|remove)\b/i.test(clean)
  if (
    /\b(?:todas?|todos?|todo|completa?|entera?)\b/i.test(clean) ||
    /\b(?:limpia|limpiar|vac[ií]a|vac[ií]ar|clear)\b/i.test(clean) ||
    (pluralNotes && destructiveVerb)
  ) {
    return { target: null, all: true }
  }
  return null
}

/**
 * Predicado UNICO: ¿el texto es un comando de notas (crear, borrar o quitar
 * ítem)? Fuente unica para el passthrough de OTROS dominios: con una partida
 * activa el juego no debe secuestrar un comando de notas como si fuera una
 * jugada. Antes el passthrough solo reconocia el alta, asi que "borra la nota
 * del super" (y menos aun "borra el cloro de la nota del super") con la loteria
 * activa caia al motor y FLU cantaba una carta.
 */
export function isNoteCommand(rawText = '') {
  return (
    Boolean(parseNoteIntentText(rawText)?.label) ||
    Boolean(parseNoteRemoveIntentText(rawText)) ||
    Boolean(parseNoteItemRemoveIntentText(rawText))
  )
}

/**
 * Parsea una frase que QUITA un ITEM concreto de una nota ("borra el cloro de la
 * nota del súper", "borra de la nota del súper el cloro") y devuelve
 * { label, item } o null. `label` se normaliza (súper -> 'Super'); `item` va sin
 * el articulo inicial, igual que los items de la lista.
 */
export function parseNoteItemRemoveIntentText(rawText = '') {
  let clean = normalizeSpokenCommand(rawText)
  clean = clean.replace(/^(?:una|un|la|el|mi)\s+(?=notas?\b)/i, '').trim()
  if (!clean) return null
  const norm = stripAccentsEs(clean)
  const destFirst = NOTE_ITEM_DEST_FIRST.exec(norm)
  const match = destFirst || NOTE_ITEM_FIRST.exec(norm)
  if (!match) return null
  const destWord = (destFirst ? match[1] : match[2]) || ''
  const rawItem = (destFirst ? match[2] : match[1]) || ''
  const item = String(rawItem)
    .trim()
    .replace(/^(?:el|la|los|las|un|una)\s+/i, '')
    .trim()
  if (!item) return null
  const label = normalizeRemoveTarget(destWord)
  if (!label) return null
  return { label, item }
}

/**
 * Deriva la intencion de voz de notas (alta / borrado / quitar item) de un texto
 * crudo, con la MISMA fuente unica de parseo. Devuelve { action, data } o null.
 * Lo usa el handler de voz para su ruta cruda (E2E/integracion/autonomo), para
 * que no haya regex paralelas en App.
 */
export function resolveNoteVoiceIntent(rawText = '') {
  const raw = String(rawText || '').trim()
  const itemRemoval = parseNoteItemRemoveIntentText(raw)
  if (itemRemoval) {
    return { action: 'notes.removeItem', data: { label: itemRemoval.label, item: itemRemoval.item } }
  }
  const removal = parseNoteRemoveIntentText(raw)
  if (removal) {
    if (removal.all) return { action: 'notes.clear', data: {} }
    return removal.target ? { action: 'notes.remove', data: { target: removal.target } } : null
  }
  const parsed = parseNoteIntentText(raw)
  if (!parsed || !parsed.label) return null
  return { action: 'notes.add', data: { label: parsed.label, body: parsed.body } }
}

// ------------------------------------------------------------
// Superficie de comandos de notas PUBLICADA como dato.
// Fuente unica de lo que el parser declara entender, con una frase testigo por
// capacidad. El invariante derivado comprueba que TODA capacidad declarada se
// entiende de verdad (mismo contrato que los motores de juego): "declarado pero
// no entendido" es deriva. No altera el comportamiento del parser.
// `espera` describe la forma del resultado esperado y la evalua el test.
// ------------------------------------------------------------
export const NOTE_COMMAND_SURFACE = Object.freeze([
  {
    id: 'creacion',
    parser: 'nota',
    frases: [
      'crea una nota comprar leche',
      'guarda una lista de la compra',
      'quiero crear una nota para la fiesta',
    ],
    espera: { label: 'no-vacio' },
  },
  {
    id: 'super-prefijo',
    parser: 'nota',
    frases: ['nota del super leche y pan'],
    espera: { label: SUPER_TARGET_LABEL, body: 'no-vacio' },
  },
  {
    id: 'super-lista',
    parser: 'nota',
    frases: ['apunta en la lista del super, leche y pan'],
    espera: { label: SUPER_TARGET_LABEL, body: 'no-vacio' },
  },
  {
    id: 'super-append',
    parser: 'nota',
    frases: ['apunta leche en la lista del super'],
    espera: { label: SUPER_TARGET_LABEL, body: 'no-vacio' },
  },
  {
    id: 'super-nota',
    parser: 'nota',
    frases: ['incluye en la nota del super que tambien traiga leche'],
    espera: { label: SUPER_TARGET_LABEL, body: 'no-vacio' },
  },
  {
    id: 'super-nota-destino-primero',
    parser: 'nota',
    frases: ['en la nota del super incluye leche'],
    espera: { label: SUPER_TARGET_LABEL, body: 'no-vacio' },
  },
  {
    id: 'recordar',
    parser: 'nota',
    frases: ['nota para recordar llamar a mama'],
    espera: { label: 'prefijo:Recordar' },
  },
  {
    id: 'apunta',
    parser: 'nota',
    frases: ['apunta comprar pan'],
    espera: { label: 'no-vacio' },
  },
  {
    id: 'general',
    parser: 'nota',
    frases: ['nota que traiga leche'],
    espera: { label: 'Nota', body: 'no-vacio' },
  },
  {
    id: 'item-removal',
    parser: 'removeItem',
    frases: [
      'borra el cloro de la nota del super',
      'borra de la nota del super el cloro',
      'quita el pan de la lista del supermercado',
    ],
    espera: { label: SUPER_TARGET_LABEL, item: 'no-vacio' },
  },
  {
    id: 'borrado-uno',
    parser: 'remove',
    frases: ['borra la nota del super'],
    espera: { all: false, target: SUPER_TARGET_LABEL },
  },
  {
    id: 'borrado-todo',
    parser: 'remove',
    frases: ['borra todas las notas', 'borra las notas'],
    espera: { all: true, target: null },
  },
])
