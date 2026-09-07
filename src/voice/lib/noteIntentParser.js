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

const WAKE_LEAD = /^(?:ok\s*flu|okay\s*flow|hey\s*flu|flu|ok\s*flow)[,.\s]*/i
const NOTE_CREATION_PREFIX =
  /^(?:crea|crear|genera|generar|gen[ée]rame|generame|haz|hacer|pon|poner|guarda|guardar|anota|apunta|quiero\s+(?:crear|hacer|poner|guardar|anotar|apuntar|generar))\s+(?:una\s+|un\s+)?nota\b\s*(.*)$/i
const NOTE_PARA_SUPER =
  /^nota\s+(?:para|de)\s+(?:(?:ir\s+)?(?:al|a\s+el|a\s+la|a\s+lo)\s+|el\s+|la\s+|lo\s+)?(super|supermercado|compras|mercado)\b\s*(.*)$/i
const NOTE_SUPER_LIST =
  /^(?:apunta|anota|anade|añade|agrega|agregar|pon|poner)\s+(?:en\s+la\s+|a\s+la\s+|una\s+)?(?:lista\s+(?:de\s+)?)?(super|supermercado|compras|mercado)\b\s*(?:comprar\s*)?(.*)$/i
const NOTE_PARA_RECORDAR =
  /^nota\s+(?:para\s+)?(?:recordar|acordarme|acordar)\s+(?:de\s+)?(?:un\s+|una\s+|el\s+|la\s+)?(.*)$/i
const NOTE_APUNTA = /^(?:apunta|anota|anade|añade|nota)\s*[:,\-]?\s+(.+)$/i

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

/**
 * Parsea una frase de nota y devuelve { label } o null si no es una nota.
 * Texto esperado SIN el "ok flu" (si llegara con wake, se limpia aquí).
 */
export function parseNoteIntentText(rawText = '') {
  let clean = String(rawText || '').trim()
  clean = clean.replace(WAKE_LEAD, ' ').trim()
  if (!clean) return null

  // 0) Prefijos de creación explícita → forma canónica "nota ...".
  const creationMatch = NOTE_CREATION_PREFIX.exec(clean)
  let normalized = clean
  if (creationMatch) {
    const rest = creationMatch[1] ? creationMatch[1].trim() : ''
    normalized = rest ? `nota ${rest}` : 'nota'
  }
  const norm = stripAccentsEs(normalized)

  // 1) "nota para el super/supermercado/compras/mercado" → "Super: {resto}".
  const paraSuper = NOTE_PARA_SUPER.exec(norm)
  if (paraSuper) {
    const rest = paraSuper[2] ? paraSuper[2].trim() : ''
    return { label: rest ? `Super: ${rest}` : 'Super' }
  }

  // 1b) "apunta/agrega [en la lista [de]] super …" → "Super: {resto}".
  const superList = NOTE_SUPER_LIST.exec(norm)
  if (superList) {
    const rest = superList[2] ? superList[2].trim() : ''
    return { label: rest ? `Super: ${rest}` : 'Super' }
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

  return null
}
