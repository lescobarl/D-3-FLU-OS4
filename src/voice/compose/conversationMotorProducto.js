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
 * Prohibido reimplementar aquí la escritura de filas, la identidad o los dueños
 * `commitUserTurnRow`/`renameVoiceRowsByKey`; viven en `../conversation`.
 */
import { metaDeFilaConversacion } from '../../core/db/conversationRowMapping'
import { logCaughtError } from '../../lib/caughtError.ts'
import { useIntegrationStore } from '../../store/integrationStore'
import { crearMotorConversacionProducto, traeFinal } from '../conversation/index'
import { resolveEchoContext } from '../lib/conversationDialogue.js'
import { labelToSpeakerId } from '../lib/conversationRow.js'
import { getLastCompletedSpeechAt } from '../lib/fluSpeech.js'

/**
 * Compone el motor de conversación del producto con la vista del hook.
 * @param {object} opciones Idioma, turno, vista y ganchos del hook.
 * @param {'es'|'en'} opciones.idioma Idioma ya normalizado de la sesión.
 * @param {() => number|string} opciones.turnId Turno activo (se lee en cada uso).
 * @param {(fraseCanonica: string) => void} opciones.onLiveTranscript Publica la frase viva (completa, con wake).
 * @param {(fraseCanonica: string, opciones: {interim: boolean}) => void} opciones.onFraseCanonica Despacha la frase canónica.
 * @param {(fila: object) => void} [opciones.onLocucionCommiteada] Cierre de locución (frontera de turno).
 * @returns {{ abrir: () => void, evento: (evento: unknown) => Promise<void>, audio: (muestras: Float32Array, sampleRate: number, inicioMuestras?: number) => void, cerrar: (motivo: string) => void }}
 */
export function crearMotorConversacionHook({
  idioma,
  turnId,
  onLiveTranscript,
  onFraseCanonica,
  onLocucionCommiteada,
}) {
  const motor = crearMotorConversacionProducto({
    idioma,
    participantId: useIntegrationStore.getState().activePersonId,
    // El proveedor se lee POR EVENTO en el producto: el motor queda abierto entre
    // locuciones y el número de turno avanza con cada commit del hook.
    turnId: () => (typeof turnId === 'function' ? turnId() : null),
    ultimoTextoDicho: () =>
      resolveEchoContext(
        useIntegrationStore.getState().conversationHistory,
        getLastCompletedSpeechAt(),
      ).lastAssistantText,
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
    // ESCRITOR SIMÉTRICO: si el escritor del turno (App, modo pasivo sin cierre VAD)
    // ya escribió la fila del MISMO turno, el módulo NO la duplica: completa solo la
    // frontera de abajo. La identidad de la fila es el TURNO, no el locutionId.
    const turno = String(evento.fila.turnId ?? '').trim()
    const yaEscritaPorElTurno = turno
      ? [...(useIntegrationStore.getState().conversationHistory || [])]
          .reverse()
          .find((e) => e?.role === 'user' && String(e.turnId ?? '').trim() === turno)
      : null
    if (!yaEscritaPorElTurno) {
      useIntegrationStore.getState().addConversationEntry({
        id: evento.fila.locutionId,
        role: 'user',
        text: evento.fila.texto,
        timestamp: evento.fila.updated_at,
        speakerName: evento.fila.etiqueta,
        speakerId: labelToSpeakerId(evento.fila.etiqueta),
        sessionId: evento.fila.sessionId,
        turnId: evento.fila.turnId,
        meta: metaDeFilaConversacion(evento.fila, evento.fila.sessionId),
      })
    }
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
