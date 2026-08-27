import { useEffect, useMemo, useRef, memo } from 'react'
import { formatEmbeddingPreview } from '../lib/audioMath'
import { formatRowClock } from '../lib/conversationRow'
import { FLU_CONFIG } from '../lib/fluConfig'

function formatCompactLogText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

const showEmbeddingPreview = Boolean(FLU_CONFIG.debug?.showEmbeddingPreview)

export const ConversationLog = memo(function ConversationLog({ entries = [], emptyLabel }) {
  const listRef = useRef(null)
  const entryCountRef = useRef(0)
  const displayRows = useMemo(() => {
    // FIX duplicación: addFluMessage (integrationStore.ts) escribe la respuesta de FLU
    // DOS veces: la adjunta al último turno del usuario (campo .response / meta.response)
    // y ADEMÁS agrega una entrada independiente role='flu' con el mismo texto. Aquí
    // recolectamos los textos de las entradas FLU independientes para NO volver a pintar
    // la respuesta adjunta cuando ya se muestra como fila propia (elimina el duplicado
    // visible en el log SIN tocar el store, que Gemini/persistencia/exportación necesitan).
    const fluTexts = new Set()
    for (const entry of entries) {
      if (entry.role === 'flu') {
        fluTexts.add(formatCompactLogText(entry?.text ?? entry?.transcript))
      }
    }
    const rows = []
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      const isSystem = entry.role === 'system'
      const compactResponse = formatCompactLogText(
        entry.meta?.response ? entry.meta.response : entry.response || '',
      )
      const showResponse = Boolean(compactResponse) && !fluTexts.has(compactResponse)
      rows.push({
        id: entry.id,
        clock: formatRowClock(entry) || formatCompactLogText(entry?.timestamp),
        speakerName: isSystem
          ? '⚙️ Sistema'
          : formatCompactLogText(entry?.speakerName ?? entry?.speaker),
        vectorPreview: showEmbeddingPreview ? formatEmbeddingPreview(entry?.signature) : '',
        text: formatCompactLogText(entry?.text ?? entry?.transcript),
        response: showResponse ? compactResponse : '',
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

  if (!entries.length) {
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
              {entry.response ? <span>{entry.response}</span> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
})
