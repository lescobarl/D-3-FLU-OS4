/**
 * COMPARADOR de la FUENTE contra lo observado.
 *
 * La fuente (`turns.ndjson`, `kind === "commit"`) NO es un golden: la sesion real ya
 * trae duplicados y variantes de grafia del ASR. Este modulo mide:
 *  - filas UNICAS de la fuente sin contrapartida (missing) y filas sobrantes (extra);
 *  - variantes del MISMO tramo (se declaran, no fallan);
 *  - LOCUCIONES con 2+ etiquetas (una locucion es UNA voz);
 *  - TRIAGE de cada missing/extra con evidencia documental.
 *
 * El modo `events` (filas + caja) se retiro con la tuberia vieja de conversacion: el
 * producto mide con `npm run playback` y los tests del modulo.
 */

/**
 * Texto normalizado para comparar (sin acentos, minusculas, solo letras/numeros).
 * @param {string} texto
 * @returns {string}
 */
export function normalizarFila(texto = '') {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Similitud de DOS textos ya normalizados: `1 - distancia/maxLongitud` (Levenshtein).
 * Mide VARIANTES DE GRAFIA de la misma locucion ("claud" vs "cloud"), no contenido.
 * @param {string} a
 * @param {string} b
 * @returns {number} 0..1
 */
export function similitudDeTextos(a = '', b = '') {
  const x = String(a || '')
  const y = String(b || '')
  if (!x && !y) return 1
  if (!x || !y) return 0
  let previa = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i += 1) {
    const actual = [i]
    for (let j = 1; j <= y.length; j += 1) {
      const coste = x[i - 1] === y[j - 1] ? 0 : 1
      actual[j] = Math.min(previa[j] + 1, actual[j - 1] + 1, previa[j - 1] + coste)
    }
    previa = actual
  }
  return 1 - previa[y.length] / Math.max(x.length, y.length)
}

/**
 * Son el MISMO TRAMO? (prefijo comun de `minVariantWords` palabras, o un texto contenido
 * en el otro). Es la pregunta ESTRICTA: empareja filas para decidir PERDIDA, asi que no
 * admite parecidos vagos.
 * @param {string} ka texto normalizado
 * @param {string} kb texto normalizado
 * @param {number} minVariantWords
 * @returns {boolean}
 */
function esMismoTramo(ka, kb, minVariantWords) {
  const palabras = (key) => String(key || '').split(' ').filter(Boolean)
  const pa = palabras(ka)
  const pb = palabras(kb)
  let i = 0
  while (i < pa.length && i < pb.length && pa[i] === pb[i]) i += 1
  return i >= minVariantWords || String(ka).includes(String(kb)) || String(kb).includes(String(ka))
}

/**
 * Son la MISMA LOCUCION? = mismo tramo (estricto) o la MISMA grafia con otra escritura del
 * ASR (`similitudMinima`). Unica definicion: la usan el emparejamiento de variantes y la
 * justificacion de filas EXTRA.
 * @param {string} a texto original
 * @param {string} b texto original
 * @param {{ minVariantWords?: number, similitudMinima?: number }} [options]
 * @returns {boolean}
 */
export function esMismaLocucion(a = '', b = '', { minVariantWords = 2, similitudMinima = 0.7 } = {}) {
  const ka = normalizarFila(a)
  const kb = normalizarFila(b)
  if (!ka || !kb) return false
  if (esMismoTramo(ka, kb, Math.max(1, Math.floor(Number(minVariantWords) || 2)))) return true
  return similitudDeTextos(ka, kb) >= Number(similitudMinima)
}

