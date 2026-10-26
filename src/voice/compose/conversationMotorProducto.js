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
 * Identidad del turno: medida acústica del preflight + nombre que el propio
 * hablante dice. Sin medida no se afirma otra voz; la continuidad la decide el
 * módulo con la etiqueta anterior de la MISMA sesión. Este módulo NO decide la
 * etiqueta de ninguna fila: entrega evidencia y el módulo resuelve.
 *
 * Frontera declarada (mandato 2026-10-26): solo utilidades puras y la medición
 * del preflight, envuelta AQUÍ una vez. Prohibido importar `commitUserTurnRow`,
 * `renameVoiceRowsByKey`, `conversationStreamCommit`, `transcriptIngress`,
 * `activeListen`, `turnStream` o `speakerDiarization` desde esta capa.
 */
import { metaDeFilaConversacion } from '../../core/db/conversationRowMapping'
import { logCaughtError } from '../../lib/caughtError.ts'
import { useIntegrationStore } from '../../store/integrationStore'
import { crearMotorConversacionProducto } from '../conversation/index'
import { resolveEchoContext } from '../lib/conversationDialogue.js'
import { labelToSpeakerId } from '../lib/conversationRow.js'
import { getLastCompletedSpeechAt } from '../lib/fluSpeech.js'
import { resolveSpeakerNameFromUtterance } from '../lib/speakerPolicy.js'
import { peekTurnSpeakerPreflight, preflightEvidenceMeasured } from '../lib/turnSpeakerPreflight.js'
import { normalizeSpeakerLabel } from '../lib/voiceIdentity'

/**
 * Evidencia de voz del turno en curso para el módulo de conversación.
 * @param {string} texto Texto reconocido del turno.
 * @param {number|string} turnId Turno activo.
 * @returns {{ vozId?: string, hablante?: string, nombre?: string, nombreConfirmado?: boolean }}
 */
function evidenciaVozDeTurno(texto, turnId) {
  const slot = peekTurnSpeakerPreflight(turnId)
  const nombreDicho = resolveSpeakerNameFromUtterance(texto)
  const medido = preflightEvidenceMeasured(slot)
  const hablante = medido ? normalizeSpeakerLabel(slot?.speakerName || '') : ''
  const vozId = medido ? String(slot?.speakerId || '') : ''
  const evidencia = {}
  if (vozId) evidencia.vozId = vozId
  if (hablante) evidencia.hablante = hablante
  if (nombreDicho) {
    evidencia.nombre = nombreDicho
    evidencia.nombreConfirmado = true
  }
  return evidencia
}

/**
 * Indica si el evento del reconocedor trae algún resultado final.
 * @param {{ results?: ArrayLike<object>, resultIndex?: number }} evento Evento del ASR.
 * @returns {boolean} true si al menos un resultado nuevo es final.
 */
function traeFinal(evento) {
  const resultados = evento?.results
  if (!resultados) return false
  const primero = evento.resultIndex ?? 0
  for (let indice = primero; indice < resultados.length; indice += 1) {
    if (resultados[indice]?.isFinal === true) return true
  }
  return false
}

/**
 * Compone el motor de conversación del producto con la vista del hook.
 * @param {object} opciones Idioma, turno, vista y ganchos del hook.
 * @param {'es'|'en'} opciones.idioma Idioma ya normalizado de la sesión.
 * @param {() => number|string} opciones.turnId Turno activo (se lee en cada uso).
 * @param {(fraseCanonica: string) => void} opciones.onLiveTranscript Publica la frase viva (completa, con wake).
 * @param {(fraseCanonica: string, opciones: {interim: boolean}) => void} opciones.onFraseCanonica Despacha la frase canónica.
 * @param {(fraseCanonica: string) => void} opciones.onTextoParaIdentidad Calienta la medida de voz del turno.
 * @param {(fila: object) => void} [opciones.onLocucionCommiteada] Cierre de locución (frontera de turno).
 * @returns {{ abrir: () => void, evento: (evento: unknown) => Promise<void>, audio: (muestras: Float32Array, sampleRate: number, inicioMuestras?: number) => void, cerrar: (motivo: string) => void }}
 */
