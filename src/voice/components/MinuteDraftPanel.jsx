import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { FLU_CONFIG } from '../lib/fluConfig'
import { formatMinuteDraftText, parseMinuteDraftText } from '../lib/minuteKnowledge'

export const MinuteDraftPanel = forwardRef(function MinuteDraftPanel(
  { draft, onChange, onSave, emptyLabel },
  ref,
) {
  const [text, setText] = useState('')
  const draftKey = draft?.id || `${draft?.titulo || ''}|${draft?.tema_sesion || ''}`

  useEffect(() => {
    setText(formatMinuteDraftText(draft))
  }, [draftKey])

  const handleSave = () => {
    if (!draft) return
    const nextDraft = parseMinuteDraftText(text, draft)
    onChange?.(nextDraft)
    onSave?.(nextDraft)
  }

  useImperativeHandle(ref, () => ({
    save: handleSave,
  }))

  if (!draft) {
    return <p className="panel__hint panel__hint--compact">{emptyLabel}</p>
  }

  return (
    <div className="minute-draft">
      <textarea
        className="minute-draft__textarea"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={emptyLabel}
        spellCheck
      />
    </div>
  )
})
