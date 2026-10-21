/**
 * COMPARADOR UNICO: lo observado contra el `expected.json` aprobado.
 *
 * FASE `events`: filas y CAJA. La caja se mide sobre `observed.boxTrace` (tiempo + texto
 * de CADA actualizacion), asi que una caja congelada o duplicada es un DATO, no ruido.
 *
 * Distincion que este modulo garantiza: si la caja estaba DUPLICADA y la fila no la
 * contiene, se reporta `boxDuplicated` — NUNCA `boxLost` (no se vende duplicacion como
 * perdida).
 *
 * Los umbrales (congelacion, tamano de bloque repetido) llegan por opciones: ni un numero
 * magico aqui.
 */

/** Palabras de un texto (mismo criterio que el resto de la voz: espacios). */
export function palabras(texto = '') {
  return String(texto || '').trim().split(/\s+/).filter(Boolean)
}

const norm = (palabra = '') => String(palabra || '').toLowerCase()

/**
 * INVARIANTE "sin duplicacion por prefijo creciente": "du dupli duplica".
 *
 * Exige TRES palabras encadenadas (cada una prefijo estricto de la siguiente): dos
 * palabras que solo empiezan igual ("mas MasterChef") son palabras DISTINTAS.
 * @param {string} texto
 * @returns {{ hit: boolean, run: string[] }}
 */
export function growingPrefixRun(texto = '') {
  const words = palabras(texto)
  const prefijoEstricto = (a = '', b = '') => Boolean(a) && Boolean(b) && b !== a && b.startsWith(a)
  for (let i = 0; i + 2 < words.length; i += 1) {
    const [a, b, c] = [norm(words[i]), norm(words[i + 1]), norm(words[i + 2])]
    if (prefijoEstricto(a, b) && prefijoEstricto(b, c)) return { hit: true, run: [a, b, c] }
  }
  return { hit: false, run: [] }
}

/**
 * BLOQUE repetido dentro del mismo texto: una secuencia de `minWords` palabras que
 * aparece al menos dos veces. Es la firma de "mientras vamos a preparar el menjurje en
 * mientras vamos a preparar el menjurje en ...".
 * @param {string} texto
 * @param {number} minWords Tamano del bloque (por argumento/config).
 * @returns {{ hit: boolean, block: string }}
 */
export function duplicatedBlock(texto = '', minWords = 4) {
  const words = palabras(texto).map(norm)
  const n = Math.max(2, Math.floor(Number(minWords) || 0))
  if (words.length < n * 2) return { hit: false, block: '' }
  const vistos = new Map()
  for (let i = 0; i + n <= words.length; i += 1) {
    const clave = words.slice(i, i + n).join(' ')
    const previo = vistos.get(clave)
    if (previo != null && i - previo >= n) return { hit: true, block: clave }
    if (previo == null) vistos.set(clave, i)
  }
  return { hit: false, block: '' }
}

/**
 * La caja esta DUPLICADA (prefijo creciente o bloque repetido).
 * @param {string} texto
 * @param {number} minWords
 * @returns {boolean}
 */
export function cajaDuplicada(texto = '', minWords = 4) {
  return growingPrefixRun(texto).hit || duplicatedBlock(texto, minWords).hit
}

/**
 * El texto de `caja` aparece contiguo dentro de `fila` (la fila lo CONTIENE).
 * @param {string} fila
 * @param {string} caja
 * @returns {boolean}
 */
export function filaContieneCaja(fila = '', caja = '') {
  const deLaFila = palabras(fila).map(norm)
  const deLaCaja = palabras(caja).map(norm)
  if (!deLaCaja.length) return true
  if (deLaCaja.length > deLaFila.length) return false
  for (let i = 0; i + deLaCaja.length <= deLaFila.length; i += 1) {
    let ok = true
    for (let j = 0; j < deLaCaja.length; j += 1) {
      if (deLaFila[i + j] !== deLaCaja[j]) {
        ok = false
        break
      }
    }
    if (ok) return true
  }
  return false
}

