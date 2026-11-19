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

import { SettingsPanelShell } from './SettingsPanelShell';
import React from 'react';
import { AVAILABLE_TRAITS, AVAILABLE_TONES, FALAI_CONFIG } from '../core/config/appConfig';
import { OPENROUTER_DEFAULTS, POLLINATIONS_DEFAULTS, AI_PROVIDER_IDS, DEFAULT_AI_PROVIDER } from '../core/config/sharedConfig';
import { useIntegrationStore } from '../store/integrationStore';
import FluParticipantSettingsPanel from '../voice/components/FluParticipantSettingsPanel';
import type { BrandingMode } from '../core/branding/useSeasonalBranding';
import { getAllPalettes, getPalette } from '../core/branding/seasonalPalettes';
import type { VoiceConfig } from '../types/bridge';
import { useAuditLog } from '../hooks/useAuditLog';
import { loadSearchConfigOverrides, saveSearchConfigOverrides, getLastStorageError, type SearchConfigOverrides } from '../core/search/searchConfigOverrides';
import { useSettingsSaveRegistration } from './SettingsSaveContext';

import { pickText } from '../lib/uiStrings';
import { downloadBlob } from '../lib/downloadFile';
export interface FluSettingsPanelProps {
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
    // Gemini nativo (paso 5): clave dedicada para el fallback de imagen
    geminiApiKey: string;
    imageModel: string;
    imageApiKey: string;
    imageApiUrl: string;
    // Video (fal.ai) — key para video real text-to-video
    falApiKey?: string;
    handleFalApiKeyCommit?: (val: string) => void;
    falVideoModel?: string;
    handleFalVideoModelCommit?: (val: string) => void;
    voices: SpeechSynthesisVoice[];
    handleTextModelCommit: (val: string) => void;
    handleTextApiKeyCommit: (val: string) => void;
    handleTextApiUrlCommit: (val: string) => void;
    handleGeminiApiKeyCommit: (val: string) => void;
    handleImageModelCommit: (val: string) => void;
    handleImageApiKeyCommit: (val: string) => void;
    handleImageApiUrlCommit: (val: string) => void;
    onClearCache?: () => void;
    wakeWords: string;
    setWakeWords: (value: string) => void;
    verboseLogsEnabled: boolean;
    setVerboseLogsEnabled: (enabled: boolean) => void;
    relayLogsEnabled: boolean;
    setRelayLogsEnabled: (enabled: boolean) => void;
    recordingEnabled: boolean;
    setRecordingEnabled: (enabled: boolean) => void;
    handleParticipantConfigChange: (overrides: Record<string, unknown>) => void;
    /** Overrides del buscador (comparte fuente con el Centro de Control). */
    searchOverrides?: SearchConfigOverrides;
    /** Persiste overrides del buscador (mismo handler que el Centro de Control).
     *  Acepta un updater `(prev) => next` para componer con otros commits globales. */
    onSearchOverridesChange?: (
        next: SearchConfigOverrides | ((prev: SearchConfigOverrides) => SearchConfigOverrides),
    ) => void;
    // Branding props
    brandingMode?: BrandingMode;
    brandingSeason?: string;
    brandingBirthday?: string | null;
    onBrandingModeChange?: (mode: BrandingMode) => void;
    onBrandingSeasonChange?: (season: string) => void;
    onBrandingBirthdayChange?: (birthday: string | null) => void;
}

