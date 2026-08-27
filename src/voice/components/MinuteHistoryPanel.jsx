import { formatMinuteHistoryLabel } from '../lib/minuteKnowledge'

export function MinuteHistoryPanel({ entries = [], selectedId = '', onSelect, emptyLabel = '' }) {
  if (!entries.length) {
    return emptyLabel ? <p className="panel__hint panel__hint--compact">{emptyLabel}</p> : null
  }

  return (
    <div className="minute-history__scroll">
      <div className="minute-history minute-history--compact" role="list">
        {entries.map((entry) => {
          const selected = selectedId && entry.id === selectedId
          return (
            <button
              key={entry.id}
              type="button"
              role="listitem"
              className={['minute-history__row', selected ? 'minute-history__row--selected' : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelect?.(entry)}
              title={formatMinuteHistoryLabel(entry)}
            >
              {formatMinuteHistoryLabel(entry)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
