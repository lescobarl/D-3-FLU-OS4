# Backup: Configuration Module (Settings)

> **Date:** 2026-07-17
> **Source files:** `src/App.tsx`, `src/App.css`, `src/voice/components/FluParticipantSettingsPanel.jsx`
> **Purpose:** Complete backup of the settings/configuration module before making further changes.

---

## 1. Settings State Declarations (App.tsx lines 1012-1051)

```typescript
// ============================================================
// Settings state
// ============================================================
const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    try { return localStorage.getItem('flu_selected_voice') || ''; }
    catch { return ''; }
});
const [voiceRate, setVoiceRate] = useState<number>(() => {
    try { return parseFloat(localStorage.getItem('flu_voice_rate') || '1.0'); }
    catch { return 1.0; }
});
const [voicePitch, setVoicePitch] = useState<number>(() => {
    try { return parseFloat(localStorage.getItem('flu_voice_pitch') || '1.0'); }
    catch { return 1.0; }
});
const [voiceVolume, setVoiceVolume] = useState<number>(() => {
    try { return parseFloat(localStorage.getItem('flu_voice_volume') || '1.0'); }
    catch { return 1.0; }
});
const [testVoiceText, setTestVoiceText] = useState<string>('');

// ============================================================
// Profile state
// ============================================================
const [selectedProfile, setSelectedProfile] = useState<string>(() => {
    try { return localStorage.getItem('flu_selected_profile') || FLU_PROFILES[0]?.id || 'profesor'; }
    catch { return FLU_PROFILES[0]?.id || 'profesor'; }
});

const [profileTraits, setProfileTraits] = useState<string[]>(() => {
    try {
        const saved = localStorage.getItem('flu_profile_traits');
        return saved ? JSON.parse(saved) : [];
    }
    catch { return []; }
});

const [profileTone, setProfileTone] = useState<string>(() => {
    try { return localStorage.getItem('flu_profile_tone') || ''; }
    catch { return ''; }
});
```

## 2. Settings localStorage Persistence (App.tsx lines 1056-1076)

```typescript
// ============================================================
// Save settings to localStorage
// ============================================================
useEffect(() => {
    try { localStorage.setItem('flu_selected_voice', selectedVoice); } catch { }
}, [selectedVoice]);
useEffect(() => {
    try { localStorage.setItem('flu_voice_rate', String(voiceRate)); } catch { }
}, [voiceRate]);
useEffect(() => {
    try { localStorage.setItem('flu_voice_pitch', String(voicePitch)); } catch { }
}, [voicePitch]);
useEffect(() => {
    try { localStorage.setItem('flu_voice_volume', String(voiceVolume)); } catch { }
}, [voiceVolume]);
useEffect(() => {
    try { localStorage.setItem('flu_selected_profile', selectedProfile); } catch { }
}, [selectedProfile]);
useEffect(() => {
    try { localStorage.setItem('flu_profile_traits', JSON.stringify(profileTraits)); } catch { }
}, [profileTraits]);
useEffect(() => {
    try { localStorage.setItem('flu_profile_tone', profileTone); } catch { }
}, [profileTone]);
```

## 3. Profile Application Effect (App.tsx lines 1081-1086)

```typescript
// ============================================================
// Apply profile when selectedProfile changes
// ============================================================
useEffect(() => {
    const profile = FLU_PROFILES.find((p: FluProfile) => p.id === selectedProfile);
    if (profile) {
        integrationStore.applyProfile(profile);
    }
}, [selectedProfile, integrationStore]);
```

## 4. Settings Handlers (App.tsx lines 1091-1157)

