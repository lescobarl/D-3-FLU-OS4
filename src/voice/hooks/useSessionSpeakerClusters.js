/**
 * useSessionSpeakerClusters — dueño ÚNICO del ref y del setter de clusters de hablante.
 *
 * Se extrajo de `useFluVoiceAssistant` para que el god-file no siguiera creciendo
 * (trinquete `godFileSizeGuard`) sin repartir la responsabilidad: aquí vive la
 * escritura de clusters, no la orquestación del reconocimiento.
 *
 * Contrato que este hook hace verdad:
 *   - TODA escritura pasa por `setClusters` (forma de setter de React: valor o
 *     función) y queda SEMBRADA con las anclas de voz MEDIDAS de la base de
 *     participantes: una voz conocida se resuelve con su nombre desde su primer
 *     turno sostenido (mandato del dueño 2026-10-18), sin esperar al contrato.
 *   - La sesión manda: `seedRegisteredAnchors` no reescribe un nombre ya vivo.
 *   - La base puede cargar DESPUÉS de la primera frase: al llegar sus anclas se
 *     re-siembra por el mismo punto de escritura, sin tocar nombres resueltos.
 */
import { useCallback, useEffect, useRef } from 'react'
import { seedRegisteredAnchors, setSessionClustersProvider } from '../lib/speakerClusters.js'
import { voiceVectorModel } from '../lib/speakerDirectory.js'
import { voiceProbe } from '../lib/voiceProbe'

/**
 * @param {{ current: any[] }} ref
 *   Ref de los clusters de la sesion, declarado por el hook consumidor (`useRef([])`):
 *   es SU estado. Aqui vive la politica de escritura, no el almacenamiento.
 * @param {Array<{ name?: string, vector?: number[], model?: string }>} participantVoiceAnchors
 *   Anclas medidas de la base de participantes (`{ name, vector, model }`).
 * @returns {{ setClusters: (next: any) => void }}
 */
export function useSessionSpeakerClusters(ref, participantVoiceAnchors) {
  // Anclas sincronizadas desde la prop: `setClusters` las lee en CADA escritura.
  const participantAnchorsRef = useRef([])

  /**
   * §9 ÚNICO punto de escritura de los clusters de hablante.
   * El COMMIT es autoritativo; el segmento solo propone (no persiste).
   * @param {any[] | ((current: any[]) => any[])} next
   */
  const setClusters = useCallback((next) => {
    const raw = typeof next === 'function' ? next(ref.current) : next
    // Voz conocida en la base = nombre inmediato: TODA escritura queda sembrada con
    // las anclas de participantes, incluido el reset de sesion (que escribe `[]`).
    const seeded = seedRegisteredAnchors(raw, participantAnchorsRef.current, { model: voiceVectorModel() })
    ref.current = seeded || raw
    voiceProbe('clusters', { write: ref.current?.length ?? 0, labels: (ref.current || []).map((c) => c?.label), seeded: Boolean(seeded) }) // BANDERA DE DIAGNOSTICO
  }, [ref])

  useEffect(() => {
    // LECTURA de los clusters vivos para los consumidores que deciden la etiqueta de una
    // fila cerrada sin recibir el ref (auditoria 2026-10-23). Este hook es su dueno.
    setSessionClustersProvider(() => ref.current || [])
    return () => setSessionClustersProvider(null)
  }, [ref])

  useEffect(() => {
    const anchors = Array.isArray(participantVoiceAnchors) ? participantVoiceAnchors : []
    participantAnchorsRef.current = anchors
    // DIAGNOSTICO: por que una voz conocida no se sembro (sin ancla, sin modelo o de otro
    // modelo|dtype no es comparable). Sin esto el log no dice si la base venia vacia.
    const model = voiceVectorModel()
    voiceProbe('anchors', {
      count: anchors.length,
      labels: anchors.map((anchor) => anchor?.name || ''),
      models: anchors.map((anchor) => anchor?.model || ''),
      usable: anchors.filter((anchor) => String(anchor?.model || '') === model && Array.isArray(anchor?.vector) && anchor.vector.length > 0).length,
      model,
    })
    // La base puede cargar DESPUES de la primera frase: se siembra al llegar por el
    // unico punto de escritura (§9), sin tocar nombres ya resueltos en sesion.
    if (anchors.length) setClusters((current) => current)
  }, [participantVoiceAnchors, setClusters])

  return { setClusters }
}
