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

import { stripWakeWord } from './wakeWord.js'

const NOTE_CREATION_PREFIX =
  /^(?:crea|crear|genera|generar|gen[ée]rame|generame|haz|hazme|hazmelo|hacer|hagame|hágame|pon|poner|guarda|guardar|anota|apunta|quiero\s+(?:crear|hacer|poner|guardar|anotar|apuntar|generar))\s+(?:una\s+|un\s+)?(?:nota|lista)\b\s*(.*)$/i
const NOTE_PARA_SUPER =
  /^nota\s+(?:(?:de|del|para|al|a|el|la|los|las|en|de\s+la|de\s+los|de\s+las|para\s+el|para\s+la|a\s+el|a\s+la)\s+)*(?:lista\s+(?:de\s+|del\s+)?)?(super|supermercado|compras|mercado)\b\s*(.*)$/i
const NOTE_SUPER_LIST =
  /^(?:apunta|anota|anade|añade|agrega|agregar|pon|poner)\s+(?:en\s+la\s+|a\s+la\s+|una\s+)?(?:lista\s+(?:de\s+)?)?(super|supermercado|compras|mercado)\b\s*(?:comprar\s*)?(.*)$/i
const NOTE_SUPER_APPEND =
  /^(?:apunta|anota|anade|añade|agrega|agregar|pon|poner)\s+(.+?)\s+(?:en\s+la\s+lista\s+del\s+|a\s+la\s+lista\s+del\s+|en\s+la\s+lista\s+de\s+la\s+|a\s+la\s+lista\s+de\s+la\s+|al\s+|a\s+la\s+|en\s+el\s+)(super|supermercado|mercado)\s*$/i
// "incluye/agrega [en] la NOTA del súper [que también traiga] {ítem}" → "Super: {ítem}".
// Cubre el destino "nota del súper" (no solo "lista") y el verbo "incluye",
// con el ítem ANTES ("incluye X en la nota del super") o DESPUÉS
// ("incluye en la nota del super que también traiga X").
const NOTE_SUPER_NOTA =
  /^(?:incluye|incluir|inclu[ií]|agrega|agregar|a[ñn]ade|anade|suma|sumar|pon|poner)\s+(?:también\s+|tambien\s+|adem[áa]s\s+)?(?:en\s+la\s+|a\s+la\s+|en\s+el\s+|al\s+)?nota\s+(?:de\s+|del\s+|para\s+el\s+|para\s+la\s+|para\s+)?(super|supermercado|compras|mercado)\b\s*(.*)$/i
// Orden DESTINO PRIMERO: "en la nota del súper incluye X" (la frase real pone el
// destino antes que el verbo). El verbo/ítem se limpia con cleanSuperItem.
const NOTE_SUPER_NOTA_DEST_FIRST =
  /^(?:en\s+la\s+|en\s+el\s+|a\s+la\s+|al\s+|de\s+la\s+|del\s+)?nota\s+(?:de\s+|del\s+|para\s+el\s+|para\s+la\s+|para\s+)?(super|supermercado|compras|mercado)\b\s*(.*)$/i
const NOTE_PARA_RECORDAR =
  /^nota\s+(?:para\s+)?(?:recordar|acordarme|acordar)\s+(?:de\s+)?(?:un\s+|una\s+|el\s+|la\s+)?(.*)$/i
const NOTE_APUNTA = /^(?:apunta|anota|anade|añade|nota)\s*[:,\-]?\s+(.+)$/i
// Nota GENERAL con contenido: "nota [que traiga/que contenga/con/sobre/para/de] X".
const NOTE_GENERAL =
  /^nota\s+(?:que\s+)?(?:traiga|trae|contenga|contiene|tenga|tiene|con|sobre|acerca\s+de|para|de)\s+(.+)$/i