```typescript
// ============================================================
// Test voice handler
// ============================================================
const handleTestVoice = useCallback(() => {
    const text = testVoiceText || (language === 'en' ? 'Hello, this is a voice test.' : 'Hola, esta es una prueba de voz.');
    const utterance = new SpeechSynthesisUtterance(text);
    if (selectedVoice) {
        const voice = voices.find((v) => v.name === selectedVoice);
        if (voice) utterance.voice = voice;
    }
    utterance.rate = voiceRate;
    utterance.pitch = voicePitch;
    utterance.volume = voiceVolume;
    window.speechSynthesis.speak(utterance);
}, [testVoiceText, selectedVoice, voices, voiceRate, voicePitch, voiceVolume, language]);

// ============================================================
// Gemini API key save handlers
// ============================================================
const handleSaveApiKey = useCallback((key: string) => {
    setApiKey(key);
    try { localStorage.setItem(STORAGE_KEYS.TEXT_API_KEY, key); } catch { }
}, []);
const handleSaveTextModel = useCallback((model: string) => {
    setTextModel(model);
    try { localStorage.setItem(STORAGE_KEYS.TEXT_MODEL, model); } catch { }
}, []);
const handleSaveTextApiUrl = useCallback((url: string) => {
    setTextApiUrl(url);
    try { localStorage.setItem(STORAGE_KEYS.TEXT_API_URL, url); } catch { }
}, []);
const handleSaveImageApiKey = useCallback((key: string) => {
    setImageApiKey(key);
    try { localStorage.setItem(STORAGE_KEYS.IMAGE_API_KEY, key); } catch { }
}, []);
const handleSaveImageModel = useCallback((model: string) => {
    setImageModel(model);
    try { localStorage.setItem(STORAGE_KEYS.IMAGE_MODEL, model); } catch { }
}, []);
const handleSaveImageApiUrl = useCallback((url: string) => {
    setImageApiUrl(url);
    try { localStorage.setItem(STORAGE_KEYS.IMAGE_API_URL, url); } catch { }
}, []);

// ============================================================
// Language handler
// ============================================================
const handleLanguageChange = useCallback((lang: 'es' | 'en' | 'both') => {
    setLanguage(lang);
    try { localStorage.setItem(STORAGE_KEYS.LANGUAGE, lang); } catch { }
}, []);

// ============================================================
// Session role handler
// ============================================================
const handleSessionRoleChange = useCallback((role: string) => {
    setSessionRole(role);
    try { localStorage.setItem(STORAGE_KEYS.SESSION_ROLE, role); } catch { }
}, []);

// ============================================================
// Navigation command handler (from voice)
// ============================================================
const handleNavigationCommand = useCallback((command: string) => {
    if (command === 'workspace' || command === 'pizarron') setActiveTab('workspace');
    else if (command === 'conversation' || command === 'bitacora') setActiveTab('conversation');
    else if (command === 'minutes' || command === 'minutas') setActiveTab('minutes');
    else if (command === 'config' || command === 'configuracion') setActiveTab('config');
    else if (command === 'settings' || command === 'ajustes') setActiveTab('settings');
}, []);
```

## 5. Settings Tab Render (App.tsx lines 1534-1560)

```tsx
{/* Settings Tab — OS2 parity: flu-settings-panel wrapper with flat layout (no card grid) */}
<FluTabPanel tabId="settings" activeTab={activeTab} className="flu-tab-panel--settings">
    <section className="flu-settings-panel">
        {/* OS2 parity: language + session role grid (FluShell.jsx lines 1436-1449) */}
        <div className="flu-settings-panel__grid">
            <label className="settings-row__field">
                <span>{FLU_CONFIG.ui.settings.language}</span>
                <select value={language} onChange={(e) => handleLanguageChange(e.target.value as 'es' | 'en' | 'both')}>
                    <option value="both">{FLU_CONFIG.ui.settings.languageBoth}</option>
                    <option value="es">{FLU_CONFIG.ui.settings.languageEs}</option>
                    <option value="en">{FLU_CONFIG.ui.settings.languageEn}</option>
                </select>
            </label>
            <label className="settings-row__field hero-status-field">
                <span>{FLU_CONFIG.ui.settings.sessionRole}</span>
                <strong>{sessionRole}</strong>
            </label>
        </div>
        <FluParticipantSettingsPanel
            language={language}
            apiKey={apiKey}
            onApiKeyCommit={setApiKey}
            onConfigChange={handleParticipantConfigChange}
            voices={voices}
        />
    </section>
</FluTabPanel>
```

## 6. Settings Panel CSS (App.css lines 1400-1477)