/**
 * LOCUCIONES con MAS DE UNA etiqueta de hablante en la FUENTE.
 *
 * Una locucion es UNA voz: si la misma frase aparece en la grabacion con dos etiquetas, una
 * de las dos es falsa. Defecto MEDIDO (7fce0045, 2026-10-23): 8 locuciones con dos etiquetas;
 * `#54/#55` ("qué hija las cosas hija déjame acompañarte por favor") sale "Hablante 2" y,
 * 4,5 s despues, la misma captura se commitea otra vez como "Hablante 1", y el preflight
 * asincrono de ESA segunda fila la reescribe a "Luis Registrado". Una locucion, tres etiquetas.
 *
 * SE MIDE, NO SE CORRIGE AQUI: el Anexo B.14 prohibe tocar la deduplicacion para "arreglar"
 * repeticiones (la dedupe de emision identica rompio turnos legitimos). El numero queda en el
 * reporte para que la decision de producto sea del dueno.
 *
 * @param {Array<{ text?: string, speaker?: string }>} rows filas de la fuente (commits)
 * @returns {Array<{ text: string, labels: string[], indices: number[] }>}
 */
export function locucionesConEtiquetasDistintas(rows = []) {
  const porTexto = new Map()
  ;(Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const key = normalizarFila(row?.text)
    if (!key) return
    if (!porTexto.has(key)) porTexto.set(key, [])
    porTexto.get(key).push({ index, label: String(row?.speaker || '').trim(), text: String(row?.text || '') })
  })
  const salida = []
  for (const [, filas] of porTexto) {
    const labels = [...new Set(filas.map((fila) => fila.label).filter(Boolean))]
    if (labels.length < 2) continue
    salida.push({ text: filas[0].text, labels, indices: filas.map((fila) => fila.index) })
  }
  return salida
}

/**
 * TRIAGE de la fuente (mandato del dueno 2026-10-23, SIN reclassificaciones): cada
 * missing/extra se clasifica con PRUEBA documental de la fuente.
 *
 *  - `missing`: la fuente escribio una fila que el replay no. El UNICO artefacto admitido es
 *    que la fuente haya escrito ESA MISMA frase mas de una vez (duplicado EXACTO, con sus
 *    ids): entonces lo que falta es una copia. Cualquier otro caso es `bug-perdida`.
 *  - `extra`: el replay escribio una fila que la fuente no. El UNICO artefacto admitido es
 *    que la fuente tenga una fila con ESE MISMO texto (duplicado exacto con su id). Cualquier
 *    otro caso es `bug-invencion`: "el ASR lo dijo" NO justifica una fila.
 *
 * Se retiraron las clases que absolvian por definicion (`cola-sin-final`, `habla-del-asr`,
 * `mixtura-del-asr`, `particion-hipotesis`, `mezcla-de-hipotesis`).
 *
 * @param {Array<{ text?: string }>} missing
 * @param {Array<{ text?: string }>} extra
 * @param {{ sourceRows?: Array<{ id?: number|string|null, text?: string }> }} [asrDigest]
 * @param {Array<{ text?: string }>} [observedRows]
 * @returns {{ missing: Array<object>, extra: Array<object>, unclassifiedMissing: number, unclassifiedExtra: number, bugsMissing: number, bugsExtra: number }}
 */