export function crearMotorConversacionHook({
  idioma,
  turnId,
  onLiveTranscript,
  onFraseCanonica,
  onTextoParaIdentidad,
  onLocucionCommiteada,
}) {
  const motor = crearMotorConversacionProducto({
    idioma,
    participantId: useIntegrationStore.getState().activePersonId,
    ultimoTextoDicho: () =>
      resolveEchoContext(
        useIntegrationStore.getState().conversationHistory,
        getLastCompletedSpeechAt(),
      ).lastAssistantText,
    evidenciaVoz: (texto) => evidenciaVozDeTurno(texto, turnId()),
  })
  /** Última frase canónica despachada: el planificador decide dedup; esto evita repetir el mismo texto. */
  let ultimaDespachada = ''
  /** Última locución commiteada: `row.committed` puede repetirse al promover la fila. */
  let ultimaCommiteada = ''

  /**
   * Despacha la frase canónica vigente tras ingerir un evento del reconocedor.
   * Se lee la instantánea DESPUÉS de la ingesta: el módulo resolvió el tramo.
   * @param {boolean} interim Si el evento que motivó la ingesta era un interino.
   */
  function despacharFraseVigente(interim) {
    const frase = String(motor.instantanea().fraseCanonica || '').trim()
    if (!frase || frase === ultimaDespachada) return
    ultimaDespachada = frase
    onFraseCanonica(frase, { interim })
  }

  /**
   * Texto crudo del evento (solo para calentar la medida de voz ANTES de la
   * ingesta; no decide contenido: la frase canónica sigue siendo la del módulo).
   * @param {{ results?: ArrayLike<object>, resultIndex?: number }} evento Evento del ASR.
   * @returns {string} Primer transcript no vacío del evento.
   */
  function textoDelEvento(evento) {
    const resultados = evento?.results
    if (!resultados) return ''
    const primero = evento.resultIndex ?? 0
    for (let indice = primero; indice < resultados.length; indice += 1) {
      const texto = String(resultados[indice]?.[0]?.transcript || '').trim()
      if (texto) return texto
    }
    return ''
  }

  motor.suscribir((evento) => {
    if (evento.tipo === 'box.updated') {
      // La frase viva es la MISMA frase de la fila (Anexo B 3): va completa, con
      // wake. Quitarla es presentación de la barra, y lo hace la barra con el
      // splitter único (Anexo B 5); si aquí se recortara, la barra recibiría un
      // texto sin wake, no casaría y no mostraría ningún comando.
      onLiveTranscript(evento.abierta ? evento.fraseCanonica : '')
      return
    }
    if (evento.tipo !== 'row.committed') return
    useIntegrationStore.getState().setLastCommittedTranscript(evento.fila.texto)
    useIntegrationStore.getState().addConversationEntry({
      id: evento.fila.locutionId,
      role: 'user',
      text: evento.fila.texto,
      timestamp: evento.fila.updated_at,
      speakerName: evento.fila.etiqueta,
      speakerId: labelToSpeakerId(evento.fila.etiqueta),
      sessionId: evento.fila.sessionId,
      meta: metaDeFilaConversacion(evento.fila, evento.fila.sessionId),
    })
    // Ni renombre de filas ni re-etiquetado: la etiqueta ya la resolvió el módulo
    // al cerrar y las filas anteriores no se reescriben (mandato 2026-10-26).
    // Frontera de TURNO: una locución nueva. La promoción de la MISMA fila no lo es.
    if (evento.fila.locutionId !== ultimaCommiteada) {
      ultimaCommiteada = evento.fila.locutionId
      ultimaDespachada = ''
      onLocucionCommiteada?.(evento.fila)
    }
    onLiveTranscript('')
  })

  return {
    abrir: () => motor.abrir(),
    evento: (evento) => {
      const interim = !traeFinal(evento)
      // El preflight se calienta con el texto ANTES de la ingesta: la evidencia
      // de voz se lee durante `ingestAsr`, así que arrancarlo después llegaría
      // tarde para la primera locución del turno.
      const textoEvento = textoDelEvento(evento)
      if (textoEvento) onTextoParaIdentidad(textoEvento)
      const ingesta = motor.evento(evento)
      // La frase se lee con el tramo ya resuelto por el módulo; el planificador
      // único de despacho aplica revisión/dedup sobre la MISMA frase canónica.
      void ingesta
        .then(() => despacharFraseVigente(interim))
        .catch((error) => logCaughtError('conversacion.hook.despacho.error', error))
      return ingesta
    },
    audio: (muestras, sampleRate, inicioMuestras) => motor.audio(muestras, sampleRate, inicioMuestras),
    cerrar: (motivo) => motor.cerrar(motivo),
  }
}