```css
/* ---- Settings Tab — redesigned: compact, inline labels+inputs ---- */

.flu-settings-panel {
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
    max-height: calc(100vh - 120px);
}

/* Make the configurator body itself allow overflow when in narrow panels */
.flu-settings-image-config__body--flu-config {
    overflow: visible;
}

/* Top row: Idioma + Rol de sesión side by side — flat, no card frame */
.flu-settings-panel__grid {
    display: flex;
    flex-direction: row;
    gap: 12px;
    flex-wrap: wrap;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
}

/* Each settings row: label + input inline */
.settings-row__field {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    flex: 0 1 auto;
}

/* Override OS2 uppercase on settings labels */
.settings-row__field span {
    text-transform: none !important;
    font-size: var(--fs-small);
    color: #bbb;
    font-weight: 500;
    letter-spacing: 0.01em;
    white-space: nowrap;
}

.settings-row__field select {
    padding: 3px 6px;
    border-radius: 5px;
    border: 1px solid rgba(100, 140, 255, 0.2);
    background: rgba(255, 255, 255, 0.04);
    color: #e0e0e0;
    font-size: var(--fs-small);
    font-family: inherit;
    outline: none;
    cursor: pointer;
    transition: border-color 0.2s;
    width: auto;
    min-width: 100px;
    max-width: 160px;
}

.settings-row__field select:focus {
    border-color: rgba(100, 140, 255, 0.5);
}

.settings-row__field select:hover {
    border-color: rgba(100, 140, 255, 0.35);
}

.hero-status-field strong {
    color: #8ab4ff;
    font-weight: 700;
    font-size: var(--fs-base);
}
```

## 7. Image Configuration Section CSS (App.css lines 1478-1679)

```css
/* ---- 🖼️ Image Configuration Section (Settings Tab) ---- */

.flu-settings-image-config {
    border: 1px solid var(--brand-border);
    border-radius: 8px;
    background: rgba(13, 13, 36, 0.6);
    overflow: visible;
}

.flu-settings-image-config__summary {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    cursor: pointer;
    font-size: var(--fs-small);
    font-weight: 600;
    color: var(--brand-primary-light);
    background: rgba(21, 21, 58, 0.5);
    border-bottom: 1px solid transparent;
    user-select: none;
    list-style: none;
}

.flu-settings-image-config__summary::-webkit-details-marker {
    display: none;
}

.flu-settings-image-config[open] .flu-settings-image-config__summary {
    border-bottom-color: var(--brand-border);
}

.flu-settings-image-config__icon {
    font-size: 16px;
    line-height: 1;
}

/* Default body layout: stacked column */
.flu-settings-image-config__body {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

/* Two-column grid modifier — only for API config (Gemini + Pollinations) */
.flu-settings-image-config__body--api-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
}

/* FLU Configurator: explicit single column to avoid being caught by any grid */
.flu-settings-image-config__body--flu-config {
    display: flex !important;
    flex-direction: column !important;
    gap: 12px;
    grid-template-columns: none !important;
    grid-template-rows: none !important;
}

.flu-settings-image-config__body--flu-config>* {
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
}

.flu-settings-image-config__body--flu-config>.flu-settings-image-config__group,
.flu-settings-image-config__body--flu-config>details {
    width: 100%;
}

/* Field row variants inside the FLU configurator */
.flu-settings-image-config__field--stacked {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
}

.flu-settings-image-config__field--stacked>span {
    white-space: normal;
    min-width: 0;
}

.flu-settings-image-config__field--checkbox {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
}

.flu-settings-image-config__field--checkbox>span {
    white-space: normal;
    min-width: 0;
}

/* Slider row: label on top, slider+value below (flex column) */
.flu-settings-image-config__field--slider {
    display: flex !important;
    flex-direction: column !important;
    align-items: stretch !important;
    gap: 4px;
    width: 100%;
}

.flu-settings-image-config__field--slider>span:first-child {
    width: 100%;
    white-space: nowrap;
    overflow: visible;
    text-overflow: clip;
}

.flu-settings-image-config__field--slider>div {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    width: 100%;
}

.flu-settings-image-config__field--slider>input[type="range"] {
    flex: 1;
    min-width: 80px;
}

.flu-settings-image-config__field--slider>.flu-settings-image-config__value {
    min-width: 28px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: #888;
    font-size: 0.75em;
    flex-shrink: 0;
}

/* Two-column grid for Gemini + Pollinations groups */
.flu-settings-image-config__body {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
}

/* Each API group card */
.flu-settings-image-config__group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
}

.flu-settings-image-config__group-title {
    font-size: var(--fs-small);
    font-weight: 700;
    color: var(--brand-primary-light);
    letter-spacing: 0.3px;
    margin-bottom: 2px;
}

/* Each field row: label + input inline */
.flu-settings-image-config__field {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-small);
}

.flu-settings-image-config__field span {
    color: #bbb;
    font-weight: 500;
    white-space: nowrap;
    min-width: 40px;
    text-transform: none !important;
    font-size: var(--fs-small);
}

.flu-settings-image-config__input {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    border-radius: 4px;
    border: 1px solid rgba(100, 140, 255, 0.2);
    background: rgba(255, 255, 255, 0.04);
    color: #e0e0e0;
    font-size: var(--fs-small);
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s;
}

.flu-settings-image-config__input:focus {
    border-color: rgba(100, 140, 255, 0.5);
}

.flu-settings-image-config__input::placeholder {
    color: rgba(255, 255, 255, 0.2);
    font-size: var(--fs-tiny);
}
```