/**
 * Ventana de caja de cada commit: los valores vistos entre el commit anterior y este.
 * @param {Array<{ t: number, text: string }>} boxTrace
 * @param {Array<{ t: number, rowIndex: number, box: string }>} commits
 * @returns {Array<{ rowIndex: number, textos: string[], pico: string }>}
 */
export function ventanasDeCaja(boxTrace = [], commits = []) {
  const traza = [...boxTrace].sort((a, b) => Number(a.t) - Number(b.t))
  return commits.map((commit, index) => {
    const desde = index === 0 ? -Infinity : Number(commits[index - 1].t)
    const entradas = traza.filter((entry) => Number(entry.t) > desde && Number(entry.t) <= Number(commit.t))
    // La locucion que se cierra empieza tras el ULTIMO vaciado de la ventana: lo que vino
    // despues ya es la locucion SIGUIENTE (la caja puede mostrarla, no es una perdida).
    const ultimoCierre = entradas.map((entry) => entry.reason === 'clear').lastIndexOf(true)
    // Duplicacion: TODA la ventana (la caja pudo duplicar y luego vaciarse). Perdida: solo
    // el tramo de la locucion que se cierra (tras el ultimo vaciado).
    const textos = entradas.map((entry) => String(entry.text || ''))
    const deLaLocucion = ultimoCierre >= 0 ? textos.slice(ultimoCierre + 1) : textos
    const pico = deLaLocucion.reduce((mejor, texto) => (palabras(texto).length >= palabras(mejor).length ? texto : mejor), '')
    return { rowIndex: commit.rowIndex, textos, deLaLocucion, pico }
  })
}

/**
 * INVARIANTE "no se pierde el bloque": la fila contiene el texto que la caja mostraba.
 * La duplicacion NO es perdida: se clasifica aparte.
 * @param {{ text: string }[]} rows
 * @param {Array<{ rowIndex: number, textos: string[], pico: string }>} ventanas
 * @param {number} dupBlockWords
 * @returns {{ perdidas: object[], duplicadas: object[] }}
 */
export function clasificarCommits(rows = [], ventanas = [], dupBlockWords = 4) {
  const perdidas = []
  const duplicadas = []
  for (const ventana of ventanas) {
    const row = rows[ventana.rowIndex]
    const pico = String(ventana.pico || '')
    if (!row) continue
    // DUPLICACION: cualquier valor que la caja mostro en la ventana del commit.
    const duplicada = (ventana.textos || []).find((texto) => cajaDuplicada(texto, dupBlockWords))
    if (duplicada) {
      duplicadas.push({ index: ventana.rowIndex, caja: String(duplicada).slice(0, 160), fila: String(row.text || '').slice(0, 160) })
      continue
    }
    if (!palabras(pico).length) continue
    if (palabras(pico).length > palabras(row.text).length && !filaContieneCaja(row.text, pico)) {
      perdidas.push({ index: ventana.rowIndex, caja: pico.slice(0, 160), fila: String(row.text || '').slice(0, 160) })
    }
  }
  return { perdidas, duplicadas }
}

/**
 * Congelacion: mayor hueco entre dos actualizaciones de la caja mientras el turno esta
 * vivo (entre el primer y el ultimo commit).
 * @param {Array<{ t: number, text: string }>} boxTrace
 * @param {Array<{ t: number }>} commits
 * @returns {{ maxGapMs: number, from: string, to: string }}
 */
export function mayorHuecoDeCaja(boxTrace = [], commits = []) {
  if (!commits.length) return { maxGapMs: 0, from: '', to: '' }
  const desde = Number(commits[0].t)
  const hasta = Number(commits[commits.length - 1].t)
  const traza = boxTrace
    .filter((entry) => Number(entry.t) >= desde && Number(entry.t) <= hasta)
    .sort((a, b) => Number(a.t) - Number(b.t))
  let maxGapMs = 0
  let from = ''
  let to = ''
  for (let i = 1; i < traza.length; i += 1) {
    const gap = Number(traza[i].t) - Number(traza[i - 1].t)
    if (gap > maxGapMs) {
      maxGapMs = gap
      from = String(traza[i - 1].text || '').slice(0, 80)
      to = String(traza[i].text || '').slice(0, 80)
    }
  }
  return { maxGapMs, from, to }
}

