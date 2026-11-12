/**
 * COMPOSICIÓN del motor CONVERSACIÓN para el hook de voz.
 *
 * El hook posee la ÚNICA instancia de escucha y el PCM (AGENTS, Anexo B 1);
 * aquí solo se conecta ese flujo con el motor del producto y se proyectan sus
 * eventos a la vista y al despacho. Vivía dentro de `useFluVoiceAssistant.js`;
 * sale a un módulo propio porque tiene UNA razón de cambio (el cableado del
 * motor) y el hook es un god-file con trinquete de tamaño.
 *
 * UNA SOLA FRASE: la caja del módulo es la fuente canónica. La presentación
 * quita la wake solo para mostrar (Anexo B 5); el despacho usa la frase
 * canónica del MISMO módulo (Anexo B 6), nunca una copia re-normalizada aquí.
 *
 * Identidad del turno: la MIDE el módulo por sí mismo (EmbebedorPort, decisión
 * del dueño Paso 5-A). Este módulo NO decide la etiqueta de ninguna fila ni
 * entrega evidencia externa: el módulo resuelve su propia medida.
 *
 * Frontera declarada (mandato 2026-10-26): solo utilidades puras del despacho.
 * Prohibido reimplementar aquí la escritura de filas, la identidad o el dueño
 * `renameRowSpeakerName`; viven en `../conversation`. Este archivo es el ÚNICO
 * consumidor de `row.committed`: el escritor pasivo retirado (2026-10-30,
 * problema 6) era una ruta doble de la fila del usuario.
 */
import { metaDeFilaConversacion } from '../../core/db/conversationRowMapping'
import { logCaughtError } from '../../lib/caughtError.ts'
import { useIntegrationStore } from '../../store/integrationStore'
import { crearMotorConversacionProducto, grabarRevisionDeFila, traeFinal } from '../conversation/index'
import { resolveEchoContext } from '../lib/conversationDialogue.js'
import { detectWakeIntroducedName, splitTranscriptAtWakeWord } from '../lib/audioMath.js'
import { labelToSpeakerId } from '../lib/conversationRow.js'
import { autoSpeakerIndexFromKey } from '../lib/speakerCore.js'
import {
  voiceKeyFor,
  voiceVectorModel,
  knownVoiceNames,
  preferKnownVoiceName,
} from '../lib/speakerDirectory.js'
import { seedRegisteredAnchors } from '../lib/speakerClusters.js'
import { getParticipantAnchors } from '../lib/participantVoiceAnchors.ts'
import { FLU_CONFIG } from '../lib/fluConfig.js'
import { getLastCompletedSpeechAt } from '../lib/fluSpeech.js'
import { getSessionRecordingStatus } from '../lib/sessionRecorder.js'

/**
 * Compone el motor de conversación del producto con la vista del hook.
 * @param {object} opciones Idioma, vista y ganchos del hook.
 * @param {'es'|'en'} opciones.idioma Idioma ya normalizado de la sesión.
 * @param {(fraseCanonica: string) => void} opciones.onLiveTranscript Publica la frase viva (completa, con wake).
 * @param {(fraseCanonica: string, opciones: {interim: boolean}) => void} opciones.onFraseCanonica Despacha la frase canónica.
 * @param {(fila: object) => void} [opciones.onLocucionCommiteada] Cierre de locución (frontera de turno).
 * @returns {{ abrir: () => void, evento: (evento: unknown) => Promise<void>, audio: (muestras: Float32Array, sampleRate: number, inicioMuestras?: number) => void, cerrar: (motivo: string) => Promise<void> }}
 */