## 8. Font Consistency Overrides (App.css lines 1680-1744)

```css
/* ---- Configurator font consistency — remove inline font sizes ----
   NOTE: Selectors below intentionally match the higher specificity of
   `.panel-card span` from OS2's index.css to override its text-transform/uppercase. */

/* Section title: Personalidad, Voz, Avanzado */
.panel-card .flu-settings-image-config__section-title,
.flu-settings-image-config__section-title {
    font-weight: 600 !important;
    font-size: var(--fs-small) !important;
    color: #ccc !important;
    text-transform: none !important;
    letter-spacing: normal !important;
    margin-bottom: 8px;
}

/* Sub-title: Rasgos, Tono labels */
.panel-card .flu-settings-image-config__sub-title,
.flu-settings-image-config__sub-title {
    font-size: var(--fs-small) !important;
    color: #bbb !important;
    font-weight: 500 !important;
    text-transform: none !important;
    letter-spacing: normal !important;
}

/* Small label text inside dashed sections (Voz, Avanzado headers) */
.panel-card .flu-settings-image-config__section-label,
.flu-settings-image-config__section-label {
    font-size: var(--fs-small) !important;
    color: #888 !important;
    font-weight: 500 !important;
    text-transform: none !important;
    letter-spacing: normal !important;
    margin-bottom: 4px;
}

/* Trait buttons font */
.panel-card .flu-settings-image-config__trait-btn,
.flu-settings-image-config__trait-btn {
    font-size: var(--fs-tiny) !important;
    font-weight: 400 !important;
    text-transform: none !important;
    letter-spacing: normal !important;
}

/* Slider label text — override .panel-card span (uppercase) */
.panel-card .flu-settings-image-config__slider-label,
.flu-settings-image-config__slider-label {
    font-size: var(--fs-small) !important;
    color: #bbb !important;
    font-weight: 500 !important;
    text-transform: none !important;
    letter-spacing: normal !important;
    white-space: nowrap !important;
}

/* Override ANY span inside our configurator (kill OS2 uppercase) */
.flu-settings-image-config span,
.flu-settings-image-config__body span,
.flu-settings-image-config__group span,
.flu-settings-image-config__field span,
.flu-settings-image-config__voice-row span {
    text-transform: none !important;
    letter-spacing: normal !important;
}
```

## 9. Voice Selector Row CSS (App.css lines 1746-1818)

```css
/* Voice selector row layout — inside FluParticipantSettingsPanel */
.flu-participant-settings .flu-settings-image-config__voice-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    padding: 8px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.flu-participant-settings .flu-settings-image-config__voice-row select {
    flex: 1;
    min-width: 0;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid var(--brand-border);
    background: rgba(0, 0, 0, 0.25);
    color: var(--brand-text);
    font-size: var(--fs-tiny);
    font-family: inherit;
    outline: none;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%239898b8'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: 28px;
}

.flu-participant-settings .flu-settings-image-config__voice-row select:focus {
    border-color: var(--brand-primary-light);
    box-shadow: 0 0 0 2px rgba(108, 92, 231, 0.15);
}

.flu-participant-settings .flu-settings-image-config__voice-row select option {
    background: #1a1a3e;
    color: #e0e0f0;
}

.flu-participant-settings .flu-settings-image-config__voice-row .flu-settings-image-config__slider-label {
    font-size: var(--fs-tiny);
    font-weight: 600;
    color: var(--brand-text-soft);
    white-space: nowrap;
    text-transform: none !important;
    letter-spacing: normal !important;
}

.flu-participant-settings .flu-settings-image-config__test-btn {
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid var(--brand-primary);
    background: linear-gradient(135deg, var(--brand-primary), #5a4bd1);
    color: #fff;
    font-size: var(--fs-tiny);
    font-family: inherit;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.2s ease;
}

.flu-participant-settings .flu-settings-image-config__test-btn:hover {
    background: linear-gradient(135deg, #7c6ef0, #6c5ce7);
    box-shadow: 0 2px 12px rgba(108, 92, 231, 0.3);
}

.flu-participant-settings .flu-settings-image-config__test-btn:active {
    transform: scale(0.97);
}
```

