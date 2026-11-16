import { useEffect, useMemo, useRef, memo } from 'react'
import { formatEmbeddingPreview } from '../lib/audioMath'
import { formatRowClock } from '../lib/conversationRow'
import { FLU_CONFIG } from '../lib/fluConfig'
import { resolveRowSpeakerLabel } from '../lib/conversationRow'

function formatCompactLogText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

const showEmbeddingPreview = Boolean(FLU_CONFIG.debug?.showEmbeddingPreview)

/**
 * Fila MEMOIZADA de la conversacion: un INSERT monta SOLO la fila nueva y un cambio de VOZ
 * redibuja SOLO las filas de esa voz. Antes, cada entrada nueva redibujaba las N filas.
 */
const FilaDeConversacion = memo(function FilaDeConversacion({ fila }) {
  const reloj = formatRowClock(fila.entry) || formatCompactLogText(fila.entry?.timestamp)
  const clase = "audit-item" + (fila.isSystem ? " audit-item--system" : "")
  return (
    <div className={clase}>
      <div className="audit-item__meta">
        <span className="audit-item__clock">{reloj}</span>
        <span className="audit-item__speaker">{fila.speakerName}</span>
      </div>
      {fila.vectorPreview ? <span className="audit-item__vector">{fila.vectorPreview}</span> : null}
      <p>{fila.text}</p>
    </div>
  )
})
export const ConversationLog = memo(function ConversationLog({ entries = [], emptyLabel }) {
  const listRef = useRef(null)
  const entryCountRef = useRef(0)
  // Cache de filas por ENTRADA: si el texto y el nombre no cambian, la fila conserva su objeto
  // (la fila memoizada no se redibuja). Un cambio de VOZ cambia el nombre -> fila nueva -> se
  // redibuja SOLO esa.
  const filasCacheRef = useRef(new WeakMap())
  const displayRows = useMemo(() => {
    // Los eventos narrativos internos de FLU (`meta.systemEvent`, p. ej.
    // "[FLU recuerda] ...") viven en el historial porque Gemini los usa como
    // contexto, pero NO son filas de conversación: se excluyen de la bitácora
    // (presentación). La fuente única (el store) queda intacta.
    // P9.82: cada intervencion de FLU es UNA fila (`role='flu'`, la escribe
    // `logFluReply`). El campo `response` del turno del usuario y el parche de
    // presentacion que lo escondia se retiraron: no hay duplicado que tapar.
    const visibleEntries = entries.filter((entry) => !entry?.meta?.systemEvent)
    const rows = []
    for (let index = visibleEntries.length - 1; index >= 0; index -= 1) {
      const entry = visibleEntries[index]
      const isSystem = entry.role === 'system'
      const fila = {
        entry,
        id: entry.id,
        // El nombre NO vive en la fila: se resuelve AL MOSTRAR y por la VOZ (mandato 2026-10-13).
        speakerName: isSystem ? '⚙️ Sistema' : resolveRowSpeakerLabel(entry),
        vectorPreview: showEmbeddingPreview ? formatEmbeddingPreview(entry?.signature) : '',
        text: formatCompactLogText(entry?.text ?? entry?.transcript),
        isSystem,
      }
      const previa = filasCacheRef.current.get(entry)
      const sinCambios =
        previa &&
        previa.speakerName === fila.speakerName &&
        previa.text === fila.text &&
        previa.vectorPreview === fila.vectorPreview &&
        previa.isSystem === fila.isSystem
      rows.push(sinCambios ? previa : fila)
      if (!sinCambios) filasCacheRef.current.set(entry, fila)
    }
    return rows
  }, [entries])

  useEffect(() => {
    const node = listRef.current
    if (!node) return
    const isNewRow = entries.length > entryCountRef.current
    entryCountRef.current = entries.length
    if (isNewRow) {
      node.scrollTop = 0
    }
  }, [entries])

  if (!displayRows.length) {
    return <p className="panel__hint">{emptyLabel}</p>
  }

  return (
    <div ref={listRef} className="conversation-panel__scroll">
      <div className="audit-list audit-list--conversation">
        {displayRows.map((entry) => (
          <FilaDeConversacion key={entry.id} fila={entry} />
        ))}
      </div>
    </div>
  )
})
