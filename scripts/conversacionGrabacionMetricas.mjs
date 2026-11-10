import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Dueño único de la medición de una grabación de conversación.
 *
 * Lee `events.ndjson` y `turns.ndjson` (formato redactado de la grabación real
 * `14c1aa32`: se conservan tiempos, longitudes, hashes, turnId, hablante y
 * motivos; el texto y los vectores de voz no se versionan) y devuelve las
 * métricas que congela `scripts/conversacion-grabacion-baseline.json`.
 *
 * No decide producto: solo cuenta hechos medibles. El único consumidor es
 * `tests/conversacionGrabacionGuard.test.ts`.
 */

/** Milisegundos de la ventana de stall de conversación (`fluConfig.js:305`). */
const STALL_MS_DEFECTO = 4200

/**
 * Normaliza un texto para comparar contenido sin depender de espacios.
 * @param {unknown} texto Texto de la fila o del final.
 * @returns {string} Texto normalizado.
 */
export function normalizarTexto(texto) {
  return String(texto ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Huella SHA-256 del texto normalizado.
 * @param {unknown} texto Texto a medir.
 * @returns {string} Hash hexadecimal.
 */
export function hashTexto(texto) {
  return createHash('sha256').update(normalizarTexto(texto)).digest('hex')
}

/**
 * Lee un NDJSON y devuelve sus objetos.
 * @param {string} ruta Ruta absoluta del archivo.
 * @returns {object[]} Filas.
 */
function leerNdjson(ruta) {
  return readFileSync(ruta, 'utf8')
    .split(/\r?\n/)
    .filter((linea) => linea.trim())
    .map((linea) => JSON.parse(linea))
}

/**
 * Carga una grabación (events.ndjson + turns.ndjson).
 * @param {string} directorio Directorio de la grabación.
 * @returns {{ eventos: object[], turnos: object[] }} Datos cargados.
 */
export function leerGrabacion(directorio) {
  return {
    eventos: leerNdjson(join(directorio, 'events.ndjson')),
    turnos: leerNdjson(join(directorio, 'turns.ndjson')),
  }
}

/**
 * Mensaje de un evento de log (vacío si no lo tiene).
 * @param {object} evento Evento.
 * @returns {string} Mensaje.
 */
function mensaje(evento) {
  const data = evento?.data
  return data && typeof data.message === 'string' ? data.message : ''
}

/**
 * Parsea el JSON que sigue a un prefijo de log.
 * @param {string} texto Mensaje completo.
 * @param {string} prefijo Prefijo del mensaje.
 * @returns {object|null} Objeto parseado.
 */
function jsonTrasPrefijo(texto, prefijo) {
  if (!texto.startsWith(prefijo)) return null
  return JSON.parse(texto.slice(texto.indexOf('{')))
}

/**
 * Mide los hechos de una grabación.
 *
 * - `rowsNotEqualAnyFinal`: filas que no son exactamente un `asrFinal`.
 * - `tailLossChars`: caracteres perdidos entre finales y fila del mismo turnId.
 * - `extraCommitsForDuplicateTurn`: commits de más por turnId repetido.
 * - `commitsAfterStop`: filas commiteadas después del último `[REC] stop`.
 * - `identitySkips`: nombres descartados por la ventana de eco.
 * - `chromeRawGapsOverStall`: huecos de ASR por encima de `stallMs`.
 * - `sinVector`: medidas de voz sin vector.
 * - `speakerFlips`: cambios de hablante entre commits consecutivos.
 *
 * @param {{ eventos: object[], turnos: object[] }} grabacion Datos cargados.
 * @param {{ stallMs?: number }} [opciones] Ventana de stall a medir.
 * @returns {object} Métricas de la grabación.
 */
export function medirGrabacion({ eventos, turnos }, { stallMs = STALL_MS_DEFECTO } = {}) {
  const finals = eventos
    .map((evento) => jsonTrasPrefijo(mensaje(evento), 'asrFinal '))
    .filter(Boolean)
  const finalHashes = new Set(
    finals.map((final) => final.textHash ?? hashTexto(final.text)),
  )
  const filas = turnos
    .filter((turno) => turno.kind === 'commit')
    .map((turno) => ({
      hash: turno.textHash ?? hashTexto(turno.text),
      len: Number(turno.textLen ?? String(turno.text ?? '').length),
    }))
  const rowsNotEqualAnyFinal = filas.filter((fila) => !finalHashes.has(fila.hash)).length

  const commits = eventos.filter((evento) => evento.event === 'fila.commiteada')
  const porTurno = {}
  for (const commit of commits) {
    const turnId = String(commit.data?.turnId ?? '')
    ;(porTurno[turnId] ??= []).push(commit)
  }
  // El final que CIERRA una fila es el ULTIMO de SU turno anterior al commit, no la SUMA
  // de todos los del turno. Sumarlos comparaba una fila con dos locuciones juntas y
  // reportaba perdidas que no existian: medido 2026-11-08 en la sesion del dueno, sumaba
  // 474 (dos finales del turno) contra una fila de 210 que era de OTRA locucion del mismo
  // `turnId` (el modulo reutiliza el turnId en varias locuciones). El habla perdida real
  // era 31, no 264. Los `fila.commiteada` y los `asrFinal` traen el reloj del evento (`t`).
  const finalesConReloj = eventos
    .map((evento) => {
      const final = jsonTrasPrefijo(mensaje(evento), 'asrFinal ')
      return final ? { t: Number(evento.t), final } : null
    })
    .filter(Boolean)
  const tailLossTurns = Object.entries(porTurno)
    .map(([turnId, lista]) => {
      const hasta = lista.reduce((mayor, commit) => Math.max(mayor, Number(commit.t)), 0)
      const previos = finalesConReloj.filter(
        ({ t, final }) => String(final.turn ?? '') === turnId && t <= hasta,
      )
      if (!previos.length) return null
      const finalCierre = previos[previos.length - 1].final
      const finalLen = Number(finalCierre.len || 0)
      const rowLen = Math.max(...lista.map((commit) => Number(commit.data?.longitud || 0)))
      const loss = Math.max(0, finalLen - rowLen)
      return loss > 0 ? { turnId, finalLen, rowLen, loss } : null
    })
    .filter(Boolean)

  const stop = eventos.filter((evento) => mensaje(evento).includes('[REC] stop')).pop()
  const commitsAfterStop = stop
    ? commits.filter((commit) => Number(commit.t) > Number(stop.t)).length
    : 0

  const raw = eventos
    .filter((evento) => evento.event === 'chrome-raw')
    .map((evento) => Number(evento.t))
  const gaps = []
  for (let i = 1; i < raw.length; i += 1) {
    const gap = raw[i] - raw[i - 1]
    if (gap > stallMs) gaps.push(gap)
  }

  let speakerFlips = 0
  for (let i = 1; i < commits.length; i += 1) {
    if (commits[i].data?.hablante !== commits[i - 1].data?.hablante) speakerFlips += 1
  }

  const anchorsMsg = eventos.map(mensaje).find((texto) => texto.startsWith('anchors '))
  const anchors = anchorsMsg ? jsonTrasPrefijo(anchorsMsg, 'anchors ') : null
  const turnIds = new Set(commits.map((commit) => String(commit.data?.turnId ?? '')))

  return {
    events: eventos.length,
    commits: commits.length,
    finals: finals.length,
    uniqueTurnIds: turnIds.size,
    duplicateTurnIds: [...turnIds].filter((turnId) => porTurno[turnId].length > 1),
    extraCommitsForDuplicateTurn: commits.length - turnIds.size,
    rowsNotEqualAnyFinal,
    tailLossChars: tailLossTurns.reduce((total, caso) => total + caso.loss, 0),
    tailLossTurns,
    commitsAfterStop,
    identitySkips: eventos.filter((evento) =>
      mensaje(evento).includes('identity-register-skip'),
    ).length,
    chromeRawGapsOverStall: gaps.length,
    maxGapMs: gaps.length ? Math.max(...gaps) : 0,
    sinVector: eventos.filter((evento) =>
      mensaje(evento).includes('conversacion.voz.medida.sinVector'),
    ).length,
    speakerFlips,
    initialAnchorsCount: anchors?.count ?? null,
    initialAnchorsUsable: anchors?.usable ?? null,
  }
}



function palabrasMetrica(texto = '') {
  return normalizarTexto(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/**
 * Métricas de la sesión real del replay (6ad0dbc7) para la barrera de
 * conversación: reentrega acumulada, texto/audio imposible, canal de log y
 * diarización. Dueño único de la medición: este módulo; el fixture es la
 * grabación real, no un test sintético.
 * @param {{ eventos: object[], turnos: object[] }} grabacion Datos cargados.
 * @returns {object} Métricas medidas.
 */
export function medirConversacionReal({ eventos, turnos }) {
  const commits = turnos.filter((turno) => turno.kind === 'commit')
  let exactCarry = 0
  let fuzzyCarry = 0
  let shortLong = 0
  let speakerHablante2 = 0
  let speakerHablante3 = 0
  let zeroAudioTextRows = 0
  for (let i = 1; i < commits.length; i += 1) {
    const anterior = normalizarTexto(commits[i - 1]?.text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9ñ ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const actual = normalizarTexto(commits[i]?.text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9ñ ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const palabrasAnterior = palabrasMetrica(anterior)
    const palabrasActual = palabrasMetrica(actual)
    const dur =
      (Number(commits[i]?.audioEndSample) - Number(commits[i]?.audioStartSample)) /
      Number(commits[i]?.sampleRate || 48000)
    const contiene = actual.includes(anterior)
    const solape = palabrasAnterior.length
      ? palabrasAnterior.filter((palabra) => palabrasActual.includes(palabra)).length /
        palabrasAnterior.length
      : 0
    if (contiene && Math.min(anterior.length, actual.length) > 20) exactCarry += 1
    if (solape >= 0.5 && Math.min(palabrasAnterior.length, palabrasActual.length) > 5) {
      fuzzyCarry += 1
    }
    if (dur < 2.5 && palabrasActual.length > 15) shortLong += 1
    const hablante = String(commits[i]?.speaker || '')
    if (hablante === 'Hablante 2') speakerHablante2 += 1
    if (hablante === 'Hablante 3') speakerHablante3 += 1
    const muestrasAudio = Number(commits[i]?.audioEndSample) - Number(commits[i]?.audioStartSample)
    if (Number.isFinite(muestrasAudio) && muestrasAudio <= 1 && palabrasActual.length > 0) {
      zeroAudioTextRows += 1
    }
  }
  const normalErrorLogs = eventos.filter(
    (evento) =>
      evento.event === 'ERROR:catch' &&
      String(evento.data?.message || '').startsWith('conversacion.'),
  ).length
  const normalConversationLogs = eventos.filter((evento) =>
    String(evento.event || '').startsWith('LOG:conversacion'),
  ).length
  const sinVector = eventos.filter((evento) =>
    mensaje(evento).includes('conversacion.voz.medida.sinVector'),
  ).length
  // Nombre conocido vs etiqueta automática: la sesión ya sabe cómo se llama la
  // voz (cluster o primario) y la fila sigue saliendo `Hablante N`. Es EL defecto
  // «el nombre no se aplica». El hablante es el único campo actualizable de una
  // fila (`motor.registrarNombre` renombra por voz), así que este número solo
  // puede BAJAR: un valor mayor es una regresión.
  const etiquetaAuto = /^Hablante \d+$/i
  const nombreConocido =
    commits
      .flatMap((turno) => [
        ...(Array.isArray(turno.clusters)
          ? turno.clusters.map((cluster) => String(cluster?.label || ''))
          : []),
        String(turno.primary || ''),
      ])
      .find((etiqueta) => etiqueta && !etiquetaAuto.test(etiqueta)) || ''
  const filasAutoConNombreConocido = nombreConocido
    ? commits.filter((turno) => etiquetaAuto.test(String(turno.speaker || ''))).length
    : 0
  // COSTE DE MEDIR LA VOZ: cuántas veces se embebe y cuántas muestras se copian
  // para hacerlo. Dueño: `ingesta.verificarCambioVoz` (copiaba el búfer completo
  // para medir solo su cola). Sesión real 8149df78: 124 mediciones y 11.712.064
  // muestras copiadas en 74 s de audio. Solo puede BAJAR.
  const medicionesVoz = eventos
    .map((evento) => mensaje(evento))
    .filter((texto) => texto.startsWith('vozMedida '))
  const muestrasCopiadasParaMedir = medicionesVoz.reduce((suma, texto) => {
    const coincide = texto.match(/"muestras":(\d+)/)
    return suma + (coincide ? Number(coincide[1]) : 0)
  }, 0)
  // REINICIOS SIN UN SOLO FINAL: racha máxima de `[WD] rebuild` sin un `asrFinal`
  // en medio. Es la prueba de que el motor está VIVO y MUDO: con N medido se
  // escala (dueño `asrWatchdog`). Medido: 13 en d702, 2 en la sesión 8149df78.
  let rachaReinicios = 0
  let maxReiniciosSinFinal = 0
  for (const evento of eventos) {
    const texto = mensaje(evento)
    if (texto.startsWith('[WD] rebuild')) {
      rachaReinicios += 1
      maxReiniciosSinFinal = Math.max(maxReiniciosSinFinal, rachaReinicios)
    } else if (texto.startsWith('asrFinal')) {
      rachaReinicios = 0
    }
  }
  // FILA MÁS CORTA: mínimo de muestras entre las filas commiteadas. Es el piso
  // real medido (d702: 2.432); una fila por debajo no existe en la realidad.
  const muestrasDeFilas = commits
    .map((turno) => Number(turno.audioEndSample) - Number(turno.audioStartSample))
    .filter((muestras) => Number.isFinite(muestras) && muestras > 0)
  const minMuestrasFila = muestrasDeFilas.length ? Math.min(...muestrasDeFilas) : 0
  const identityRegisters = eventos.filter((evento) =>
    /identity-register|registrarNombre|conversacion\.nombre|REGISTRAR_PARTICIPANTE/i.test(
      JSON.stringify(evento),
    ),
  ).length
  return {
    events: eventos.length,
    commits: commits.length,
    exactCarry,
    fuzzyCarry,
    shortLong,
    speakerHablante2,
    speakerHablante3,
    zeroAudioTextRows,
    normalErrorLogs,
    normalConversationLogs,
    sinVector,
    filasAutoConNombreConocido,
    medicionesVoz: medicionesVoz.length,
    muestrasCopiadasParaMedir,
    maxReiniciosSinFinal,
    minMuestrasFila,
    identityRegisters,
  }
}

/**
 * Mide la sesion REAL del incidente 5318166b (2026-11-10): la linea abierta
 * 76 s, tres finals dentro, cero srGap, dos pendientes con texto descartados y
 * las medidas de voz entre el stop y el primer cierre.
 *
 * La fixture es la sesion real (texto redactado a longitud); no es un test
 * sintetico. El consumidor unico es `tests/conversacionLiveBarrierGuard.test.ts`.
 * @param {{ eventos: object[] }} grabacion Eventos de la fixture real.
 * @returns {object} Metricas del incidente.
 * @revisor CREAR NUEVO - medidor de la fixture real; reusa los parsers del modulo.
 */
export function medirIncidenteLive({ eventos }) {
  const finales = eventos
    .map((evento) => {
      const final = jsonTrasPrefijo(mensaje(evento), 'asrFinal ')
      return final ? Number(evento.t) : null
    })
    .filter((t) => t !== null)

  let maxGapEntreFinalesMs = 0
  for (let i = 1; i < finales.length; i += 1) {
    maxGapEntreFinalesMs = Math.max(maxGapEntreFinalesMs, finales[i] - finales[i - 1])
  }

  const descartes = eventos
    .map((evento) => jsonTrasPrefijo(mensaje(evento), 'conversacion.descarte '))
    .filter(Boolean)
  const abiertas = new Map()
  const intervalos = []
  let maxLocucionAbiertaMs = 0
  let maxFinalsEnUnaLocucion = 0
  for (const evento of eventos) {
    const texto = mensaje(evento)
    if (texto.startsWith('conversacion.locucion.abierta ')) {
      const datos = jsonTrasPrefijo(texto, 'conversacion.locucion.abierta ')
      if (datos?.locutionId) abiertas.set(datos.locutionId, Number(evento.t))
      continue
    }
    if (texto.startsWith('conversacion.locucion.cerrada ')) {
      const datos = jsonTrasPrefijo(texto, 'conversacion.locucion.cerrada ')
      const inicio = datos?.locutionId ? abiertas.get(datos.locutionId) : undefined
      if (inicio === undefined) continue
      const fin = Number(evento.t)
      maxLocucionAbiertaMs = Math.max(maxLocucionAbiertaMs, fin - inicio)
      const dentro = finales.filter((t) => t >= inicio && t <= fin).length
      maxFinalsEnUnaLocucion = Math.max(maxFinalsEnUnaLocucion, dentro)
      intervalos.push({ inicio, fin })
      abiertas.delete(datos.locutionId)
    }
  }

  const stop = eventos.find((evento) => mensaje(evento).includes('[REC] stop'))
  const primerCierre = stop
    ? eventos.find(
        (evento) =>
          mensaje(evento).startsWith('conversacion.locucion.cerrada ') &&
          Number(evento.t) > Number(stop.t),
      )
    : null
  const vozMedidaEntreStopYCierre =
    stop && primerCierre
      ? eventos.filter(
          (evento) =>
            mensaje(evento).startsWith('vozMedida ') &&
            Number(evento.t) > Number(stop.t) &&
            Number(evento.t) <= Number(primerCierre.t),
        ).length
      : 0

  const primerConversacion = eventos.find((evento) =>
    mensaje(evento).startsWith('conversacion.'),
  )
  const prefijo = primerConversacion
    ? mensaje(primerConversacion).slice(0, mensaje(primerConversacion).indexOf(' '))
    : ''
  const sessionId = primerConversacion
    ? jsonTrasPrefijo(mensaje(primerConversacion), prefijo)?.sessionId ?? null
    : null

  return {
    events: eventos.length,
    sessionId,
    asrFinal: finales.length,
    maxGapEntreFinalesMs,
    maxLocucionAbiertaMs,
    maxFinalsEnUnaLocucion,
    descarteObsoleto: descartes.filter((descarte) => descarte.motivo === 'obsoleto').length,
    srGap: eventos.filter((evento) => mensaje(evento).includes('srGap')).length,
    vozMedidaEntreStopYCierre,
    intervalos: intervalos.length,
  }
}

/**
 * Mide el CORTE DE LA WAKE de la sesion real 69a4fa97 (2026-11-10 20:58): el
 * final llegó sin wake y la wake+frase solo como intermedio; el srGap de la
 * linea abierta disparó antes de que la revision contuviera la frase.
 *
 * La fixture es la sesion real; el consumidor unico es
 * `tests/conversacionLiveBarrierGuard.test.ts`.
 * @param {{ eventos: object[] }} grabacion Eventos de la fixture real.
 * @returns {object} Metricas del corte.
 * @revisor CREAR NUEVO - medidor de la fixture real; reusa los parsers del modulo.
 */
export function medirCorteDeWake({ eventos }) {
  const finales = eventos
    .map((evento) => {
      const datos = jsonTrasPrefijo(mensaje(evento), 'asrFinal ')
      return datos ? { t: Number(evento.t), datos } : null
    })
    .filter(Boolean)
  const finalSinWake = finales.find(
    (final) => final.datos.wake === false && Number(final.datos.len) > 0,
  )
  const palabraFinal = String(finalSinWake?.datos?.text || '')
    .trim()
    .split(/\s+/)
    .pop()
  const srGaps = eventos
    .map((evento) => {
      const datos = jsonTrasPrefijo(mensaje(evento), 'srGap ')
      return datos ? { t: Number(evento.t), datos } : null
    })
    .filter(Boolean)
  let wakeInterim = null
  let revisionCompleta = null
  for (const evento of eventos) {
    const datos = jsonTrasPrefijo(mensaje(evento), 'asrRaw ')
    if (!datos || !Array.isArray(datos.items)) continue
    for (const item of datos.items) {
      const texto = String(item?.t || '')
      if (Number(item?.f) !== 0 || !/okay\s+flu/i.test(texto)) continue
      const t = Number(evento.t)
      if (!wakeInterim) wakeInterim = { t, texto }
      if (
        finalSinWake &&
        palabraFinal &&
        !revisionCompleta &&
        texto.toLowerCase().includes(palabraFinal.toLowerCase())
      ) {
        revisionCompleta = { t, texto }
      }
    }
  }
  const srGapAntesDeRevision = Boolean(
    finalSinWake &&
      revisionCompleta &&
      srGaps.some((gap) => gap.t > finalSinWake.t && gap.t < revisionCompleta.t),
  )
  const fila = eventos.find((evento) => {
    const datos = jsonTrasPrefijo(mensaje(evento), 'conversacion.locucion.cerrada ')
    return (
      datos &&
      datos.descarte === null &&
      Number(evento.t) > (revisionCompleta?.t || wakeInterim?.t || 0)
    )
  })
  const primerConversacion = eventos.find((evento) => mensaje(evento).startsWith('conversacion.'))
  const prefijo = primerConversacion
    ? mensaje(primerConversacion).slice(0, mensaje(primerConversacion).indexOf(' '))
    : ''
  const sessionId = primerConversacion
    ? jsonTrasPrefijo(mensaje(primerConversacion), prefijo)?.sessionId ?? null
    : null
  return {
    events: eventos.length,
    sessionId,
    finalSinWake: finalSinWake ? 1 : 0,
    wakeInterim: wakeInterim ? 1 : 0,
    revisionCompleta: revisionCompleta ? 1 : 0,
    srGapAntesDeRevision: srGapAntesDeRevision ? 1 : 0,
    filaCommiteada: fila ? 1 : 0,
  }
}