export function clasificarFuente(missing = [], extra = [], asrDigest = {}, observedRows = []) {
  const fuente = (asrDigest?.sourceRows || []).map((fila) => ({
    id: fila?.id ?? fila?.t ?? null,
    key: normalizarFila(fila?.text),
  })).filter((fila) => fila.key)
  const porTexto = new Map()
  for (const fila of fuente) {
    const lista = porTexto.get(fila.key) || []
    lista.push(fila.id)
    porTexto.set(fila.key, lista)
  }
  const filasMissing = (missing || []).map((fila) => {
    const texto = String(fila?.text || '')
    const key = normalizarFila(texto)
    const ids = porTexto.get(key) || []
    // La copia de la fuente solo explica el missing si el replay ESCRIBIO esa frase al menos
    // una vez. Con CERO filas en el replay no hay copia que explicar: se perdieron todas.
    const enReplay = (observedRows || []).filter((fila) => normalizarFila(fila?.text) === key).length
    // UNICO artefacto admitido: la fuente ESCRIBIO ESA MISMA FRASE MAS DE UNA VEZ (duplicado
    // exacto, con sus ids) Y el replay la tiene. Entonces la que "falta" es la copia.
    if (ids.length > 1 && enReplay > 0) {
      return {
        text: texto,
        clase: 'duplicado-exacto-de-fuente',
        ids,
        evidencia: `la fuente tiene ${ids.length} filas con ESTE MISMO texto (ids ${ids.join(', ')}): la que falta es una copia`,
      }
    }
    return {
      text: texto,
      clase: 'bug-perdida',
      ids,
      evidencia: ids.length
        ? `la fuente tiene ${ids.length} fila(s) con este texto (ids ${ids.join(', ')}) y el replay ${enReplay} fila(s): no hay copia que explique la perdida`
        : 'la fuente escribio esta locucion y el replay no la tiene',
    }
  })
  const filasExtra = (extra || []).map((fila) => {
    const texto = String(fila?.text || '')
    const key = normalizarFila(texto)
    const ids = porTexto.get(key) || []
    // UNICO artefacto admitido: la fila del replay EXISTE en la fuente con el MISMO texto.
    if (ids.length) {
      return {
        text: texto,
        clase: 'duplicado-exacto-de-fuente',
        ids,
        evidencia: `la fuente ya tiene ESTE MISMO texto (id ${ids.join(', ')}): el replay la repite`,
      }
    }
    return {
      text: texto,
      clase: 'bug-invencion',
      ids: [],
      evidencia: 'la fuente no tiene ninguna fila con este texto: el replay la escribe de mas',
    }
  })
  const sinClase = (filas) => filas.filter((f) => !f.clase).length
  const esBug = (f) => String(f.clase).startsWith('bug')
  return {
    missing: filasMissing,
    extra: filasExtra,
    unclassifiedMissing: sinClase(filasMissing),
    unclassifiedExtra: sinClase(filasExtra),
    bugsMissing: filasMissing.filter(esBug).length,
    bugsExtra: filasExtra.filter(esBug).length,
  }
}

/**
 * Diferencias entre las filas FUENTE (`turns.ndjson`, `kind === "commit"`) y las filas que
 * el replay observo. La fuente NO es un golden: la sesion real ya trae duplicados.
 *
 * Clasificacion (una sola, sin rutas dobles):
 *  - `sourceDuplicates`: filas repetidas en la fuente (mismo texto normalizado);
 *  - `missingUnique`: filas UNICAS de la fuente sin contrapartida en el replay (punto real);
 *  - `textVariants`: el MISMO tramo con otra grafia (prefijo de `minVariantWords` o
 *    contencion) -> se declara, no falla;
 *  - `extraAceptadas`: fila del replay sin contrapartida 1:1 que es la MISMA LOCUCION de una
 *    fila de la fuente que ESTA YA se repite (`sourceDuplicates > 0`): es una emision
 *    repetida con la grafia del ASR, no una invencion -> se declara, no falla;
 *  - `extraUnique`: fila del replay que NO tiene locucion hermana en la fuente -> FALLA.
 *
 * @param {Array<{ text?: string }>} sourceRows filas de la fuente (ya filtradas a commits)
 * @param {Array<{ text?: string }>} observedRows filas del replay
 * @param {{ minVariantWords?: number, similitudMinima?: number, asrDigest?: object|null }} [options]
 * @returns {{ sourceRows: number, observedRows: number, sourceUnique: number, sourceDuplicates: number, missingUnique: Array<{ text: string }>, textVariants: Array<{ source: string, observed: string }>, extraAceptadas: Array<{ text: string, repiteDe: string, vecesEnFuente: number, similitud: number }>, extraUnique: Array<{ text: string }>, speakerFlips: Array<{ text: string, labels: string[], indices: number[] }>, triage: object }}
 */