## 10. FluParticipantSettingsPanel CSS (App.css lines 1820-1975)

```css
/* ---- FluParticipantSettingsPanel — seamless integration (no stacked frame) ---- */

/* Blend seamlessly with the settings panel — no separate card/frame look */
.flu-participant-settings.panel-card {
    background: transparent;
    border: none;
    border-radius: 0;
    padding: 0;
    margin-top: 0;
    display: block;
}

/* Hide the "Configurador de voz" header since voice config is now inside Configurador de FLU */
.flu-participant-settings__header {
    display: none !important;
}

/* Override OS2 .panel-card span uppercase inside settings */
.flu-participant-settings.panel-card span {
    text-transform: none !important;
    font-size: var(--fs-tiny);
    color: #ccc;
    letter-spacing: 0.01em;
}

/* Make participant settings a 2-column grid (compact, no "chorizo") */
.flu-participant-settings .flu-participant-settings__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 12px;
    align-items: start;
}

/* API key field spans full width across both columns */
.flu-participant-settings__field--api-key {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
}

.flu-participant-settings__field--api-key input[type='password'] {
    width: auto;
    min-width: 180px;
    max-width: 280px;
    flex: 0 1 auto;
}

/* Each field row: label + input inline, compact */
.flu-participant-settings .flu-participant-settings__field {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 6px;
    flex-wrap: nowrap;
    min-width: 0;
}

/* Number inputs compact */
.flu-participant-settings__field input[type='number'] {
    width: auto;
    min-width: 50px;
    max-width: 80px;
    flex: 0 0 auto;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--brand-border);
    border-radius: 6px;
    padding: 4px 8px;
    color: var(--brand-text);
    font-family: inherit;
    font-size: var(--fs-tiny);
    outline: none;
}

.flu-participant-settings__field input[type='number']:focus {
    border-color: var(--brand-primary-light);
    box-shadow: 0 0 0 2px rgba(108, 92, 231, 0.15);
}

/* Checkbox fields: label + checkbox inline */
.flu-participant-settings__field--checkbox {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 6px;
}

.flu-participant-settings__field--checkbox span:first-child {
    flex: 0 0 auto;
}

.flu-participant-settings__field--checkbox input[type="checkbox"] {
    accent-color: var(--brand-primary);
    width: 14px;
    height: 14px;
    cursor: pointer;
}

/* Hint text — own line below the field */
.flu-participant-settings .flu-participant-settings__hint {
    display: block;
    width: 100%;
    font-size: var(--fs-micro);
    color: rgba(200, 205, 230, 0.5);
    grid-column: 1 / -1;
    margin: 2px 0 0 0;
    line-height: 1.3;
}

/* Override OS2 button uppercase inside settings */
.flu-participant-settings .voice-bar__button {
    text-transform: none !important;
    font-size: var(--fs-tiny);
    letter-spacing: 0.02em;
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid var(--brand-border);
    background: rgba(255, 255, 255, 0.05);
    color: var(--brand-text);
    cursor: pointer;
    transition: all 0.2s ease;
    font-family: inherit;
    font-weight: 600;
}

.flu-participant-settings .voice-bar__button:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: var(--brand-border-strong);
}

.flu-participant-settings .voice-bar__button--ghost {
    background: transparent;
    border-color: transparent;
    color: var(--brand-text-soft);
}

.flu-participant-settings .voice-bar__button--ghost:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: var(--brand-border);
}

/* Actions row — compact */
.flu-participant-settings__actions {
    margin-top: 8px;
    gap: 6px;
    display: flex;
    flex-direction: row;
    align-items: center;
}

.flu-participant-settings__saved {
    font-size: var(--fs-tiny);
    color: var(--brand-accent);
    font-weight: 500;
}
```

## 11. FluParticipantSettingsPanel Component (full source)

**File:** `src/voice/components/FluParticipantSettingsPanel.jsx`