export function FluSettingsPanel({
    language,
    apiKey,
    textModel,
    textApiUrl,
    geminiApiKey,
    imageModel,
    imageApiKey,
    imageApiUrl,
    falApiKey,
    handleFalApiKeyCommit,
    falVideoModel,
    handleFalVideoModelCommit,
    voices,
    handleTextModelCommit,
    handleTextApiKeyCommit,
    handleTextApiUrlCommit,
    handleGeminiApiKeyCommit,
    handleImageModelCommit,
    handleImageApiKeyCommit,
    handleImageApiUrlCommit,
    onClearCache,
    wakeWords,
    setWakeWords,
    verboseLogsEnabled,
    setVerboseLogsEnabled,
    relayLogsEnabled,
    setRelayLogsEnabled,
    recordingEnabled,
    setRecordingEnabled,
    handleParticipantConfigChange,
    // Branding props
    brandingMode,
    brandingSeason,
    brandingBirthday,
    onBrandingModeChange,
    onBrandingSeasonChange,
    onBrandingBirthdayChange,
    // External Services props
    ocrApiKey,
    handleOcrApiKeyCommit,
    ocrModel,
    handleOcrModelCommit,
    ocrApiUrl,
    handleOcrApiUrlCommit,
    aiProvider,
    setAiProvider,
    searchOverrides,
    onSearchOverridesChange,
}: FluSettingsPanelProps) {
    const integrationStore = useIntegrationStore();
    const audit = useAuditLog();

    // ── Búsqueda web: la clave/modelo se escriben DIRECTAMENTE en la fuente de
    // verdad (localStorage) en cada cambio. No depende del wiring de App, de
    // blur ni de un botón "Guardar".
    const readWebDraft = React.useCallback(() => {
        const stored = loadSearchConfigOverrides();
        const web = stored?.providers?.web || searchOverrides?.providers?.web;
        return {
            tavilyKey: String(web?.tavily?.key || ''),
            openrouterKey: String(web?.openrouter?.key || ''),
            openrouterModel: String(web?.openrouter?.model || ''),
        };
    }, [searchOverrides]);

    const [webDraft, setWebDraft] = React.useState(readWebDraft);
    const webDraftRef = React.useRef(webDraft);
    webDraftRef.current = webDraft;
    // Revelado controlado (el re-render no debe re-ocultar).
    const [revealWeb, setRevealWeb] = React.useState({ tavily: false, openrouter: false });
    const [revealFalKey, setRevealFalKey] = React.useState(false);
    // Resultado de la verificación de guardado (lectura real desde localStorage).
    const [webSave, setWebSave] = React.useState<{ chars: number; failed: boolean; error: string }>({
        chars: readWebDraft().openrouterKey.length,
        failed: false,
        error: '',
    });

    /**
     * Escribe la clave/modelo DIRECTAMENTE en localStorage (fuente de verdad),
     * sin depender de App, blur ni botón, y luego sincroniza el estado de App
     * para que la búsqueda use esta config.
     */
    const persistWeb = React.useCallback(
        (draft: { tavilyKey: string; openrouterKey: string; openrouterModel: string }): void => {
            const stored = loadSearchConfigOverrides();
            const providers = { ...(stored.providers || {}) };
            const web = { ...(providers.web || {}) };
            const tavily = { ...(web.tavily || {}) };
            const openrouter = { ...(web.openrouter || {}) };
            const tavilyKey = draft.tavilyKey.trim();
            const openrouterKey = draft.openrouterKey.trim();
            const openrouterModel = draft.openrouterModel.trim();
            if (tavilyKey) tavily.key = tavilyKey; else delete tavily.key;
            if (openrouterKey) openrouter.key = openrouterKey; else delete openrouter.key;
            if (openrouterModel) openrouter.model = openrouterModel; else delete openrouter.model;
            web.tavily = tavily;
            web.openrouter = openrouter;
            providers.web = web;
            const merged = { ...stored, providers };
            saveSearchConfigOverrides(merged);
            // Verificación: releer lo realmente persistido (no confiar en el borrador).
            const persistedKey = String(loadSearchConfigOverrides()?.providers?.web?.openrouter?.key || '');
            const failed = openrouterKey.length > 0 && persistedKey !== openrouterKey;
            setWebSave({
                chars: persistedKey.length,
                failed,
                error: failed ? getLastStorageError() : '',
            });
            onSearchOverridesChange?.(merged);
        },
        [onSearchOverridesChange],
    );

    const setWebField = (field: keyof typeof webDraft, value: string): void => {
        const next = { ...webDraftRef.current, [field]: value };
        webDraftRef.current = next;
        setWebDraft(next);
        // Guardado inmediato al escribir.
        persistWeb(next);
    };

    // Commit global + Restablecer (el Restablecer del buscador limpia la clave).
    useSettingsSaveRegistration('search-web', {
        commit: () => persistWeb(webDraftRef.current),
        reset: () => {
            const empty = { tavilyKey: '', openrouterKey: '', openrouterModel: '' };
            webDraftRef.current = empty;
            setWebDraft(empty);
        },
    });

    return (
        <>
            {/* ---- Servicios Externos (APIs/llaves) — sección principal ---- */}
            <SettingsPanelShell title="Servicios externos" bare>
                <div className="flu-settings-image-config__body">
                    <div className="flu-settings-image-config__group">
                        {/* Proveedor de IA */}
                        <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                            <span>Proveedor de IA</span>
                            <select
                                value={aiProvider === AI_PROVIDER_IDS.DEEPSEEK ? AI_PROVIDER_IDS.OPENROUTER : (aiProvider || DEFAULT_AI_PROVIDER)}
                                onChange={(e) => setAiProvider?.(e.target.value)}
                                className="flu-settings-image-config__input"
                            >
                                <option value={AI_PROVIDER_IDS.OPENROUTER}>Gemini 2.5 Flash Lite (OpenRouter) — por defecto</option>
                                <option value={AI_PROVIDER_IDS.LOCAL}>Local (Ollama / LM Studio)</option>
                            </select>
                        </label>

                        {/* ---- Texto (Gemini) ---- */}
                        <div className="flu-settings-section">
                            <h4 className="flu-settings-section__title">Texto (Gemini 2.5 Flash Lite vía OpenRouter)</h4>
                            <div className="flu-settings-section__body">
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                    <span className="flu-settings-image-config__section-label">
                                        {pickText(language, 'modelo')}
                                    </span>
                                    <input
                                        type="text"
                                        className="flu-settings-image-config__input"

                                        placeholder={OPENROUTER_DEFAULTS.MODEL}
                                        defaultValue={textModel}
                                        onChange={(e) => handleTextModelCommit(e.target.value)}
                                    />
                                </label>
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                    <span className="flu-settings-image-config__section-label">
                                        {pickText(language, 'api_key_opcional')}
                                    </span>
                                    <div className="flu-settings-row">
                                        <input
                                            type="password"
                                            className="flu-settings-image-config__input"
                                            style={{ flex: 1 }}
                                            placeholder={pickText(language, 'opcional_openrouter_api_key')}
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
                                            {pickText(language, 'mostrar_ocultar')}
                                        </button>
                                    </div>
                                    {apiKey && (
                                        <span className="flu-settings-api-badge">
                                            {pickText(language, 'api_key_configurada')}
                                        </span>
                                    )}
                                </label>
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                    <span className="flu-settings-image-config__section-label">
                                        {pickText(language, 'url_de_api')}
                                    </span>
                                    <input
                                        type="text"
                                        className="flu-settings-image-config__input"
                                        placeholder={OPENROUTER_DEFAULTS.API_URL}
                                        defaultValue={textApiUrl}
                                        onChange={(e) => handleTextApiUrlCommit(e.target.value)}
                                    />
                                </label>
                            </div>
                        </div>

                        {/* ---- Imagen (Pollinations) ---- */}
                        <div className="flu-settings-section">
                            <h4 className="flu-settings-section__title">Imagen (Pollinations)</h4>
                            <div className="flu-settings-section__body">
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                    <span className="flu-settings-image-config__section-label">
                                        {pickText(language, 'modelo')}
                                    </span>
                                    <input
                                        type="text"
                                        className="flu-settings-image-config__input"

                                        placeholder={'Pollinations (default)'}
                                        defaultValue={imageModel}
                                        onChange={(e) => handleImageModelCommit(e.target.value)}
                                    />
                                </label>
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                    <span className="flu-settings-image-config__section-label">
                                        {'API Key'}
                                    </span>
                                    <div className="flu-settings-row">
                                        <input
                                            type="password"
                                            className="flu-settings-image-config__input"
                                            style={{ flex: 1 }}
                                            placeholder={pickText(language, 'api_key_opcional_para_servicio_de_imagen')}
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
                                            {pickText(language, 'mostrar_ocultar')}
                                        </button>
                                    </div>
                                </label>
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                    <span className="flu-settings-image-config__section-label">
                                        {pickText(language, 'url_de_api')}
                                    </span>
                                    <input
                                        type="text"
                                        className="flu-settings-image-config__input"
                                        placeholder={POLLINATIONS_DEFAULTS.BASE_URL}
                                        defaultValue={imageApiUrl}
                                        onChange={(e) => handleImageApiUrlCommit(e.target.value)}
                                    />
                                </label>
                            </div>
                        </div>

                        {/* ---- Imagen Gemini (fallback) ---- */}
                        <div className="flu-settings-section">
                            <h4 className="flu-settings-section__title">Imagen Gemini (fallback)</h4>
                            <div className="flu-settings-section__body">
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                    <span className="flu-settings-image-config__section-label">
                                        {pickText(language, 'gemini_api_key_dedicada')}
                                    </span>
                                    <div className="flu-settings-row">
                                        <input
                                            type="password"
                                            className="flu-settings-image-config__input"
                                            style={{ flex: 1 }}
                                            placeholder={pickText(language, 'opcional_gemini_api_key_nativa')}
                                            defaultValue={geminiApiKey}
                                            onChange={(e) => handleGeminiApiKeyCommit(e.target.value)}
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
                                            {pickText(language, 'mostrar_ocultar')}
                                        </button>
                                    </div>
                                </label>
                                <p className="flu-settings-hint">
                                    {pickText(language, 'si_esta_vacia_se_usa_la_api_key_de_openrou')}
                                </p>
                            </div>
                        </div>

                        {/* ---- OCR ---- */}
                        <div className="flu-settings-section">
                            <h4 className="flu-settings-section__title">OCR</h4>
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
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                    <span>Modelo de OCR</span>
                                    <input
                                        type="text"
                                        className="flu-settings-image-config__input"
                                        defaultValue={ocrModel || ''}
                                        onChange={(e) => handleOcrModelCommit?.(e.target.value)}
                                    />
                                </label>
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
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

                        {/* ---- Video ---- */}
                        <div className="flu-settings-section">
                            <h4 className="flu-settings-section__title">Video</h4>
                            <div className="flu-settings-section__body">
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                    <span>{pickText(language, 'clave_api_de_fal_ai')}</span>
                                    <div className="flu-settings-row">
                                        <input
                                            type={revealFalKey ? 'text' : 'password'}
                                            className="flu-settings-image-config__input"
                                            style={{ flex: 1 }}
                                            placeholder="key-id:key-secret"
                                            defaultValue={falApiKey || ''}
                                            data-testid="video-falai-key"
                                            onChange={(e) => handleFalApiKeyCommit?.(e.target.value)}
                                        />
                                        <button
                                            type="button"
                                            className="flu-settings-reveal-btn"
                                            onClick={() => setRevealFalKey((prev) => !prev)}
                                        >
                                            {pickText(language, 'mostrar_ocultar')}
                                        </button>
                                    </div>
                                </label>
                                <p className="flu-settings-image-config__hint">
                                    {pickText(language, 'sin_clave_la_generacion_de_video_produce_s')}
                                </p>
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                    <span>{pickText(language, 'modelo_de_video_fal_ai')}</span>
                                    <input
                                        type="text"
                                        className="flu-settings-image-config__input"
                                        placeholder={FALAI_CONFIG.VIDEO_MODEL}
                                        defaultValue={falVideoModel || ''}
                                        data-testid="video-falai-model"
                                        onChange={(e) => handleFalVideoModelCommit?.(e.target.value)}
                                    />
                                </label>
                                <p className="flu-settings-image-config__hint">
                                    {pickText(language, 'barato_fal_ai_wan_25_preview_text_to_video')}
                                </p>
                            </div>
                        </div>

                        {/* ---- Búsqueda web (Tavily + OpenRouter) ---- */}
                        <div className="flu-settings-section">
                            <h4 className="flu-settings-section__title">Búsqueda web</h4>
                            <div className="flu-settings-section__body">
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                    <span className="flu-settings-image-config__section-label">
                                        Clave API de Tavily
                                    </span>
                                    <div className="flu-settings-row">
                                        <input
                                            type={revealWeb.tavily ? 'text' : 'password'}
                                            className="flu-settings-image-config__input"
                                            style={{ flex: 1 }}
                                            placeholder="tvly-…"
                                            value={webDraft.tavilyKey}
                                            data-testid="search-web-tavily-key"
                                            onChange={(e) => setWebField('tavilyKey', e.target.value)}
                                            onBlur={() => persistWeb(webDraftRef.current)}
                                        />
                                        <button
                                            type="button"
                                            className="flu-settings-reveal-btn"
                                            onClick={() => setRevealWeb((prev) => ({ ...prev, tavily: !prev.tavily }))}
                                        >
                                            {pickText(language, 'mostrar_ocultar')}
                                        </button>
                                    </div>
                                </label>
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                    <span className="flu-settings-image-config__section-label">
                                        {pickText(language, 'clave_api_de_openrouter_busqueda_web')}
                                    </span>
                                    <div className="flu-settings-row">
                                        <input
                                            type={revealWeb.openrouter ? 'text' : 'password'}
                                            className="flu-settings-image-config__input"
                                            style={{ flex: 1 }}
                                            placeholder="sk-or-…"
                                            value={webDraft.openrouterKey}
                                            data-testid="search-web-openrouter-key"
                                            onChange={(e) => setWebField('openrouterKey', e.target.value)}
                                            onBlur={() => persistWeb(webDraftRef.current)}
                                        />
                                        <button
                                            type="button"
                                            className="flu-settings-reveal-btn"
                                            onClick={() => setRevealWeb((prev) => ({ ...prev, openrouter: !prev.openrouter }))}
                                        >
                                            {pickText(language, 'mostrar_ocultar')}
                                        </button>
                                    </div>
                                    {webSave.failed ? (
                                        <span
                                            className="flu-settings-api-badge"
                                            style={{ color: 'var(--accent-red, #e5484d)', borderColor: 'var(--accent-red, #e5484d)' }}
                                            data-testid="search-web-save-error"
                                        >
                                            {' '}
                                            {language === 'en'
                                                ? `Key NOT saved (${webSave.error || 'storage error'})`
                                                : `La clave NO se guardó (${webSave.error || 'error de almacenamiento'})`}
                                        </span>
                                    ) : null}
                                </label>
                                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                                    <span className="flu-settings-image-config__section-label">
                                        {pickText(language, 'modelo_de_openrouter_busqueda_web')}
                                    </span>
                                    <input
                                        type="text"
                                        className="flu-settings-image-config__input"

                                        placeholder={`${OPENROUTER_DEFAULTS.MODEL}:online`}
                                        value={webDraft.openrouterModel}
                                        data-testid="search-web-openrouter-model"
                                        onChange={(e) => setWebField('openrouterModel', e.target.value)}
                                        onBlur={() => persistWeb(webDraftRef.current)}
                                    />
                                </label>
                                <p className="flu-settings-hint">
                                    {pickText(language, 'cadena_de_busqueda_web_tavily_openrouter_w')}
                                </p>
                            </div>
                        </div>

                        {/* Limpiar caché y recargar */}
                        {onClearCache && (
                            <div className="flu-settings-row">
                                <button
                                    type="button"
                                    className="flu-settings-clear-cache-btn"
                                    onClick={() => {
                                        const confirmed = window.confirm(
                                            pickText(language, 'limpiar_cache_de_la_app_y_recargar_se_cons')
                                        );
                                        if (confirmed) onClearCache();
                                    }}
                                >
                                    {pickText(language, 'limpiar_cache_y_recargar')}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </SettingsPanelShell>

            {/* ---- Configurador de FLU (personalidad + branding estacional) ---- */}
            <SettingsPanelShell title="Configurador de FLU" bare>
                <div className="flu-settings-image-config__body flu-settings-image-config__body--flu-config">

                    <div className="flu-settings-section">
                        <div className="flu-settings-section__title">
                            Personalidad
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
                                        const tone = AVAILABLE_TONES.find((t) => t === e.target.value);
                                        if (!tone) return;
                                        integrationStore.setConfig({
                                            personality: { ...integrationStore.config.personality, tone },
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

                    {/* ---- Instrucciones personalizadas ---- */}
                    <div className="flu-settings-section">
                        <div className="flu-settings-section-label">Instrucciones personalizadas</div>
                        <textarea
                            value={integrationStore.config.personality.customInstructions || ''}
                            onChange={(e) => {
                                integrationStore.setConfig({
                                    personality: { ...integrationStore.config.personality, customInstructions: e.target.value },
                                });
                            }}
                            placeholder={pickText(language, 'ej_comportate_mas_expresivo_usa_estas_anim')}
                            className="flu-settings-textarea"
                        />
                        <div className="flu-settings-hint">
                            {pickText(language, 'estas_instrucciones_se_inyectan_en_el_prom')}
                        </div>
                    </div>

                    <div className="flu-settings-section">
                        <div className="flu-settings-section__title">Avanzado</div>
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

                    {/* ---- Detección de Emociones del Usuario ---- */}
                    <div className="flu-settings-section">
                        <div className="flu-settings-section__title">Detección de emociones del usuario</div>
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

                    {/* ---- Teoría de la Mente ---- */}
                    <div className="flu-settings-section">
                        <div className="flu-settings-section__title">Teoría de la Mente (participantes)</div>
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

                    {/* ---- Eventos del Sistema ---- */}
                    <div className="flu-settings-section">
                        <div className="flu-settings-section__title">Eventos del sistema</div>
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

                    <div className="flu-settings-image-config__group">
                        <div className="flu-settings-image-config__group-title">Imagen</div>
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
                        <div className="flu-settings-section__title">Voz</div>
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
                            <label className="flu-settings-image-config__field flu-settings-image-config__field--checkbox">
                                <input
                                    type="checkbox"
                                    checked={integrationStore.voiceConfig.requireWakeAlways === true}
                                    onChange={(e) => integrationStore.setVoiceConfig({ requireWakeAlways: e.target.checked })}
                                />
                                <span>Exigir la palabra de activación en cada frase (piso cerrado)</span>
                            </label>
                        </div>
                    </div>
                </div>
            </SettingsPanelShell>

            {/* ---- Mis temporadas (branding por temporalidad) ---- */}
            <SettingsPanelShell title="Mis temporadas" bare>
                <div className="flu-settings-image-config__group">
                    {/* Modo */}
                    <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                        <span className="flu-settings-section-label">
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
                            <span className="flu-settings-section-label">
                                Temporada
                            </span>
                            <select
                                value={brandingSeason || 'default'}
                                onChange={(e) => onBrandingSeasonChange?.(e.target.value)}
                                className="flu-settings-image-config__input"
                            >
                                {getAllPalettes().map((palette) => (
                                    <option key={palette.id} value={palette.id}>
                                        {palette.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    {/* Cumpleaños */}
                    <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                        <span className="flu-settings-section-label">
                            Mi cumpleaños (opcional)
                        </span>
                        <input
                            type="date"
                            value={brandingBirthday || ''}
                            onChange={(e) => onBrandingBirthdayChange?.(e.target.value || null)}
                            className="flu-settings-image-config__input"
                        />
                    </label>

                    {/* Preview de paleta activa */}
                    {brandingMode !== 'disabled' && brandingSeason && (
                        <div className="flu-settings-branding-preview">
                            <div style={{ marginBottom: 4 }}>
                                <strong>Paleta activa:</strong> {getPalette(brandingSeason).name}
                            </div>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {Object.entries(getPalette(brandingSeason).colors).slice(0, 6).map(([key, color]) => (
                                    <span
                                        key={key}
                                        title={key}
                                        className="flu-settings-branding-swatch"
                                        style={{ background: color }}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </SettingsPanelShell>

            {/* ---- Palabras de Activación ---- */}
            <SettingsPanelShell title="Palabras de Activación" bare>
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
            </SettingsPanelShell>

            {/* ---- Gestión de Logs y Auditoría ---- */}
            <SettingsPanelShell title="Diagnóstico y auditoría" bare>
                <div className="flu-settings-image-config__body">
                    <div className="flu-settings-image-config__group">
                        {/* Acciones de auditoría */}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                                type="button"
                                className="flu-settings-btn"
                                onClick={async () => {
                                    await audit.clearAll();
                                    alert('Registro de auditoría limpiado correctamente');
                                }}
                            >
                                Limpiar registro de auditoría
                            </button>
                            <button
                                type="button"
                                className="flu-settings-btn"
                                onClick={() => {
                                    // Dueño único de la descarga: downloadBlob.
                                    downloadBlob(
                                        new Blob([JSON.stringify(audit.logs, null, 2)], { type: 'application/json' }),
                                        'flu-audit-logs.json',
                                    );
                                }}
                            >
                                Exportar registro de auditoría
                            </button>
                        </div>

                        {/* Diagnóstico: tres sistemas independientes */}
                        <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span>Logs de depuración (verbosos)</span>
                                <input
                                    type="checkbox"
                                    checked={verboseLogsEnabled}
                                    onChange={(e) => setVerboseLogsEnabled(e.target.checked)}
                                />
                            </div>
                        </label>
                        <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span>Enviar logs al servidor (debug.log)</span>
                                <input
                                    type="checkbox"
                                    checked={relayLogsEnabled}
                                    onChange={(e) => setRelayLogsEnabled(e.target.checked)}
                                />
                            </div>
                        </label>
                        <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span>Grabar sesión (audio + eventos)</span>
                                <input
                                    type="checkbox"
                                    checked={recordingEnabled}
                                    onChange={(e) => setRecordingEnabled(e.target.checked)}
                                />
                            </div>
                            <small style={{ color: 'var(--text-secondary)' }}>
                                La grabación incluye audio sensible. Se apaga al cerrar la sesión.
                            </small>
                        </label>

                        {/* Vista previa de auditoría */}
                        <div>
                            <span className="flu-settings-sub-title">Últimos eventos registrados</span>
                            {audit.loading ? (
                                <small style={{ color: 'var(--text-secondary)' }}>Cargando registro de auditoría…</small>
                            ) : audit.logs.length === 0 ? (
                                <small style={{ color: 'var(--text-secondary)' }}>Sin eventos registrados todavía.</small>
                            ) : (
                                <ul className="flu-settings-audit-list">
                                    {audit.logs.slice(0, 8).map((entry) => (
                                        <li key={entry.id} style={{ marginBottom: 4 }}>
                                            <strong>{entry.action}</strong> · {entry.entity}
                                            {entry.context ? ` — ${entry.context}` : ''}
                                            <span style={{ opacity: 0.7 }}> · {new Date(entry.timestamp).toLocaleString()}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>
            </SettingsPanelShell>

            <FluParticipantSettingsPanel
                language={language}
                onConfigChange={handleParticipantConfigChange}
                voices={voices}
            />
        </>
    );
}