export function sourceRowDiff(sourceRows = [], observedRows = [], { minVariantWords = 2, similitudMinima = 0.7, asrDigest = null } = {}) {
  const minVariant = Math.max(1, Math.floor(Number(minVariantWords) || 2))
  const similitudMin = Math.min(1, Math.max(0, Number(similitudMinima)))
  const fuente = sourceRows.map((row) => ({ text: String(row?.text || ''), key: normalizarFila(row?.text) })).filter((row) => row.key)
  const replay = observedRows.map((row) => ({ text: String(row?.text || ''), key: normalizarFila(row?.text) })).filter((row) => row.key)
  const cuenta = new Map()
  for (const fila of fuente) cuenta.set(fila.key, (cuenta.get(fila.key) || 0) + 1)
  const sourceUnique = cuenta.size
  const sourceDuplicates = fuente.length - sourceUnique

  const pendientesFuente = [...new Map(fuente.map((row) => [row.key, row])).values()]
  const pendientesReplay = [...replay]
  const extraer = (lista, key) => {
    const indice = lista.findIndex((row) => row.key === key)
    return indice >= 0 ? lista.splice(indice, 1)[0] : null
  }

  // 1) Coincidencias EXACTAS (texto normalizado).
  for (const fila of [...pendientesFuente]) {
    if (!extraer(pendientesReplay, fila.key)) continue
    extraer(pendientesFuente, fila.key)
  }

  // 2) VARIANTES del mismo tramo (el texto cambio de forma, la fila existe).
  const textVariants = []
  const palabras = (key) => key.split(' ').filter(Boolean)
  const prefijoComun = (a, b) => {
    const pa = palabras(a)
    const pb = palabras(b)
    let i = 0
    while (i < pa.length && i < pb.length && pa[i] === pb[i]) i += 1
    return i
  }
  for (const fila of [...pendientesFuente]) {
    let mejor = null
    for (const candidata of pendientesReplay) {
      if (!esMismoTramo(fila.key, candidata.key, minVariant)) continue
      const prefijo = prefijoComun(fila.key, candidata.key)
      const contiene = fila.key.includes(candidata.key) || candidata.key.includes(fila.key)
      const puntuacion = prefijo >= minVariant ? prefijo : contiene ? minVariant : 0
      if (!mejor || puntuacion > mejor.puntuacion) mejor = { candidata, puntuacion }
    }
    if (!mejor) continue
    textVariants.push({ source: fila.text, observed: mejor.candidata.text })
    extraer(pendientesReplay, mejor.candidata.key)
    extraer(pendientesFuente, fila.key)
  }

  // 3) SOBRANTES del replay: se JUSTIFICAN solo si repiten una locucion que la fuente ya
  //    repite (`vecesEnFuente > 1`). Lo que no se justifica es un extra REAL (falla).
  const extraAceptadas = []
  const extraUnique = []
  for (const fila of pendientesReplay) {
    let hermana = null
    for (const fuenteUnica of fuente) {
      const veces = cuenta.get(fuenteUnica.key) || 0
      if (veces < 2) continue
      if (!esMismaLocucion(fila.key, fuenteUnica.key, { minVariantWords: minVariant, similitudMinima: similitudMin })) continue
      const similitud = similitudDeTextos(fila.key, fuenteUnica.key)
      if (!hermana || similitud > hermana.similitud) hermana = { fuenteUnica, veces, similitud }
    }
    if (!hermana) {
      extraUnique.push({ text: fila.text })
      continue
    }
    extraAceptadas.push({
      text: fila.text,
      repiteDe: hermana.fuenteUnica.text,
      vecesEnFuente: hermana.veces,
      similitud: Number(hermana.similitud.toFixed(3)),
    })
  }

  return {
    sourceRows: fuente.length,
    observedRows: replay.length,
    sourceUnique,
    sourceDuplicates,
    missingUnique: pendientesFuente.map((row) => ({ text: row.text })),
    textVariants,
    extraAceptadas,
    extraUnique,
    // LOCUCIONES con DOS etiquetas en la fuente (una locucion es UNA voz): se mide, no falla.
    speakerFlips: locucionesConEtiquetasDistintas(sourceRows),
    // TRIAGE de cada missing/extra con PRUEBA de la fuente (sin clases que absuelvan).
    triage: clasificarFuente(
      pendientesFuente.map((row) => ({ text: row.text })),
      extraUnique,
      { sourceRows: sourceRows.map((row) => ({ id: row?.id ?? row?.t ?? null, text: String(row?.text || '') })) },
      observedRows || [],
    ),
  }
}
