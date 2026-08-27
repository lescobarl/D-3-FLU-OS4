// ============================================================
// FluSettingsPanel — Panel de configuración de FLU OS3/OS4
// ============================================================
// Extraído de App.tsx para reducir la carga del componente principal.
// Contiene:
//   - Configurador de FLU (personalidad, tono, instrucciones, avanzado)
//   - Configuración de texto (Gemini)
//   - Configuración de imagen (Pollinations)
//   - Branding Inteligente por Temporalidad
//   - FluParticipantSettingsPanel
// ============================================================

import React from 'react';
import type { FluProfile } from '../types/bridge';
import { FLU_PROFILES, AVAILABLE_TRAITS, AVAILABLE_TONES } from '../core/config/appConfig';
import { useIntegrationStore } from '../store/integrationStore';
import FluParticipantSettingsPanel from '../voice/components/FluParticipantSettingsPanel';
import type { BrandingMode } from '../core/branding/useSeasonalBranding';
import { PALETTES } from '../core/branding/seasonalPalettes';
import { useBunnyStore } from '../avatar/store/bunnyStore';
import type { BunnyComponent } from '../avatar/types/bunny';
import type { VoiceConfig } from '../types/bridge';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { useConfigPersistence } from '../hooks/useConfigPersistence';
import { useAuditLog } from '../hooks/useAuditLog';

// Declare global window types
declare global {
    interface Window {
        FLU_CONFIG?: typeof FLU_CONFIG;
    }
}

interface FluSettingsPanelProps {
    // External Services Config props
    voiceConfig?: VoiceConfig;
    setVoiceConfig?: (config: Partial<VoiceConfig>) => void;
    ocrApiKey?: string;
    handleOcrApiKeyCommit?: (key: string) => void;
    ocrModel?: string;
    handleOcrModelCommit?: (model: string) => void;
    ocrApiUrl?: string;
    handleOcrApiUrlCommit?: (url: string) => void;
    aiProvider?: string;
    setAiProvider?: (provider: string) => void;
    language: string;
    apiKey: string;
    textModel: string;
    textApiUrl: string;
    imageModel: string;
    imageApiKey: string;
    imageApiUrl: string;
    voices: any[];
    handleTextModelCommit: (val: string) => void;
    handleTextApiKeyCommit: (val: string) => void;
    handleTextApiUrlCommit: (val: string) => void;
    handleImageModelCommit: (val: string) => void;
    handleImageApiKeyCommit: (val: string) => void;
    handleImageApiUrlCommit: (val: string) => void;
    onClearCache?: () => void;
    wakeWords: string;
    setWakeWords: (value: string) => void;
    debugLogsEnabled: boolean;
    setDebugLogsEnabled: (enabled: boolean) => void;
    handleParticipantConfigChange: (overrides: Record<string, any>) => void;
    // Branding props
    brandingMode?: BrandingMode;
    brandingSeason?: string;
    brandingBirthday?: string | null;
    brandingCelebrateAchievements?: boolean;
    onBrandingModeChange?: (mode: BrandingMode) => void;
    onBrandingSeasonChange?: (season: string) => void;
    onBrandingBirthdayChange?: (birthday: string | null) => void;
    onBrandingCelebrateAchievementsChange?: (enabled: boolean) => void;
}

