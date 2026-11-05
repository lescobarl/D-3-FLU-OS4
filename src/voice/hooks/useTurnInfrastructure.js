/**
 * Infraestructura del turno de voz: ciclo de vida (overlay + cronómetro) y
 * escritura de sesión fuera del camino crítico.
 *
 * Se extrajo de `useFluVoiceAssistant` por dos motivos:
 *   - el hook era un god-file vigilado por trinquete de tamaño (`godFileSizeGuard`);
 *   - eran dos preocupaciones transversales con su propio contrato, no orquestación
 *     del reconocimiento.
 *
 * Contratos que este módulo hace verdad (sin que el hook tenga que acordarse):
 *   - El overlay "Pensando" dura hasta que FLU EMPIEZA A HABLAR: se cierra al
 *     entrar en SPEAKING (único estado que lo sabe) y en ERROR (aborto).
 *   - La persistencia de sesión no bloquea la voz: se encola en orden.
 */
import { useEffect, useRef } from 'react'
import { createTurnLifecycle } from '../lib/turnLifecycle'
import { createOffPathWriter } from '../lib/offPathWriter'
import { useIntegrationStore } from '../../store/integrationStore'
import { relayLog } from '../../lib/clientLogRelay'

/**
 * Ciclo de vida del turno, ya cableado a los estados que lo cierran.
 * @returns {{ current: ReturnType<typeof createTurnLifecycle>|null }}
 */
export function useTurnLifecycleSync() {
  const turnLifecycleRef = useRef(null)
  if (!turnLifecycleRef.current) {
    turnLifecycleRef.current = createTurnLifecycle({
      getStore: () => useIntegrationStore.getState?.() || null,
      log: (msg) => relayLog('LOG', 'useFluVoiceAssistant', msg),
    })
  }

  // SPEAKING = FLU empezó a hablar (fin de la espera). ERROR = aborto. Ambas
  // transiciones se observan aquí en vez de repartir llamadas por cada ruta que
  // habla: si mañana aparece otra, el contrato sigue siendo verdad sin tocarla.
  // Solo importan si hay un turno esperando: si FLU habla sin turno vivo (voz de
  // comando, aviso), no hay espera que cerrar ni latencia que medir.
  useEffect(() => {
    const unsubscribe = useIntegrationStore.subscribe((state, prev) => {
      const anterior = prev?.conversationState
      if (!turnLifecycleRef.current?.isWorking()) return
      if (state.conversationState === 'SPEAKING' && anterior !== 'SPEAKING') {
        turnLifecycleRef.current.markSpeaking('flu-habla')
      }
      if (state.conversationState === 'ERROR' && anterior !== 'ERROR') {
        turnLifecycleRef.current.resetTurn('flu-error')
      }
    })
    return unsubscribe
  }, [])

  return turnLifecycleRef
}

/**
 * Escritor de sesión serializado y fuera del camino crítico.
 * @param {(payload: object) => Promise<unknown>} run
 * @param {(error: Error) => void} [onError]
 * @returns {{ write: (payload: object) => void, flush: () => Promise<unknown> }}
 */
export function useOffPathSessionWriter(run, onError) {
  const writerRef = useRef(null)
  if (!writerRef.current) {
    writerRef.current = createOffPathWriter(run, onError)
  }
  const writeRef = useRef(null)
  if (!writeRef.current) {
    writeRef.current = (payload) => writerRef.current.write(payload)
  }
  return { write: writeRef.current }
}
