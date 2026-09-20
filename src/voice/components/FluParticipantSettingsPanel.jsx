import { useCallback, useState } from 'react'
import { useIntegrationStore } from '../../store/integrationStore'
import { useSettingsSaveRegistration } from '../../components/SettingsSaveContext'
import { resolveAppLanguage } from '../lib/audioMath.js'
import { resolveFluParticipantLabel } from '../lib/participantFloor.js'
import { speakResponse } from '../lib/fluSpeech.js'
import {
  FLU_PARTICIPANT_EDITABLE_FIELDS,
  getFluParticipantConfig,
  msToConfigMinutes,
  resetFluParticipantOverrides,
  resolveFluParticipantFieldHint,
  resolveFluParticipantFieldLabel,
  setFluParticipantOverrides,
} from '../lib/fluParticipantConfig.js'

function readFieldValue(key, cfg) {
  const field = FLU_PARTICIPANT_EDITABLE_FIELDS.find((item) => item.key === key)
  if (field?.type === 'durationMinutes') {
    return msToConfigMinutes(cfg[key])
  }
  if (field?.type === 'boolean') {
    return cfg[key] !== false
  }
  return cfg[key]
}

function buildDraftFromConfig(cfg) {
  const draft = {}
  for (const field of FLU_PARTICIPANT_EDITABLE_FIELDS) {
    draft[field.key] = readFieldValue(field.key, cfg)
  }
  return draft
}

function serializeDraftForSave(draft) {
  const payload = {}
  for (const field of FLU_PARTICIPANT_EDITABLE_FIELDS) {
    payload[field.key] = draft[field.key]
  }
  return payload
}

export default function FluParticipantSettingsPanel({
  language = 'es',
  onConfigChange,
  voices,
}) {
  const lang = resolveAppLanguage(language, '')
  const [draft, setDraft] = useState(() => buildDraftFromConfig(getFluParticipantConfig()))

  const updateField = useCallback((key, value) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSave = useCallback(() => {
    const next = setFluParticipantOverrides(serializeDraftForSave(draft))
    setDraft(buildDraftFromConfig(next))
    onConfigChange?.(next)
  }, [draft, onConfigChange])

  const handleReset = useCallback(() => {
    const next = resetFluParticipantOverrides()
    setDraft(buildDraftFromConfig(next))
    onConfigChange?.(next)
  }, [onConfigChange])

  // Guardar/Restablecer GLOBAL del configurador (barra al pie de Configuración).
  useSettingsSaveRegistration('flu-participant', { commit: handleSave, reset: handleReset })

  const integrationStore = useIntegrationStore?.() ?? null
  const safeVoices = Array.isArray(voices) ? voices : []

  return (
    <details className="flu-settings-image-config">
      <summary className="flu-settings-image-config__summary">
        <span className="flu-settings-image-config__icon">🔊</span>
        <span>{resolveFluParticipantLabel('panelTitle', lang)}</span>
      </summary>
      <div className="flu-settings-image-config__body">
        {/* ---- Voz: selector global ---- */}
        <div className="flu-settings-image-config__group">
          <div className="flu-settings-image-config__group-title">🗣️ Voz</div>
          <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
            <span className="flu-settings-image-config__section-label">Seleccionar voz</span>
            <div className="flu-settings-row" style={{ gap: 8 }}>
              <select
                value={integrationStore?.voiceConfig?.voiceURI || ''}
                onChange={(e) => {
                  const selected = safeVoices.find(v => v.voiceURI === e.target.value);
                  if (selected && integrationStore?.setVoiceConfig) {
                    integrationStore.setVoiceConfig({ voiceURI: selected.voiceURI, voiceName: selected.name });
                  }
                }}
                className="flu-settings-image-config__input"
                style={{ flex: 1 }}
              >
                <option value="">— Sin preferencia —</option>
                {safeVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="flu-btn flu-btn--primary"
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => {
                  // §9: el preview de voz usa la ruta ÚNICA de TTS (speakResponse),
                  // sin tocar el motor de síntesis directo. Así respeta el estado
                  // de voz (eco/barge-in) y suspende la escucha como el resto de FLU.
                  speakResponse(
                    lang === 'en'
                      ? 'Hello, I am FLU. This is my voice.'
                      : 'Hola, soy FLU. Esta es mi voz.',
                    lang === 'en' ? 'en' : 'es'
                  ).catch(() => {});
                }}
              >
                ▶ Probar
              </button>
            </div>
          </label>
        </div>

        {/* ---- Parámetros del participante ---- */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__title">⚙️ Parámetros</div>
          <div className="flu-settings-section__body flu-settings-fields-grid">
            {FLU_PARTICIPANT_EDITABLE_FIELDS.map((field) => {
              const label = resolveFluParticipantFieldLabel(field.key, lang)
              const hint = resolveFluParticipantFieldHint(field.key, lang)
              const id = `flu-participant-${field.key}`

              if (field.type === 'boolean') {
                return (
                  <label key={field.key} className="flu-settings-image-config__field flu-settings-image-config__field--checkbox flu-settings-fields-grid__full" htmlFor={id}>
                    <input
                      id={id}
                      type="checkbox"
                      checked={Boolean(draft[field.key])}
                      onChange={(event) => updateField(field.key, event.target.checked)}
                    />
                    <span>{label}</span>
                    {hint ? <span className="flu-settings-hint">{hint}</span> : null}
                  </label>
                )
              }

              return (
                <label key={field.key} className="flu-settings-image-config__field flu-settings-image-config__field--stacked" htmlFor={id}>
                  <span className="flu-settings-image-config__section-label">{label}</span>
                  <input
                    id={id}
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={draft[field.key]}
                    onChange={(event) => updateField(field.key, event.target.value)}
                    className="flu-settings-image-config__input"
                    style={{ maxWidth: '100%' }}
                  />
                  {hint ? <span className="flu-settings-hint">{hint}</span> : null}
                </label>
              )
            })}
          </div>
        </div>
      </div>
    </details>
  )
}