/**
 * Normalizacion para COMPARAR filas: minusculas, sin puntuacion y espacios colapsados.
 * El reporte conserva siempre el texto ORIGINAL de cada lado.
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
 * @param {{ minVariantWords?: number, similitudMinima?: number }} [options]
 * @returns {{ sourceRows: number, observedRows: number, sourceUnique: number, sourceDuplicates: number, missingUnique: Array<{ text: string }>, textVariants: Array<{ source: string, observed: string }>, extraAceptadas: Array<{ text: string, repiteDe: string, vecesEnFuente: number, similitud: number }>, extraUnique: Array<{ text: string }> }}
 */
export function sourceRowDiff(sourceRows = [], observedRows = [], { minVariantWords = 2, similitudMinima = 0.7 } = {}) {
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
  }
}

function sameRow(a, b) {
  return String(a?.text ?? '') === String(b?.text ?? '') && String(a?.speaker ?? '') === String(b?.speaker ?? '')
}

/**
 * DUENO UNICO de la comparacion de HABLANTES (modo `vectors`).
 *
 * El esperado es el `speaker` que la grabacion guardo para ese commit (resultado del
 * producto en su momento), el observado es lo que devuelve HOY el resolutor real con el
 * estado previo reconstruido. Un turno sin vector o sin duracion NO se evalua.
 *
 * COBERTURA: el veredicto solo puede ser `ok` si se evaluaron TODOS los commits. Con
 * turnos sin evidencia el modo es `partial` (no es una validacion completa de hablantes,
 * aunque todo lo evaluado coincida).
 *
 * @param {object} vectors resultado de `runVectorsSession`
 * @returns {{ name: string, ok: boolean, covered: boolean, partial: boolean, coverage: number, detail: string }}
 */
export function compararSpeakers(vectors = {}) {
  const turnos = Array.isArray(vectors?.turns) ? vectors.turns : []
  const omitidos = Array.isArray(vectors?.skipped) ? vectors.skipped : []
  const commits = Number(vectors?.commits) || 0
  const evaluados = Number(vectors?.evaluated) || turnos.length
  const coverage = commits > 0 ? evaluados / commits : 0
  const porMotivo = omitidos.reduce((acc, turno) => {
    acc[turno.motivo] = (acc[turno.motivo] || 0) + 1
    return acc
  }, {})
  const motivosOmitidos = Object.entries(porMotivo)
    .map(([motivo, veces]) => `${motivo} ${veces}`)
    .join(' · ')
  if (vectors?.conclusive !== true) {
    const motivos = (vectors?.notConclusive || []).join(', ') || 'sin-evidencia'
    return {
      name: 'speakers',
      ok: false,
      covered: false,
      partial: true,
      coverage: 0,
      detail: `NO CONCLUYENTE (${motivos}): ${omitidos.length} turno(s) sin vector o sin duracion de ${commits} commit(s)`,
    }
  }
  const fallos = turnos.filter((turno) => !turno.match)
  const primero = fallos[0]
  const completo = coverage >= 1
  const detalle =
    `${vectors.speakerMatches} acierto(s) · ${vectors.speakerMismatches} mismatch(s) · ` +
    `${omitidos.length}/${commits} sin evidencia (cobertura ${Math.round(coverage * 100)}%)` +
    (motivosOmitidos ? `: ${motivosOmitidos}` : '') +
    (primero
      ? `; primero #${primero.index}: esperado "${primero.expected}" / observado "${primero.observed}" (reason ${primero.reason || '?'})`
      : '')
  return {
    name: 'speakers',
    ok: completo && fallos.length === 0,
    covered: true,
    partial: !completo,
    coverage: Number(coverage.toFixed(3)),
    detail: completo ? detalle : `PARTIAL (no es validacion completa): ${detalle}`,
  }
}