export function FluSettingsPanel({
    language,
    apiKey,
    textModel,
    textApiUrl,
    imageModel,
    imageApiKey,
    imageApiUrl,
    voices,
    handleTextModelCommit,
    handleTextApiKeyCommit,
    handleTextApiUrlCommit,
    handleImageModelCommit,
    handleImageApiKeyCommit,
    handleImageApiUrlCommit,
    onClearCache,
    wakeWords,
    setWakeWords,
    debugLogsEnabled,
    setDebugLogsEnabled,
    handleParticipantConfigChange,
    // Branding props
    brandingMode,
    brandingSeason,
    brandingBirthday,
    brandingCelebrateAchievements,
    onBrandingModeChange,
    onBrandingSeasonChange,
    onBrandingBirthdayChange,
    onBrandingCelebrateAchievementsChange,
    // External Services props
    voiceConfig,
    setVoiceConfig,
    ocrApiKey,
    handleOcrApiKeyCommit,
    ocrModel,
    handleOcrModelCommit,
    ocrApiUrl,
    handleOcrApiUrlCommit,
    aiProvider,
    setAiProvider,
}: FluSettingsPanelProps) {
    const integrationStore = useIntegrationStore();
    const { componentColors, setComponentColor, resetComponentColors } = useBunnyStore();

    return (
        <section className="flu-settings-panel">
            {/* ---- 🎭 Configurador de FLU ---- */}
            <details className="flu-settings-image-config" open>
                <summary className="flu-settings-image-config__summary flu-settings-image-config__summary--with-profile">
                    <span className="flu-settings-image-config__icon">🎭</span>
                    <span>Configurador de FLU</span>
                    <span className="flu-settings-summary-spacer" />
                    <span className="flu-settings-profile-inline">👤</span>
                    <select
                        value={integrationStore.profile}
                        onChange={(e) => integrationStore.applyProfile(e.target.value as FluProfile)}
                        className="flu-settings-image-config__input flu-settings-profile-select"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {FLU_PROFILES.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.id === 'profesor' ? 'Asistente del Maestro' : p.label}
                            </option>
                        ))}
                    </select>
                </summary>
                <div className="flu-settings-image-config__body flu-settings-image-config__body--flu-config">

                    <div className="flu-settings-section">
                        <div className="flu-settings-section__title">
                            🧠 Personalidad
                        </div>
                        <div className="flu-settings-section__body flu-settings-section__body--indent">
                            <div className="flu-settings-image-config__group" style={{ border: 'none', padding: 0 }}>
                                <div className="flu-settings-sub-title">Rasgos</div>
                                <div className="flu-settings-traits-row">
                                    {AVAILABLE_TRAITS.map((trait) => {
                                        const isSelected = integrationStore.config.personality.traits.includes(trait);
                                        return (
                                            <button
                                                key={trait}
                                                type="button"
                                                onClick={() => {
                                                    const current = integrationStore.config.personality.traits;
                                                    const updated = isSelected
                                                        ? current.filter((t) => t !== trait)
                                                        : [...current, trait];
                                                    integrationStore.setConfig({
                                                        personality: { ...integrationStore.config.personality, traits: updated },
                                                    });
                                                }}
                                                className={`flu-settings-trait-btn${isSelected ? ' is-selected' : ''}`}
                                            >
                                                {trait}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="flu-settings-image-config__field flu-settings-image-config__field--stacked" style={{ padding: 0 }}>
                                <span className="flu-settings-sub-title">Tono</span>
                                <select
                                    value={integrationStore.config.personality.tone}
                                    onChange={(e) => {
                                        integrationStore.setConfig({
                                            personality: { ...integrationStore.config.personality, tone: e.target.value as any },
                                        });
                                    }}
                                    className="flu-settings-image-config__input"
                                    style={{ width: '100%' }}
                                >
                                    {AVAILABLE_TONES.map((t) => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* ---- ✏️ Instrucciones personalizadas ---- */}
                    <div className="flu-settings-section">
                        <div className="flu-settings-section-label">✏️ Instrucciones personalizadas</div>
                        <textarea
                            value={integrationStore.config.personality.customInstructions || ''}
                            onChange={(e) => {
                                integrationStore.setConfig({
                                    personality: { ...integrationStore.config.personality, customInstructions: e.target.value },
                                });
                            }}
                            placeholder={language === 'en'
                                ? 'e.g. Be more expressive, use animations, be kind...'
                                : 'Ej: compórtate más expresivo, usa estas animaciones, sé amable...'}
                            className="flu-settings-textarea"
                        />
                        <div className="flu-settings-hint">
                            {language === 'en'
                                ? 'These instructions are injected into Gemini\'s system prompt at the start of each session.'
                                : 'Estas instrucciones se inyectan en el prompt del sistema de Gemini al inicio de cada sesión.'}
                        </div>
                    </div>

                    <div className="flu-settings-section">
                        <div className="flu-settings-section__title">⚙️ Avanzado</div>
                        <div className="flu-settings-section__body">
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--slider">
                                <span className="flu-settings-slider-label">Velocidad de animación</span>
                                <input
                                    type="range"
                                    min="0.5"
                                    max="2.0"
                                    step="0.1"
                                    value={integrationStore.advancedConfig.animationSpeed}
                                    onChange={(e) => integrationStore.setAdvancedConfig({ animationSpeed: parseFloat(e.target.value) })}
                                />
                                <span className="flu-settings-slider-value">
                                    {(integrationStore.advancedConfig?.animationSpeed ?? 1).toFixed(1)}
                                </span>
                            </label>
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--slider">
                                <span className="flu-settings-slider-label">Reactividad emocional</span>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.1"
                                    value={integrationStore.advancedConfig.emotionalReactivity}
                                    onChange={(e) => integrationStore.setAdvancedConfig({ emotionalReactivity: parseFloat(e.target.value) })}
                                />
                                <span className="flu-settings-slider-value">
                                    {(integrationStore.advancedConfig?.emotionalReactivity ?? 0.5).toFixed(1)}
                                </span>
                            </label>
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--slider">
                                <span className="flu-settings-slider-label">Creatividad (temperature)</span>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.1"
                                    value={integrationStore.advancedConfig.creativity}
                                    onChange={(e) => integrationStore.setAdvancedConfig({ creativity: parseFloat(e.target.value) })}
                                />
                                <span className="flu-settings-slider-value">
                                    {(integrationStore.advancedConfig?.creativity ?? 0.7).toFixed(1)}
                                </span>
                            </label>
                        </div>
                    </div>

                    {/* ---- 🧠 Detección de Emociones del Usuario ---- */}
                    <div className="flu-settings-section">
                        <div className="flu-settings-section__title">🧠 Detección de emociones del usuario</div>
                        <div className="flu-settings-section__body">
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--slider">
                                <span className="flu-settings-slider-label">Confianza mínima de detección</span>
                                <input
                                    type="range" min="0" max="1" step="0.05"
                                    value={integrationStore.advancedConfig.emotionMinConfidence}
                                    onChange={(e) => integrationStore.setAdvancedConfig({ emotionMinConfidence: parseFloat(e.target.value) })}
                                />
                                <span className="flu-settings-slider-value">{(integrationStore.advancedConfig?.emotionMinConfidence ?? 0.3).toFixed(2)}</span>
                            </label>
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--slider">
                                <span className="flu-settings-slider-label">Confianza base detección (elogio/crítica)</span>
                                <input
                                    type="range" min="0" max="1" step="0.05"
                                    value={integrationStore.advancedConfig.emotionBaseDetectionConfidence}
                                    onChange={(e) => integrationStore.setAdvancedConfig({ emotionBaseDetectionConfidence: parseFloat(e.target.value) })}
                                />
                                <span className="flu-settings-slider-value">{(integrationStore.advancedConfig?.emotionBaseDetectionConfidence ?? 0.5).toFixed(2)}</span>
                            </label>
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--slider">
                                <span className="flu-settings-slider-label">Umbral cambio de tema (solapamiento)</span>
                                <input
                                    type="range" min="0" max="0.5" step="0.01"
                                    value={integrationStore.advancedConfig.emotionTopicChangeOverlapRatio}
                                    onChange={(e) => integrationStore.setAdvancedConfig({ emotionTopicChangeOverlapRatio: parseFloat(e.target.value) })}
                                />
                                <span className="flu-settings-slider-value">{(integrationStore.advancedConfig?.emotionTopicChangeOverlapRatio ?? 0.3).toFixed(2)}</span>
                            </label>
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--slider">
                                <span className="flu-settings-slider-label">Palabras mínimas para cambio de tema</span>
                                <input
                                    type="range" min="1" max="10" step="1"
                                    value={integrationStore.advancedConfig.emotionTopicChangeMinWords}
                                    onChange={(e) => integrationStore.setAdvancedConfig({ emotionTopicChangeMinWords: parseInt(e.target.value) })}
                                />
                                <span className="flu-settings-slider-value">{integrationStore.advancedConfig.emotionTopicChangeMinWords}</span>
                            </label>
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--slider">
                                <span className="flu-settings-slider-label">Palabras máx. para interrupción corta</span>
                                <input
                                    type="range" min="1" max="10" step="1"
                                    value={integrationStore.advancedConfig.emotionShortUtteranceWordCount}
                                    onChange={(e) => integrationStore.setAdvancedConfig({ emotionShortUtteranceWordCount: parseInt(e.target.value) })}
                                />
                                <span className="flu-settings-slider-value">{integrationStore.advancedConfig.emotionShortUtteranceWordCount}</span>
                            </label>
                        </div>
                    </div>

                    {/* ---- 🧠 Teoría de la Mente ---- */}
                    <div className="flu-settings-section">
                        <div className="flu-settings-section__title">🧠 Teoría de la Mente (participantes)</div>
                        <div className="flu-settings-section__body">
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--slider">
                                <span className="flu-settings-slider-label">Máx. participantes</span>
                                <input
                                    type="range" min="2" max="50" step="1"
                                    value={integrationStore.advancedConfig.tomMaxParticipants}
                                    onChange={(e) => integrationStore.setAdvancedConfig({ tomMaxParticipants: parseInt(e.target.value) })}
                                />
                                <span className="flu-settings-slider-value">{integrationStore.advancedConfig.tomMaxParticipants}</span>
                            </label>
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--slider">
                                <span className="flu-settings-slider-label">Temas por participante</span>
                                <input
                                    type="range" min="5" max="100" step="1"
                                    value={integrationStore.advancedConfig.tomMaxTopicsPerParticipant}
                                    onChange={(e) => integrationStore.setAdvancedConfig({ tomMaxTopicsPerParticipant: parseInt(e.target.value) })}
                                />
                                <span className="flu-settings-slider-value">{integrationStore.advancedConfig.tomMaxTopicsPerParticipant}</span>
                            </label>
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--slider">
                                <span className="flu-settings-slider-label">Inactividad (minutos)</span>
                                <input
                                    type="range" min="1" max="120" step="1"
                                    value={integrationStore.advancedConfig.tomParticipantInactivityMs / 60000}
                                    onChange={(e) => integrationStore.setAdvancedConfig({ tomParticipantInactivityMs: parseInt(e.target.value) * 60000 })}
                                />
                                <span className="flu-settings-slider-value">{Math.round(integrationStore.advancedConfig.tomParticipantInactivityMs / 60000)} min</span>
                            </label>
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--slider">
                                <span className="flu-settings-slider-label">Resumen: items por categoría</span>
                                <input
                                    type="range" min="1" max="10" step="1"
                                    value={integrationStore.advancedConfig.tomSummaryDisplayLimit}
                                    onChange={(e) => integrationStore.setAdvancedConfig({ tomSummaryDisplayLimit: parseInt(e.target.value) })}
                                />
                                <span className="flu-settings-slider-value">{integrationStore.advancedConfig.tomSummaryDisplayLimit}</span>
                            </label>
                        </div>
                    </div>

                    {/* ---- 📋 Eventos del Sistema ---- */}
                    <div className="flu-settings-section">
                        <div className="flu-settings-section__title">📋 Eventos del sistema</div>
                        <div className="flu-settings-section__body">
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--slider">
                                <span className="flu-settings-slider-label">Ventana de memoria (minutos)</span>
                                <input
                                    type="range" min="1" max="30" step="1"
                                    value={integrationStore.advancedConfig.systemEventWindowMs / 60000}
                                    onChange={(e) => integrationStore.setAdvancedConfig({ systemEventWindowMs: parseInt(e.target.value) * 60000 })}
                                />
                                <span className="flu-settings-slider-value">{Math.round(integrationStore.advancedConfig.systemEventWindowMs / 60000)} min</span>
                            </label>
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--slider">
                                <span className="flu-settings-slider-label">Deduplicación (segundos)</span>
                                <input
                                    type="range" min="1" max="30" step="1"
                                    value={integrationStore.advancedConfig.systemEventDedupBucketMs / 1000}
                                    onChange={(e) => integrationStore.setAdvancedConfig({ systemEventDedupBucketMs: parseInt(e.target.value) * 1000 })}
                                />
                                <span className="flu-settings-slider-value">{Math.round(integrationStore.advancedConfig.systemEventDedupBucketMs / 1000)} s</span>
                            </label>
                        </div>
                    </div>

                    <div className="flu-settings-image-config__group" style={{ marginTop: 6 }}>
                        <div className="flu-settings-image-config__group-title">🎨 Imagen</div>
                        <label className="flu-settings-image-config__field flu-settings-image-config__field--checkbox">
                            <input
                                type="checkbox"
                                checked={integrationStore.imageConfig.capVisible}
                                onChange={(e) => integrationStore.setImageConfig({ capVisible: e.target.checked })}
                            />
                            <span>Gorra visible</span>
                        </label>
                        <label className="flu-settings-image-config__field flu-settings-image-config__field--checkbox">
                            <input
                                type="checkbox"
                                checked={integrationStore.imageConfig.hairVisible}
                                onChange={(e) => integrationStore.setImageConfig({ hairVisible: e.target.checked })}
                            />
                            <span>Pelo / Fleco visible</span>
                        </label>
                    </div>

                    <div className="flu-settings-section">
                        <div className="flu-settings-section__title">🔊 Voz</div>
                        <div className="flu-settings-section__body">
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--slider">
                                <span className="flu-settings-slider-label">Velocidad de la voz</span>
                                <input
                                    type="range"
                                    min="0.5"
                                    max="2.0"
                                    step="0.1"
                                    value={integrationStore.voiceConfig.rate}
                                    onChange={(e) => integrationStore.setVoiceConfig({ rate: parseFloat(e.target.value) })}
                                />
                                <span className="flu-settings-slider-value">
                                    {(integrationStore.voiceConfig?.rate ?? 1).toFixed(1)}
                                </span>
                            </label>
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--slider">
                                <span className="flu-settings-slider-label">Tono de la voz</span>
                                <input
                                    type="range"
                                    min="0.5"
                                    max="2.0"
                                    step="0.1"
                                    value={integrationStore.voiceConfig.pitch}
                                    onChange={(e) => integrationStore.setVoiceConfig({ pitch: parseFloat(e.target.value) })}
                                />
                                <span className="flu-settings-slider-value">
                                    {(integrationStore.voiceConfig?.pitch ?? 1).toFixed(1)}
                                </span>
                            </label>
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--slider">
                                <span className="flu-settings-slider-label">Volumen de la voz</span>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.1"
                                    value={integrationStore.voiceConfig.volume}
                                    onChange={(e) => integrationStore.setVoiceConfig({ volume: parseFloat(e.target.value) })}
                                />
                                <span className="flu-settings-slider-value">
                                    {(integrationStore.voiceConfig?.volume ?? 1).toFixed(1)}
                                </span>
                            </label>
                        </div>
                    </div>
                </div>
            </details>

            {/* ---- Branding Inteligente por Temporalidad ---- */}
            <details className="flu-settings-image-config">
                <summary className="flu-settings-image-config__summary">
                    🎨 Branding por Temporalidad
                </summary>
                <div className="flu-settings-image-config__group">
                    {/* Modo */}
                    <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 4 }}>
                            Modo
                        </span>
                        <select
                            value={brandingMode || 'auto'}
                            onChange={(e) => onBrandingModeChange?.(e.target.value as BrandingMode)}
                            className="flu-settings-image-config__input"
                        >
                            <option value="auto">Automático (calendario SEP)</option>
                            <option value="manual">Manual</option>
                            <option value="disabled">Desactivado</option>
                        </select>
                    </label>

                    {/* Selector de temporada (solo en modo manual) */}
                    {brandingMode === 'manual' && (
                        <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 4 }}>
                                Temporada
                            </span>
                            <select
                                value={brandingSeason || 'default'}
                                onChange={(e) => onBrandingSeasonChange?.(e.target.value)}
                                className="flu-settings-image-config__input"
                            >
                                {Object.entries(PALETTES).map(([key, palette]) => (
                                    <option key={key} value={key}>
                                        {palette.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    {/* Cumpleaños */}
                    <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 4 }}>
                            Mi cumpleaños (opcional)
                        </span>
                        <input
                            type="date"
                            value={brandingBirthday || ''}
                            onChange={(e) => onBrandingBirthdayChange?.(e.target.value || null)}
                            className="flu-settings-image-config__input"
                        />
                    </label>

                    {/* Celebrar logros */}
                    <label className="flu-settings-image-config__field flu-settings-image-config__field--checkbox">
                        <input
                            type="checkbox"
                            checked={brandingCelebrateAchievements || false}
                            onChange={(e) => onBrandingCelebrateAchievementsChange?.(e.target.checked)}
                        />
                        <span>Celebrar logros (Materia Gris)</span>
                    </label>

                    {/* Preview de paleta activa */}
                    {brandingMode !== 'disabled' && brandingSeason && PALETTES[brandingSeason] && (
                        <div style={{
                            marginTop: 8,
                            padding: '8px 10px',
                            background: 'var(--bg-secondary)',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 'var(--text-xs)',
                            color: 'var(--text-secondary)',
                        }}>
                            <div style={{ marginBottom: 4 }}>
                                <strong>Paleta activa:</strong> {PALETTES[brandingSeason].name}
                            </div>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {Object.entries(PALETTES[brandingSeason].colors).slice(0, 6).map(([key, color]) => (
                                    <span
                                        key={key}
                                        title={key}
                                        style={{
                                            display: 'inline-block',
                                            width: 20,
                                            height: 20,
                                            borderRadius: 4,
                                            background: color,
                                            border: '1px solid var(--border-color)',
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </details>

            {/* ---- 🎤 Editor de Comandos de Voz ---- */}
            <details className="flu-settings-image-config">
                <summary className="flu-settings-image-config__summary">
                    <span className="flu-settings-image-config__icon">🎤</span>
                    <span>Editor de Comandos Personalizados</span>
                </summary>
                <div className="flu-settings-image-config__body">
                    <div className="flu-settings-image-config__group">
                        {/* Palabras de activación */}
                        <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                            <span>Palabras de activación (Wake Words)</span>
                            <textarea
                                className="flu-settings-image-config__textarea"
                                placeholder="Agrega una palabra de activación por línea"
                                value={wakeWords}
                                onChange={(e) => setWakeWords(e.target.value)}
                                rows={8}
                            />
                            <small style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
                                Una por línea, separadas por saltos de línea
                            </small>
                        </label>

                    </div>
                </div>
            </details>

            {/* ---- 📊 Gestión de Logs y Auditoría ---- */}
            <details className="flu-settings-image-config">
                <summary className="flu-settings-image-config__summary">
                    <span className="flu-settings-image-config__icon">📊</span>
                    <span>Gestión de Logs y Auditoría</span>
                </summary>
                <div className="flu-settings-image-config__body">
                    <div className="flu-settings-image-config__group">
                        {/* Estado de logs */}
                        <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                            <div style={{ display: 'flex', gap: 12 }}>
                                <button
                                    type="button"
                                    className="flu-settings-btn"
                                    onClick={() => {
                                        // Limpiar logs
                                        console.clear();
                                        alert('Logs de depuración limpiados correctamente');
                                    }}
                                >
                                    🧹 Limpiar logs de depuración
                                </button>
                                <button
                                    type="button"
                                    className="flu-settings-btn"
                                    onClick={() => {
                                        // Exportar logs
                                        const logs = JSON.stringify(window.FLU_CONFIG?.debug || {}, null, 2);
                                        const blob = new Blob([logs], { type: 'application/json' });
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement('a');
                                        a.href = url;
                                        a.download = 'flu-debug-logs.json';
                                        a.click();
                                        URL.revokeObjectURL(url);
                                        alert('Logs de auditoría exportados correctamente');
                                    }}
                                >
                                    💾 Exportar logs de auditoría
                                </button>
                            </div>
                        </label>

                        {/* Configuración de logs */}
                        <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked" style={{ marginTop: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span>Habilitar logs de depuración</span>
                                <input
                                    type="checkbox"
                                    checked={debugLogsEnabled}
                                    onChange={(e) => setDebugLogsEnabled(e.target.checked)}
                                />
                            </div>
                        </label>
                    </div>
                </div>
            </details>

            {/* ---- 🧠 Configuración Avanzada de Memoria ---- */}
            <details className="flu-settings-image-config">
                <summary className="flu-settings-image-config__summary">
                    <span className="flu-settings-image-config__icon">🧠</span>
                    <span>Configuración Avanzada de Memoria</span>
                </summary>
                <div className="flu-settings-image-config__body">
                    <div className="flu-settings-image-config__group">
                        {/* Curva de olvido */}
                        <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                            <span>Curva de olvido (segundos)</span>
                            <input
                                type="number"
                                className="flu-settings-image-config__input"
                                defaultValue={3600}
                            />
                            <small style={{ color: 'var(--text-secondary)', marginTop: 6 }}>
                                Tiempo en segundos para que la memoria se olvide de la información
                            </small>
                        </label>

                        {/* Tamaño máximo de memoria */}
                        <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked" style={{ marginTop: 16 }}>
                            <span>Tamaño máximo de memoria</span>
                            <input
                                type="number"
                                className="flu-settings-image-config__input"
                                defaultValue={100}
                            />
                            <small style={{ color: 'var(--text-secondary)', marginTop: 6 }}>
                                Número máximo de entradas en la memoria de conversación
                            </small>
                        </label>
                    </div>
                </div>
            </details>

            {/* ---- 🎨 Personalización del Avatar ---- */}
            <details className="flu-settings-image-config" open>
                <summary className="flu-settings-image-config__summary">
                    <span className="flu-settings-image-config__icon">🎨</span>
                    <span>Personalización del Avatar</span>
                </summary>
                <div className="flu-settings-image-config__body">
                    <div className="flu-settings-image-config__group">
                        {/* Selectores de color por componente */}
                        <div className="flu-settings-color-pickers" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {/* Pantalones */}
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                <span>Pantalones</span>
                                <input
                                    type="color"
                                    className="flu-settings-color-picker"
                                    defaultValue={componentColors?.Bunny_pants || '#8B4513'}
                                    onChange={(e) => {
                                        setComponentColor('Bunny_pants', e.target.value);
                                    }}
                                />
                            </label>
                            {/* Cuerpo */}
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                <span>Cuerpo</span>
                                <input
                                    type="color"
                                    className="flu-settings-color-picker"
                                    defaultValue={componentColors?.Bunny_body || '#F4A460'}
                                    onChange={(e) => {
                                        setComponentColor('Bunny_body', e.target.value);
                                    }}
                                />
                            </label>
                            {/* Cara */}
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                <span>Cara</span>
                                <input
                                    type="color"
                                    className="flu-settings-color-picker"
                                    defaultValue={componentColors?.Bunny_face || '#FFDAB9'}
                                    onChange={(e) => {
                                        setComponentColor('Bunny_face', e.target.value);
                                    }}
                                />
                            </label>
                            {/* Gorra */}
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                <span>Gorra</span>
                                <input
                                    type="color"
                                    className="flu-settings-color-picker"
                                    defaultValue={componentColors?.Bunny_cap || '#000080'}
                                    onChange={(e) => {
                                        setComponentColor('Bunny_cap', e.target.value);
                                    }}
                                />
                            </label>
                            {/* Botón de restablecimiento */}
                            <button
                                type="button"
                                className="flu-settings-btn flu-settings-btn--danger"
                                onClick={() => {
                                    resetComponentColors();
                                }}
                                style={{ marginTop: 16 }}
                            >
                                🎨 Restablecer colores originales
                            </button>
                        </div>
                    </div>
                </div>
            </details>

            {/* ---- 🔌 Servicios Externos ---- */}
            <details className="flu-settings-image-config">
                <summary className="flu-settings-image-config__summary">
                    <span className="flu-settings-image-config__icon">🔌</span>
                    <span>Configuración de Servicios Externos</span>
                </summary>
                <div className="flu-settings-image-config__body">
                    <div className="flu-settings-image-config__group">
                        {/* Proveedor de IA */}
                        <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                            <span>Proveedor de IA</span>
                            <select
                                value={aiProvider === 'deepseek' ? 'openrouter' : (aiProvider || 'openrouter')}
                                onChange={(e) => setAiProvider?.(e.target.value)}
                                className="flu-settings-image-config__input"
                            >
                                <option value="openrouter">Gemini 2.5 Flash Lite (OpenRouter) — por defecto</option>
                                <option value="local">Local (Ollama / LM Studio)</option>
                            </select>
                        </label>

                        {/* ---- 📝 Texto (Gemini) ---- */}
                        <div className="flu-settings-section" style={{ marginTop: 12 }}>
                            <h4 className="flu-settings-section__title">📝 Texto (Gemini 2.5 Flash Lite vía OpenRouter)</h4>
                            <div className="flu-settings-section__body">
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                    <span className="flu-settings-image-config__section-label">
                                        {language === 'en' ? 'Model' : 'Modelo'}
                                    </span>
                                    <input
                                        type="text"
                                        className="flu-settings-image-config__input"
                                        style={{ fontFamily: 'monospace' }}
                                        placeholder={language === 'en' ? 'google/gemini-2.5-flash-lite' : 'google/gemini-2.5-flash-lite'}
                                        defaultValue={textModel}
                                        onChange={(e) => handleTextModelCommit(e.target.value)}
                                    />
                                </label>
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked" style={{ marginTop: 8 }}>
                                    <span className="flu-settings-image-config__section-label">
                                        {language === 'en' ? 'API Key (optional)' : 'API Key (opcional)'}
                                    </span>
                                    <div className="flu-settings-row">
                                        <input
                                            type="password"
                                            className="flu-settings-image-config__input flu-settings-input-mono"
                                            style={{ flex: 1 }}
                                            placeholder={language === 'en' ? 'Optional: OpenRouter API key' : 'Opcional: OpenRouter API key'}
                                            defaultValue={apiKey}
                                            onChange={(e) => handleTextApiKeyCommit(e.target.value)}
                                        />
                                        <button
                                            type="button"
                                            className="flu-settings-reveal-btn"
                                            onClick={(e) => {
                                                const row = (e.currentTarget as HTMLButtonElement).closest('.flu-settings-row');
                                                const input = row?.querySelector('input[type="password"]') as HTMLInputElement | null;
                                                if (input) {
                                                    input.type = input.type === 'password' ? 'text' : 'password';
                                                }
                                            }}
                                        >
                                            {language === 'en' ? 'Show/Hide' : 'Mostrar/Ocultar'}
                                        </button>
                                    </div>
                                    {apiKey && (
                                        <span className="flu-settings-api-badge">
                                            ✅ {language === 'en' ? 'API key configured' : 'API key configurada'}
                                        </span>
                                    )}
                                </label>
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked" style={{ marginTop: 8 }}>
                                    <span className="flu-settings-image-config__section-label">
                                        {language === 'en' ? 'API URL' : 'URL de API'}
                                    </span>
                                    <input
                                        type="text"
                                        className="flu-settings-image-config__input flu-settings-input-mono--small"
                                        placeholder="https://openrouter.ai/api/v1"
                                        defaultValue={textApiUrl}
                                        onChange={(e) => handleTextApiUrlCommit(e.target.value)}
                                    />
                                </label>
                            </div>
                        </div>

                        {/* ---- 🖼️ Imagen (Pollinations) ---- */}
                        <div className="flu-settings-section" style={{ marginTop: 12 }}>
                            <h4 className="flu-settings-section__title">🖼️ Imagen (Pollinations)</h4>
                            <div className="flu-settings-section__body">
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                    <span className="flu-settings-image-config__section-label">
                                        {language === 'en' ? 'Model' : 'Modelo'}
                                    </span>
                                    <input
                                        type="text"
                                        className="flu-settings-image-config__input"
                                        style={{ fontFamily: 'monospace' }}
                                        placeholder={language === 'en' ? 'Pollinations (default)' : 'Pollinations (default)'}
                                        defaultValue={imageModel}
                                        onChange={(e) => handleImageModelCommit(e.target.value)}
                                    />
                                </label>
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked" style={{ marginTop: 8 }}>
                                    <span className="flu-settings-image-config__section-label">
                                        {language === 'en' ? 'API Key' : 'API Key'}
                                    </span>
                                    <div className="flu-settings-row">
                                        <input
                                            type="password"
                                            className="flu-settings-image-config__input flu-settings-input-mono"
                                            style={{ flex: 1 }}
                                            placeholder={language === 'en' ? 'Optional API key for image service' : 'API key opcional para servicio de imagen'}
                                            defaultValue={imageApiKey}
                                            onChange={(e) => handleImageApiKeyCommit(e.target.value)}
                                        />
                                        <button
                                            type="button"
                                            className="flu-settings-reveal-btn"
                                            onClick={(e) => {
                                                const row = (e.currentTarget as HTMLButtonElement).closest('.flu-settings-row');
                                                const input = row?.querySelector('input[type="password"]') as HTMLInputElement | null;
                                                if (input) {
                                                    input.type = input.type === 'password' ? 'text' : 'password';
                                                }
                                            }}
                                        >
                                            {language === 'en' ? 'Show/Hide' : 'Mostrar/Ocultar'}
                                        </button>
                                    </div>
                                </label>
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked" style={{ marginTop: 8 }}>
                                    <span className="flu-settings-image-config__section-label">
                                        {language === 'en' ? 'API URL' : 'URL de API'}
                                    </span>
                                    <input
                                        type="text"
                                        className="flu-settings-image-config__input flu-settings-input-mono--small"
                                        placeholder="https://image.pollinations.ai/prompt"
                                        defaultValue={imageApiUrl}
                                        onChange={(e) => handleImageApiUrlCommit(e.target.value)}
                                    />
                                </label>
                            </div>
                        </div>

                        {/* ---- 🔤 OCR ---- */}
                        <div className="flu-settings-section" style={{ marginTop: 12 }}>
                            <h4 className="flu-settings-section__title">🔤 OCR</h4>
                            <div className="flu-settings-section__body">
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                    <span>Clave API de OCR</span>
                                    <input
                                        type="password"
                                        className="flu-settings-image-config__input"
                                        defaultValue={ocrApiKey || ''}
                                        onChange={(e) => handleOcrApiKeyCommit?.(e.target.value)}
                                    />
                                </label>
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked" style={{ marginTop: 8 }}>
                                    <span>Modelo de OCR</span>
                                    <input
                                        type="text"
                                        className="flu-settings-image-config__input"
                                        defaultValue={ocrModel || ''}
                                        onChange={(e) => handleOcrModelCommit?.(e.target.value)}
                                    />
                                </label>
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked" style={{ marginTop: 8 }}>
                                    <span>URL de API de OCR</span>
                                    <input
                                        type="text"
                                        className="flu-settings-image-config__input"
                                        defaultValue={ocrApiUrl || ''}
                                        onChange={(e) => handleOcrApiUrlCommit?.(e.target.value)}
                                    />
                                </label>
                            </div>
                        </div>

                        {/* Limpiar caché y recargar */}
                        {onClearCache && (
                            <div className="flu-settings-row" style={{ marginTop: 12, gap: 8 }}>
                                <button
                                    type="button"
                                    className="flu-settings-clear-cache-btn"
                                    onClick={() => {
                                        const confirmed = window.confirm(
                                            language === 'en'
                                                ? 'Clear app cache and reload? Your API key and essential settings will be kept.'
                                                : '¿Limpiar caché de la app y recargar? Se conservarán tu API key y ajustes esenciales.'
                                        );
                                        if (confirmed) onClearCache();
                                    }}
                                >
                                    🧹 {language === 'en' ? 'Clear cache & reload' : 'Limpiar caché y recargar'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </details>

            <FluParticipantSettingsPanel
                language={language}
                onConfigChange={handleParticipantConfigChange}
                voices={voices}
            />
        </section>
    );
}