```jsx
import { useCallback, useEffect, useState } from 'react'
import { useIntegrationStore } from '../../store/integrationStore.ts'
import { resolveAppLanguage } from '../lib/audioMath.js'
import { resolveFluParticipantLabel } from '../lib/fluParticipant.js'
import { FLU_CONFIG } from '../lib/fluConfig.js'
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
  const [savedFlash, setSavedFlash] = useState(false)
  const [draft, setDraft] = useState(() => buildDraftFromConfig(getFluParticipantConfig()))

  const updateField = useCallback((key, value) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setSavedFlash(false)
  }, [])

  const handleSave = useCallback(() => {
    const next = setFluParticipantOverrides(serializeDraftForSave(draft))
    setDraft(buildDraftFromConfig(next))
    setSavedFlash(true)
    onConfigChange?.(next)
  }, [draft, onConfigChange])

  const handleReset = useCallback(() => {
    const next = resetFluParticipantOverrides()
    setDraft(buildDraftFromConfig(next))
    setSavedFlash(true)
    onConfigChange?.(next)
  }, [onConfigChange])

  const integrationStore = useIntegrationStore?.() ?? null
  const safeVoices = Array.isArray(voices) ? voices : []

  return (
    <section className="flu-participant-settings panel-card">
      <header className="flu-participant-settings__header">
        <h2>{resolveFluParticipantLabel('panelTitle', lang)}</h2>
      </header>

      {/* Voice selector — global para FLU, no asociado a perfil */}
      <div className="flu-settings-image-config__voice-row" style={{ marginBottom: 12, padding: '8px 0' }}>
        <span className="flu-settings-image-config__slider-label">Voz</span>
        <select
          value={integrationStore?.voiceConfig?.voiceURI || ''}
          onChange={(e) => {
            const selected = safeVoices.find(v => v.voiceURI === e.target.value);
            if (selected && integrationStore?.setVoiceConfig) {
              integrationStore.setVoiceConfig({ voiceURI: selected.voiceURI, voiceName: selected.name });
            }
          }}
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
          className="flu-settings-image-config__test-btn"
          onClick={() => {
            const selected = safeVoices.find(v => v.voiceURI === integrationStore?.voiceConfig?.voiceURI);
            const utterance = new SpeechSynthesisUtterance(
              lang === 'en'
                ? 'Hello, I am FLU. This is my voice.'
                : 'Hola, soy FLU. Esta es mi voz.'
            );
            if (selected) utterance.voice = selected;
            utterance.rate = integrationStore?.voiceConfig?.rate ?? 1.0;
            utterance.lang = lang === 'en' ? 'en-US' : 'es-MX';
            window.speechSynthesis.speak(utterance);
          }}
        >
          ▶ Probar
        </button>
      </div>

      <div className="flu-participant-settings__grid">
        {FLU_PARTICIPANT_EDITABLE_FIELDS.map((field) => {
          const label = resolveFluParticipantFieldLabel(field.key, lang)
          const hint = resolveFluParticipantFieldHint(field.key, lang)
          const id = `flu-participant-${field.key}`

          if (field.type === 'boolean') {
            return (
              <label key={field.key} className="flu-participant-settings__field flu-participant-settings__field--checkbox" htmlFor={id}>
                <span>{label}</span>
                <input
                  id={id}
                  type="checkbox"
                  checked={Boolean(draft[field.key])}
                  onChange={(event) => updateField(field.key, event.target.checked)}
                />
                {hint ? <span className="flu-participant-settings__hint">{hint}</span> : null}
              </label>
            )
          }

          return (
            <label key={field.key} className="flu-participant-settings__field" htmlFor={id}>
              <span>{label}</span>
              <input
                id={id}
                type="number"
                min={field.min}
                max={field.max}
                step={field.step}
                value={draft[field.key]}
                onChange={(event) => updateField(field.key, event.target.value)}
              />
              {hint ? <span className="flu-participant-settings__hint">{hint}</span> : null}
            </label>
          )
        })}
      </div>

      <div className="flu-participant-settings__actions">
        <button type="button" className="voice-bar__button" onClick={handleSave}>
          {resolveFluParticipantLabel('saveButton', lang)}
        </button>
        <button type="button" className="voice-bar__button voice-bar__button--ghost" onClick={handleReset}>
          {resolveFluParticipantLabel('resetButton', lang)}
        </button>
        {savedFlash ? (
          <span className="flu-participant-settings__saved">{resolveFluParticipantLabel('savedHint', lang)}</span>
        ) : null}
      </div>
    </section>
  )
}
</textarea>

---

> **End of backup.** All settings-related code from `src/App.tsx`, `src/App.css`, and `src/voice/components/FluParticipantSettingsPanel.jsx` has been captured.