// Borrado de nota por voz: "borra la nota del súper", "elimina la nota X",
// "quita la nota de compras". El destino se normaliza (súper → 'Super').
const NOTE_REMOVE =
  /^(?:borra|borrar|elimina|eliminar|quita|quitar|remueve|remover|saca|sacar|limpia|limpiar|vac[ií]a|vac[ií]ar|delete|remove|clear)\s+(?:todas?\s+las?\s+|la\s+|el\s+|las\s+|los\s+|esa\s+|esta\s+|mi\s+)?(?:notas?|listas?)\s*(?:de\s+|del\s+|de\s+la\s+|de\s+los\s+|de\s+las\s+|para\s+el\s+|para\s+la\s+|con\s+)?(.*)$/i

/** Normaliza el destino: los destinos de compras se llaman 'Super' en las notas. */
function normalizeRemoveTarget(raw = '') {
  const norm = stripAccentsEs(raw).trim()
  if (/^(?:super|supermercado|compras|mercado)\b/.test(norm)) return 'Super'
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

/** Colapsa tartamudeo ASR: "bor borra" → "borra", "bo borra" → "borra". */
function collapseStutter(text = '') {
  return String(text || '').replace(/\b(\S{1,3})\s+(?=\1\S+)/gi, '')
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
  let clean = stripWakeWord(rawText)
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
    return { label: 'Super', body: rest || undefined }
  }

  // 1b) "apunta/agrega [en la lista [de]] super …" → "Super: {resto}".
  const superList = NOTE_SUPER_LIST.exec(norm)
  if (superList) {
    const rest = superList[2] ? superList[2].trim() : ''
    return { label: rest ? `Super: ${rest}` : 'Super' }
  }

  // 1c) "agrega {ítem} a la lista del super/mercado" (ítem ANTES de la
  // lista) → "Super: {ítem}". Patrón ASR común: "agrega papel de baño a la
  // lista del super".
  const superAppend = NOTE_SUPER_APPEND.exec(norm)
  if (superAppend) {
    const rest = superAppend[1] ? superAppend[1].trim() : ''
    return { label: rest ? `Super: ${rest}` : 'Super' }
  }

  // 1d) "incluye/agrega [en] la NOTA del súper [que también traiga] {ítem}"
  // (destino "nota", no solo "lista"; verbos como "incluye").
  const superNota = NOTE_SUPER_NOTA.exec(norm)
  if (superNota) {
    const item = cleanSuperItem(superNota[2] ? superNota[2].trim() : '')
    return { label: item ? `Super: ${item}` : 'Super' }
  }

  // 1e) Orden DESTINO PRIMERO: "en la nota del súper incluye {ítem}". Mismo
  // destino "nota", mismo canonical "Super: {ítem}" (append vía el handler).
  const superNotaDestFirst = NOTE_SUPER_NOTA_DEST_FIRST.exec(norm)
  if (superNotaDestFirst) {
    const item = cleanSuperItem(superNotaDestFirst[2] ? superNotaDestFirst[2].trim() : '')
    return { label: item ? `Super: ${item}` : 'Super' }
  }

  // 2) "nota para recordar/acordarme {X}" → "Recordar: {X}".
  const paraRecordar = NOTE_PARA_RECORDAR.exec(norm)
  if (paraRecordar) {
    const rest = paraRecordar[1] ? paraRecordar[1].trim() : ''
    return { label: rest ? `Recordar: ${rest}` : 'Recordar' }
  }

  // 3) "apunta/anota/añade/nota {texto}" → el texto (sin conectores de relleno).
  const apunta = NOTE_APUNTA.exec(clean)
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

  // 4) "nota [que traiga/que contenga/con/sobre/para/de] X" → nota general:
  //     nombre por defecto "Nota" y contenido (body) = X.
  const general = NOTE_GENERAL.exec(norm)
  if (general) {
    const content = cleanSuperItem(general[1] ? general[1].trim() : '')
    if (!content) return null
    return { label: 'Nota', body: content }
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
  let clean = stripWakeWord(rawText)
  clean = collapseStutter(clean).replace(/\s+/g, ' ').trim()
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