export function crearMotorConversacionHook({
  idioma,
  onLiveTranscript,
  onFraseCanonica,
  onLocucionCommiteada,
}) {
  // ECO sin recorrer el historial en cada evento: el último texto de FLU se
  // cachea y solo se recalcula cuando el historial cambia (misma fuente,
  // `resolveEchoContext`). Antes cada evento del ASR caminaba toda la
  // conversación y el coste crecía con la sesión.
  let historialCacheado = null
  let ultimoDichoCacheado = ''
  const leerUltimoTextoDicho = () => {
    const historial = useIntegrationStore.getState().conversationHistory
    if (historial !== historialCacheado) {
      historialCacheado = historial
      ultimoDichoCacheado = resolveEchoContext(historial, getLastCompletedSpeechAt()).lastAssistantText
    }
    return ultimoDichoCacheado
  }
  const motor = crearMotorConversacionProducto({
    idioma,
    participantId: useIntegrationStore.getState().activePersonId,
    ultimoTextoDicho: leerUltimoTextoDicho,
    // Caso 11: un id por grabación — la conversación ADOPTA el sessionId del
    // recorder (encendido antes de la escucha). Sin recorder activo el
    // proveedor devuelve '' y el módulo acuña el propio (N/A).
    recordingId: () => getSessionRecordingStatus().sessionId || '',
    // Anclas de la base (solo lectura): el filtro de modelo/nombre lo ejerce
    // seedRegisteredAnchors, dueño único de qué ancla es válida en la sesión.
    anclasBase: () => {
      const sembradas =
        seedRegisteredAnchors([], getParticipantAnchors(), { model: voiceVectorModel() }) || []
      return sembradas.map((cluster) => ({ name: cluster.label, vector: cluster.signature }))
    },
  })
  /** Última locución commiteada: `row.committed` puede repetirse al promover la fila. */
  let ultimaCommiteada = ''
  /** Timer único de la frase viva: agrupa ráfagas de interinos en un render. */
  let liveTimer = 0
  /**
   * Última frase viva PUBLICADA. La caja no repinta lo mismo: medido 2026-11-09 en la
   * sesión del dueño (e1b683e9), 193 de 532 eventos del ASR traían el mismo texto y cada
   * uno volvía a pintar la caja (misma frase, mismo render). Eso es lo que se ve como
   * «se atora y luego salta». El texto no cambia: el render no se repite.
   */
  let ultimaViva = ''
  /**
   * Locución dueña de `ultimaViva`. Dentro de la MISMA frase la caja es
   * MONÓTONA: el final confirmado puede ser más corto que el interino ya
   * visible y no puede borrar palabras (regla 2). Al limpiar la caja se
   * reinicia y la frase siguiente empieza de cero.
   */
  let ultimaVivaLocucion = ''
  /** Última expresión del mandato de nombre ya despachada (clave: el NOMBRE, no el texto). */
  let ultimoNombreDespachado = ''
  let nameCommandDeferTimer = 0
  let nameCommandDeferPayload = null
  let cerrado = false
  /**
   * Generación del ciclo de escucha. El cierre vacía la caja DESPUÉS de que el
   * motor terminó de commitear los pendientes, pero solo si sigue siendo el
   * mismo ciclo: una apertura nueva no puede heredar el vaciado del anterior.
   */
  let generacion = 0

  /**
   * Despacha la frase canónica vigente tras ingerir un evento del reconocedor.
   * Se lee la instantánea DESPUÉS de la ingesta: el módulo resolvió el tramo.
   * @param {boolean} interim Si el evento que motivó la ingesta era un interino.
   */
  function despacharFraseVigente(interim) {
    const frase = String(motor.instantanea().fraseCanonica || '').trim()
    // Dedupe del despacho: el ÚNICO dueño es el planificador de audioMath
    // (compara firma y ventana); el cableado NO filtra repeticiones: cada
    // frase vigente se entrega y el plan decide.
    if (!frase) return
    // Cualquier frase nueva cancela una respuesta de nombre pendiente: el
    // usuario sigue hablando. El defer vive aquí, en el cableado del motor;
    // el hook solo despacha. No se toca el VAD.
    if (nameCommandDeferTimer) {
      clearTimeout(nameCommandDeferTimer)
      nameCommandDeferTimer = 0
    }
    const wakeWords = FLU_CONFIG.voiceCommands.wakeWords || []
    const esMandatoNombre =
      !interim && Boolean(detectWakeIntroducedName(frase, wakeWords))
    // La wake SOLA (“Okay flu”) también se difiere: el ASR la cierra antes de
    // “Soy Luis regístrame…” y FLU respondía “Te escucho.” en medio.
    // La wake SOLA no es una orden: no se despacha y NO se responde. Antes se
    // difería 1,2 s y FLU contestaba («Te escucho») en mitad del habla.
    const split = splitTranscriptAtWakeWord(frase, wakeWords)
    const esSoloWake =
      split.wakeWordMatched &&
      !String(split.commandText || split.afterWake || '').trim()
    if (esSoloWake) return
    if (esMandatoNombre) {
      // DOS ENTREGAS DEL MISMO MANDATO no se responden dos veces: el ASR puede soltar el
      // mandato en un interino y otra vez en el final con otra grafía del verbo
      // («…soy Luis regís» / «…soy Luis regístrate»), y el dedupe por TEXTO no las ve igual.
      // MEDIDO 2026-11-09 10:35:48 y 10:35:50: «Registrado Luis Regis.» dicho dos veces.
      const nombreMandado = preferKnownVoiceName(
        detectWakeIntroducedName(frase, wakeWords),
        knownVoiceNames(),
      )
      const claveMandato = nombreMandado || frase
      if (claveMandato === ultimoNombreDespachado) return
      ultimoNombreDespachado = claveMandato
      nameCommandDeferPayload = { frase, opciones: { interim } }
      nameCommandDeferTimer = setTimeout(() => {
        nameCommandDeferTimer = 0
        const payload = nameCommandDeferPayload
        nameCommandDeferPayload = null
        if (payload) onFraseCanonica(payload.frase, payload.opciones)
      }, FLU_CONFIG.timing.nameCommandDeferMs)
      return
    }
    onFraseCanonica(frase, { interim })
  }

  motor.suscribir((evento) => {
    if (evento.tipo === 'box.updated') {
      if (cerrado) return
      // La frase viva es la MISMA frase de la fila (Anexo B 3): va completa, con
      // wake. Quitarla es presentación de la barra, y lo hace la barra con el
      // splitter único (Anexo B 5); si aquí se recortara, la barra recibiría un
      // texto sin wake, no casaría y no mostraría ningún comando.
      if (liveTimer) clearTimeout(liveTimer)
      liveTimer = setTimeout(() => {
        liveTimer = 0
        // La caja compone la frase ABIERTA y la RETENIDA: no puede desaparecer
        // la línea anterior mientras sigue abierta (reglas 1/2). Cuando la
        // retenida se abre como su propia locución, la anterior ya se commiteó y
        // su texto pasa a la conversación: ahí la caja sí puede limpiarse.
        const abiertaFrase = evento.abierta ? String(evento.fraseCanonica || '').trim() : ''
        const pendienteFrase = String(evento.fraseCanonicaPendiente || '').trim()
        // Nunca se pinta una versión MÁS CORTA de la misma frase: si una contiene
        // a la otra, gana la más larga; solo se concatenan frases distintas.
        const vivaCalculada = !abiertaFrase
          ? pendienteFrase
          : !pendienteFrase
            ? abiertaFrase
            : pendienteFrase.startsWith(abiertaFrase)
              ? pendienteFrase
              : abiertaFrase.startsWith(pendienteFrase)
                ? abiertaFrase
                : `${abiertaFrase} ${pendienteFrase}`
        const locucionViva = evento.abierta
          ? String(evento.locucionAbiertaId || '')
          : String(evento.textoPendienteId || '')
        const mismaFrase =
          locucionViva !== '' && locucionViva === ultimaVivaLocucion
        // Regla 2: dentro de la MISMA locución la caja nunca decrece. El final
        // confirmado puede traer menos palabras que el interino ya pintado; la
        // fila de conversación usará el final, pero la caja conserva lo visible.
        const viva =
          mismaFrase && ultimaViva.length > vivaCalculada.length
            ? ultimaViva
            : vivaCalculada
        ultimaVivaLocucion = locucionViva
        if (viva !== ultimaViva) {
          ultimaViva = viva
          onLiveTranscript(viva)
        }
      }, FLU_CONFIG.ui?.workspace?.liveTranscriptThrottleMs ?? 120)
      return
    }
    if (evento.tipo === 'speaker.labeled') {
      // REETIQUETADO de la ÚNICA cosa actualizable de una fila (mandato del dueño
      // 2026-10-30: «puedes poner un hablante temporal si aun no llega, y cuando
      // lo tengas reemplazar»). La etiqueta TEMPORAL no resuelve la fila: su
      // `speakerPending` sigue vivo hasta que llegue la medida, que emite otra vez
      // este evento ya con evidencia `medida`/`nombre`.
      if (evento.evidencia !== 'pendiente') {
        // El hablante es el ÚNICO campo actualizable y se publica TAL CUAL lo
        // resolvió el módulo: N→N, X→X, XX→XX, nombre→nombre. La vista no
        // reinterpreta el estado (dueño único: resolveRowSpeakerLabel).
        useIntegrationStore
          .getState()
          .setEntrySpeakerName(evento.locutionId, evento.etiqueta, { resolved: true, persist: false })
      }
      // Revisión de la MISMA locución: el snapshot inicial pudo nacer con
      // signature null; el dueño único recibe la firma/tramo finales.
      if (evento.revision === true && evento.fila) grabarRevisionDeFila(evento.fila)
      return
    }
    if (evento.tipo !== 'row.committed') return
    // ¿Locución NUEVA o promoción de la MISMA fila (`revision > 1`)? UNA sola
    // lectura del predicado; la usan el bautizo y la frontera de turno. Antes
    // cada uno llevaba su propia variable para la misma pregunta.
    const esNuevaLocucion = evento.fila.locutionId !== ultimaCommiteada
    // NOMBRE POR VOZ: si la fila dice «ok flu soy X», se bautiza ESA voz y se
    // renombran sus filas ya escritas (el hablante es el único campo
    // actualizable). ÚNICO disparador — aquí, en el cableado del motor, que es
    // quien tiene el texto canónico y la etiqueta (WHERE) — y el renombrado lo
    // hace el módulo: este archivo NO escribe filas. El hook ya no lo dispara
    // (caso declarado en `scripts/rutas-dobles-baseline.json`).
    //
    // EL NOMBRE NO SE INVENTA AQUÍ (B2, mandato 2026-10-13): lo que el ASR captura
    // NO es el nombre de una voz («soy Luis sigue sin funcionar» captura «Luis Sigue
    // Sin»). La captura se resuelve contra los nombres que YA existen en su dueño
    // único (`preferKnownVoiceName` + `knownVoiceNames`, directorio de voces) y lo
    // que se entrega al bautizo es ESE nombre, nunca el texto crudo. El registro
    // persistente del nombre (directorio/base/clusters) no es de este archivo: lo
    // hace `registerSpeakerIdentityFromCommand` desde la frontera de turno.
    const nombreDicho =
      esNuevaLocucion &&
      preferKnownVoiceName(
        detectWakeIntroducedName(
          String(evento.fila.texto || ''),
          FLU_CONFIG.voiceCommands.wakeWords || [],
        ),
        knownVoiceNames(),
      )
    if (nombreDicho) {
      motor.registrarNombre(nombreDicho, evento.fila.etiqueta, evento.fila.locutionId)
    }
    // La navegación conserva la última PETICIÓN DE INFORMACIÓN: "ok flu soy
    // Luis" no es una consulta y no debe pisar la petición anterior. La caja sí
    // conserva la frase del comando: no se limpia el vivo hasta la frase
    // siguiente o el stop (abajo), así no retrocede a una frase más vieja.
    if (!nombreDicho) useIntegrationStore.getState().setLastCommittedTranscript(evento.fila.texto)
    // Revisión por FUSIÓN de una continuación/duplicado: el snapshot inicial ya
    // existe con el mismo locutionId; el dueño único recibe el texto/tramo/firma
    // finales como revisión (analizador: última por locutionId).
    if (evento.fila && Number(evento.fila.revision) > 1) grabarRevisionDeFila(evento.fila)
    // ÚNICO escritor de la fila del usuario (mandato 2026-10-30, problema 6):
    // el módulo commitea en AMBOS modos y aquí no se re-gatea por turno. El
    // escritor pasivo de App y el dedupe simétrico quedaron retirados; el
    // insert-only del módulo (cierre) ya garantiza una fila por locución y la
    // identidad de la fila es el locutionId.
    //
    // TIMBRE (mandato del dueño 2026-10-11/13): la fila se liga a SU voz por la
    // FIRMA medida por el módulo, no por la etiqueta — la misma voz da la misma
    // clave aunque su etiqueta provisional cambie (`voiceKeyFor`, dueño único).
    const firma = Array.isArray(evento.fila.firma) && evento.fila.firma.length
      ? [...evento.fila.firma]
      : null
    const clavePorTimbre = voiceKeyFor({
      voiceId: labelToSpeakerId(evento.fila.etiqueta),
      signature: firma,
    })
    useIntegrationStore.getState().addConversationEntry({
      id: evento.fila.locutionId,
      role: 'user',
      text: evento.fila.texto,
      timestamp: evento.fila.updated_at,
      // La fila publica el hablante REAL del módulo (N/X/XX/nombre). La vista
      // lo muestra tal cual: N no se convierte en XX (regla 7).
      speakerName: evento.fila.etiqueta,
      speakerId: clavePorTimbre,
      signature: firma,
      sessionId: evento.fila.sessionId,
      turnId: evento.fila.turnId,
      // La fila nació con la etiqueta TEMPORAL: la vista lo declara y la medida
      // tardía la reemplaza con `speaker.labeled` (mandato 2026-10-30).
      speakerPending: evento.fila.evidencia === 'pendiente',
      // El módulo es el ÚNICO escritor de la fila de usuario: el hook de
      // persistencia NO la reescribe (solo import/renombre autorizado).
      persistSpeakerName: false,
      meta: metaDeFilaConversacion(evento.fila, evento.fila.sessionId),
    })
    // High-water de la sesión: la clave automática (`speaker_N`) lo sube por el
    // raiser único del store; la próxima voz nueva numera sin reutilizar.
    const indice = autoSpeakerIndexFromKey(clavePorTimbre)
    if (indice != null && indice > 0) {
      useIntegrationStore.getState().noteSpeakerHighWater(indice)
    }
    // El HABLANTE de esta fila ya lo resolvió el módulo al cerrar. Su única
    // corrección posterior (la medida tardía sobre una etiqueta temporal) llega
    // por `speaker.labeled`, no por aquí: el texto y el resto de la fila no se
    // reescriben (mandato 2026-10-30).
    // Frontera de TURNO: una locución nueva. La promoción de la MISMA fila no lo es.
    if (esNuevaLocucion) {
      ultimaCommiteada = evento.fila.locutionId
      onLocucionCommiteada?.(evento.fila)
    }
    if (liveTimer) clearTimeout(liveTimer)
    liveTimer = 0
    // Una fila de nombre no tiene fuente de navegación donde caer: su frase se
    // queda en la caja hasta la siguiente frase/stop, sin retroceder (reglas 1/2).
    if (!nombreDicho) {
      // La caja se limpia para pasar los datos a la conversación: aquí SÍ se
      // reinicia la monotonía de la frase.
      ultimaViva = ''
      ultimaVivaLocucion = ''
      onLiveTranscript('')
    }
  })

  return {
    abrir: () => {
      generacion += 1
      cerrado = false
      ultimaViva = ''
      ultimaVivaLocucion = ''
      return motor.abrir()
    },
    evento: (evento) => {
      const interim = !traeFinal(evento)
      const ingesta = motor.evento(evento)
      // La frase se lee con el tramo ya resuelto por el módulo; el planificador
      // único de despacho aplica revisión/dedup sobre la MISMA frase canónica.
      void ingesta
        .then(() => despacharFraseVigente(interim))
        .catch((error) => logCaughtError('conversacion.hook.despacho.error', error))
      return ingesta
    },
    audio: (muestras, sampleRate, inicioMuestras) => motor.audio(muestras, sampleRate, inicioMuestras),
    cerrar: (motivo) => {
      cerrado = true
      const token = ++generacion
      const resultado = motor.cerrar(motivo)
      if (liveTimer) clearTimeout(liveTimer)
      liveTimer = 0
      if (nameCommandDeferTimer) clearTimeout(nameCommandDeferTimer)
      nameCommandDeferTimer = 0
      nameCommandDeferPayload = null
      // La caja se vacía cuando el motor ya persistió lo pendiente: si se vacía
      // antes, la última frase visible desaparece aunque su fila llegue después.
      return Promise.resolve(resultado).finally(() => {
        if (token === generacion) {
          ultimaViva = ''
          ultimaVivaLocucion = ''
          onLiveTranscript('')
        }
      })
    },
  }
}