/**
 * Compara lo observado con el expected.
 * @param {{ observed: object, expected: object, options?: { boxStallMs?: number, dupBlockWords?: number, sourceRows?: Array<{ text?: string }>, variantWords?: number, locucionSimilitud?: number } }} input
 * @returns {{ status: 'ok'|'mismatch', checks: Array<object>, notCovered: string[], classification: object }}
 */
export function compareExpected({ observed, expected, options = {} } = {}) {
  const checks = []
  const exp = expected?.expect || {}
  const rows = observed?.rows || []
  const boxAtCommit = observed?.boxAtCommit || []
  const boxTrace = observed?.boxTrace || []
  const dupBlockWords = Math.max(2, Math.floor(Number(options?.dupBlockWords) || 4))
  const boxStallMs = Math.max(0, Number(options?.boxStallMs) || 0)
  const notCovered = []

  if (Number.isFinite(Number(exp.rowCount))) {
    const ok = rows.length === Number(exp.rowCount)
    checks.push({ name: 'rowCount', ok, detail: ok ? `${rows.length}` : `esperado ${exp.rowCount}, observado ${rows.length}` })
  }

  if (Array.isArray(exp.rows)) {
    const diffs = []
    const total = Math.max(exp.rows.length, rows.length)
    for (let i = 0; i < total; i += 1) {
      if (!sameRow(exp.rows[i], rows[i])) {
        diffs.push({
          index: i,
          expected: exp.rows[i] ? { text: exp.rows[i].text, speaker: exp.rows[i].speaker } : null,
          actual: rows[i] ? { text: rows[i].text, speaker: rows[i].speaker } : null,
        })
      }
    }
    checks.push({
      name: 'rows',
      ok: diffs.length === 0,
      detail: diffs.length
        ? `${diffs.length} diferencia(s); primera en #${diffs[0].index}: esperado ${JSON.stringify(diffs[0].expected)} / observado ${JSON.stringify(diffs[0].actual)}`
        : `${rows.length} fila(s)`,
      diffs,
    })
  }

  // FILAS FUENTE (`turns.ndjson`): la fuente NO es golden; se clasifica y se reporta.
  let source = null
  if (Array.isArray(options?.sourceRows)) {
    source = sourceRowDiff(options.sourceRows, rows, {
      minVariantWords: options?.variantWords,
      similitudMinima: options?.locucionSimilitud,
    })
    const detalle =
      `fuente ${source.sourceRows} (${source.sourceUnique} unicas, ${source.sourceDuplicates} duplicadas) · ` +
      `replay ${source.observedRows} · faltan ${source.missingUnique.length} · ` +
      `sobran ${source.extraAceptadas.length + source.extraUnique.length} (${source.extraAceptadas.length} aceptada(s), ` +
      `${source.extraUnique.length} sin justificar) · variantes ${source.textVariants.length}`
    const ok = source.missingUnique.length === 0 && source.extraUnique.length === 0
    checks.push({
      name: 'sourceRows',
      ok,
      detail: source.missingUnique.length
        ? `${detalle}; PRIMERA que falta: "${String(source.missingUnique[0]?.text || '').slice(0, 90)}"`
        : source.extraUnique.length
          ? `${detalle}; EXTRA sin justificar: "${String(source.extraUnique[0]?.text || '').slice(0, 90)}"`
          : detalle,
    })
  }

  // HABLANTES: fuera del alcance de `events` (sin audio ni vectores). NO se valida: si el
  // expected los declara, se avisa de que NO esta cubierto.
  if (Array.isArray(exp.speakers) && exp.speakers.length) notCovered.push('speakers')

  if (Array.isArray(exp.box)) {
    const actual = boxAtCommit.map((text) => String(text))
    const ok = exp.box.length === actual.length && exp.box.every((valor, i) => String(valor) === String(actual[i]))
    checks.push({
      name: 'box',
      ok,
      detail: ok ? `${actual.length} valor(es)` : `esperado ${JSON.stringify(exp.box)} / observado ${JSON.stringify(actual)}`,
    })
  }

  if (exp.noPrefixDuplication === true) {
    const hits = rows.map((row, index) => ({ index, ...growingPrefixRun(row.text) })).filter((h) => h.hit)
    checks.push({
      name: 'noPrefixDuplication',
      ok: hits.length === 0,
      detail: hits.length ? `fila #${hits[0].index}: "${hits[0].run.join(' ')}"` : 'sin duplicacion por prefijo creciente',
    })
  }

  // CAJA: prefijo creciente en cualquier valor de la traza.
  const prefijoCaja = boxTrace.map((entry, index) => ({ index, t: entry.t, ...growingPrefixRun(entry.text) })).filter((h) => h.hit)
  checks.push({
    name: 'noBoxPrefixDuplication',
    ok: prefijoCaja.length === 0,
    detail: prefijoCaja.length
      ? `${prefijoCaja.length} valor(es); primero en t=${prefijoCaja[0].t}: "${prefijoCaja[0].run.join(' ')}"`
      : `${boxTrace.length} valor(es) de caja sin prefijo creciente`,
  })

  // CAJA: bloque largo repetido.
  const bloques = boxTrace.map((entry) => ({ t: entry.t, ...duplicatedBlock(entry.text, dupBlockWords) })).filter((h) => h.hit)
  checks.push({
    name: 'noBoxDuplicatedBlock',
    ok: bloques.length === 0,
    detail: bloques.length
      ? `${bloques.length} valor(es); primero en t=${bloques[0].t}: "${bloques[0].block}"`
      : `sin bloques de ${dupBlockWords}+ palabras repetidos`,
  })

  // CAJA: congelacion (hueco maximo entre actualizaciones con el turno vivo).
  if (boxStallMs > 0) {
    const hueco = observed?.boxStall || mayorHuecoDeCaja(boxTrace, observed?.commits || [])
    const aplica = (observed?.rows || []).length > 0 || (observed?.boxTrace || []).length > 0
    if (!aplica) {
      notCovered.push('boxStall')
    } else {
      checks.push({
        name: 'boxStall',
        ok: hueco.maxGapMs <= boxStallMs,
        detail:
          hueco.maxGapMs <= boxStallMs
            ? `hueco maximo ${Math.round(hueco.maxGapMs)} ms (tope ${boxStallMs} ms)`
            : `congelada ${Math.round(hueco.maxGapMs)} ms (tope ${boxStallMs} ms) entre "${hueco.from}" y "${hueco.to}"`,
      })
    }
  }

  // PERDIDA vs DUPLICACION por commit (ventana de la caja).
  const ventanas = ventanasDeCaja(boxTrace, observed?.commits || [])
  const { perdidas, duplicadas } = clasificarCommits(rows, ventanas, dupBlockWords)
  checks.push({
    name: 'boxLost',
    ok: perdidas.length === 0,
    detail: perdidas.length
      ? `${perdidas.length} commit(s); primero #${perdidas[0].index}: fila "${perdidas[0].fila}" no contiene la caja "${perdidas[0].caja}"`
      : 'ninguna fila perdio el bloque que la caja mostraba',
  })
  checks.push({
    name: 'boxDuplicated',
    ok: duplicadas.length <= Number(exp.boxDuplicated ?? 0),
    detail: duplicadas.length
      ? `${duplicadas.length} commit(s) con la caja DUPLICADA; primero #${duplicadas[0].index}: "${duplicadas[0].caja}"`
      : 'ningun commit con la caja duplicada',
  })

  if (checks.length === 0) {
    checks.push({ name: 'expected', ok: false, detail: 'el expected no declara ninguna expectativa' })
  }

  return {
    status: checks.every((check) => check.ok) ? 'ok' : 'mismatch',
    checks,
    notCovered,
    source,
    classification: { perdidas, duplicadas, ventanas: ventanas.length },
  }
}
