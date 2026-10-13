import { useEffect, useMemo, useRef, memo } from 'react'
import { formatEmbeddingPreview } from '../lib/audioMath'
import { formatRowClock } from '../lib/conversationRow'
import { FLU_CONFIG } from '../lib/fluConfig'
import { resolveRowSpeakerLabel } from '../lib/conversationRow'

function formatCompactLogText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

const showEmbeddingPreview = Boolean(FLU_CONFIG.debug?.showEmbeddingPreview)

export const ConversationLog = memo(function ConversationLog({ entries = [], emptyLabel }) {
  const listRef = useRef(null)
  const entryCountRef = useRef(0)
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
      rows.push({
        id: entry.id,
        clock: formatRowClock(entry) || formatCompactLogText(entry?.timestamp),
        // El nombre NO vive en la fila: se resuelve AL MOSTRAR y por la VOZ (mandato 2026-10-13).
        speakerName: isSystem ? '⚙️ Sistema' : resolveRowSpeakerLabel(entry),
        vectorPreview: showEmbeddingPreview ? formatEmbeddingPreview(entry?.signature) : '',
        text: formatCompactLogText(entry?.text ?? entry?.transcript),
        isSystem,
      })
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
        {displayRows.map((entry) => {
          return (
            <div key={entry.id} className={`audit-item${entry.isSystem ? ' audit-item--system' : ''}`}>
              <div className="audit-item__meta">
                <span className="audit-item__clock">{entry.clock}</span>
                <span className="audit-item__speaker">{entry.speakerName}</span>
              </div>
              {entry.vectorPreview ? (
                <span className="audit-item__vector">{entry.vectorPreview}</span>
              ) : null}
              <p>{entry.text}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
})
