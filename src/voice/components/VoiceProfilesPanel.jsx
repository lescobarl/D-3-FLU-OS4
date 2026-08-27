import { useMemo, useState } from 'react'
import { FLU_CONFIG } from '../lib/fluConfig'

export function VoiceProfilesPanel({
  participants = [],
  onRenameProfile,
  onRenameSessionSpeaker,
  onRemoveParticipant,
}) {
  const [editingKey, setEditingKey] = useState('')
  const [draftName, setDraftName] = useState('')

  const rows = useMemo(
    () =>
      participants.map((participant) => ({
        key: participant.key || participant.label,
        label: participant.label || participant.key,
        profileId: participant.profileId || '',
      })),
    [participants],
  )

  const beginRename = (row) => {
    setEditingKey(row.key)
    setDraftName(row.label)
  }

  const commitRename = async (row) => {
    const nextName = String(draftName || '').trim()
    setEditingKey('')
    setDraftName('')
    if (!nextName || nextName === row.label) return

    if (row.profileId) {
      await onRenameProfile?.(row.profileId, nextName)
      return
    }

    await onRenameSessionSpeaker?.(row.label, nextName)
  }

  if (!rows.length) {
    return <p className="panel__hint">{FLU_CONFIG.ui.workspace.participantsEmpty}</p>
  }

  return (
    <div className="participants-panel__scroll">
      <div className="voice-profiles">
        <ul className="voice-profiles__list">
          {rows.map((row) => (
            <li key={row.key} className="voice-profiles__item">
              {editingKey === row.key ? (
                <input
                  className="voice-profiles__input"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={() => commitRename(row)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename(row)
                    if (event.key === 'Escape') {
                      setEditingKey('')
                      setDraftName('')
                    }
                  }}
                  autoFocus
                />
              ) : (
                <span className="voice-profiles__name">{row.label}</span>
              )}
              <div className="voice-profiles__actions">
                <button type="button" className="voice-profiles__button" onClick={() => beginRename(row)}>
                  Renombrar
                </button>
                <button
                  type="button"
                  className="voice-profiles__button voice-profiles__button--danger"
                  onClick={() => onRemoveParticipant?.(row)}
                >
                  Eliminar
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
