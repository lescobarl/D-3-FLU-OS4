// ============================================================
// useConfigPersistence — Config State + localStorage Persistence
// ============================================================
// Extracts all configuration state management from App.tsx:
//   - Text (Gemini) API key, model, URL
//   - Image (Pollinations) API key, model, URL
//   - Language, session role
//   - SpeechSynthesis voices
//   - All commit handlers with localStorage + audit logging
//
// Cumple:
//   - Rule #1: NO HARDCODE — configuración desde appConfig
//   - Obligación #5: Log de auditoría
// ============================================================

import { useState, useCallback, useEffect, useRef } from 'react';
import { STORAGE_KEYS, UI_DEFAULTS, resolveTextApiKey, resolveGeminiApiKey, resolveFalVideoModel } from '../core/config/appConfig';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { getSpeechVoices, subscribeSpeechVoices } from '../voice/lib/fluSpeech';
import { useAuditLog } from './useAuditLog';
import { logCaughtError } from '../lib/caughtError';
import { localGet, localKeys, localRemove, localSet } from '../core/storage/localStore';

// ============================================================
// Tipos
// ============================================================

export interface ConfigPersistence {
    // Text (Gemini) Config
    apiKey: string;
    textModel: string;
    textApiUrl: string;
    // Gemini nativo (paso 5): clave dedicada para el fallback de imagen
    geminiApiKey: string;
    // Image (Pollinations) Config
    imageApiKey: string;
    imageModel: string;
    imageApiUrl: string;
    // Video (fal.ai) — key para video real text-to-video
    falApiKey: string;
    falVideoModel: string;
    // OCR Config (local Tesseract default + endpoint remoto opcional)
    ocrApiKey: string;
    ocrModel: string;
    ocrApiUrl: string;
    // Language & Role
    language: 'es' | 'en' | 'both';
    sessionRole: string;
    // Speech voices
    voices: SpeechSynthesisVoice[];
    // Refs for volatile state (used by onContractResolved)
    languageRef: React.MutableRefObject<string>;
    sessionRoleRef: React.MutableRefObject<string>;
    // Commit handlers
    handleTextApiKeyCommit: (key: string) => void;
    handleTextModelCommit: (model: string) => void;
    handleTextApiUrlCommit: (url: string) => void;
    handleGeminiApiKeyCommit: (key: string) => void;
    handleImageApiKeyCommit: (key: string) => void;
    handleImageModelCommit: (model: string) => void;
    handleImageApiUrlCommit: (url: string) => void;
    handleFalApiKeyCommit: (key: string) => void;
    handleFalVideoModelCommit: (model: string) => void;
    handleOcrApiKeyCommit: (key: string) => void;
    handleOcrModelCommit: (model: string) => void;
    handleOcrApiUrlCommit: (url: string) => void;
    // Cache / storage utilities
    handleClearCache: () => void;
    // Setters
    setLanguage: React.Dispatch<React.SetStateAction<'es' | 'en' | 'both'>>;
    setSessionRole: React.Dispatch<React.SetStateAction<string>>;
    // Wake words & debug logs (persistentes + write-through a FLU_CONFIG)
    wakeWords: string;
    setWakeWords: (value: string) => void;
    debugLogsEnabled: boolean;
    setDebugLogsEnabled: (enabled: boolean) => void;
    wakeWordsRef: React.MutableRefObject<string>;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Load a string value from localStorage with error handling.
 */
function loadString(key: string, fallback = ''): string {
    try {
        const val = localGet(key);
        return val ?? fallback;
    } catch (e) {
        logCaughtError('[catch] src/hooks/useConfigPersistence.ts', e);
        return fallback;
    }
}

/**
 * Save a string value to localStorage with error handling.
 */
function saveString(key: string, value: string): void {
    try {
        localSet(key, value);
    } catch (e) {
        logCaughtError('[catch] src/hooks/useConfigPersistence.ts', e);
        // Silently ignore storage errors (quota exceeded, private mode, etc.)
    }
}

// ============================================================
// Hook
// ============================================================

export function useConfigPersistence(): ConfigPersistence {
    const auditLog = useAuditLog();

    // ---- Text (Gemini) Config ----
    // Usa resolveTextApiKey() centralizado desde appConfig para evitar
    // duplicación de lógica de resolución de API key (Rule #1: NO HARDCODE)
    const [apiKey, setApiKey] = useState<string>(() => resolveTextApiKey());

    const [textModel, setTextModel] = useState<string>(() => loadString(STORAGE_KEYS.TEXT_MODEL));
    const [textApiUrl, setTextApiUrl] = useState<string>(() => loadString(STORAGE_KEYS.TEXT_API_URL));

    // ---- Gemini nativo (paso 5): clave dedicada + toggle del fallback de imagen ----
    // Usa resolveGeminiApiKey() centralizado desde appConfig (Rule #1: NO HARDCODE).
    const [geminiApiKey, setGeminiApiKey] = useState<string>(() => resolveGeminiApiKey());

    // ---- Image (Pollinations) Config ----
    const [imageApiKey, setImageApiKey] = useState<string>(() => loadString(STORAGE_KEYS.IMAGE_API_KEY));
    const [imageModel, setImageModel] = useState<string>(() => loadString(STORAGE_KEYS.IMAGE_MODEL));
    const [imageApiUrl, setImageApiUrl] = useState<string>(() => loadString(STORAGE_KEYS.IMAGE_API_URL));
    // ---- Video (fal.ai) ----
    const [falApiKey, setFalApiKey] = useState<string>(() => loadString(STORAGE_KEYS.FALAI_API_KEY));
    const [falVideoModel, setFalVideoModel] = useState<string>(() => resolveFalVideoModel());

    // ---- OCR Config (local Tesseract default + endpoint remoto opcional) ----
    const [ocrApiKey, setOcrApiKey] = useState<string>(() => loadString(STORAGE_KEYS.OCR_API_KEY));
    const [ocrModel, setOcrModel] = useState<string>(() => loadString(STORAGE_KEYS.OCR_MODEL));
    const [ocrApiUrl, setOcrApiUrl] = useState<string>(() => loadString(STORAGE_KEYS.OCR_API_URL));

    // ---- Language ----
    const [language, setLanguage] = useState<'es' | 'en' | 'both'>(() => {
        try {
            const saved = localGet(STORAGE_KEYS.LANGUAGE);
            if (saved === 'es' || saved === 'en' || saved === 'both') return saved;
        } catch (e) {
        logCaughtError('[catch] src/hooks/useConfigPersistence.ts', e); /* ignore */ }
        return UI_DEFAULTS.LANGUAGE;
    });

    // ---- Session Role ----
    const [sessionRole, setSessionRole] = useState<string>(() => {
        return loadString(STORAGE_KEYS.SESSION_ROLE, FLU_CONFIG.sessionDefaults.role);
    });

    // ---- Wake Words & Debug Logs (persistente + write-through a FLU_CONFIG) ----
    const [wakeWords, setWakeWordsState] = useState<string>(() =>
        loadString(STORAGE_KEYS.WAKE_WORDS, FLU_CONFIG.voiceCommands.wakeWords.join('\n')),
    );
    const [debugLogsEnabled, setDebugLogsEnabledState] = useState<boolean>(() => {
        const saved = loadString(STORAGE_KEYS.DEBUG_LOGS_ENABLED);
        return saved === '' ? (FLU_CONFIG.debug.enabled ?? false) : saved === 'true';
    });
    const wakeWordsRef = useRef(wakeWords);
    wakeWordsRef.current = wakeWords;

    // ---- Refs for volatile state (used by onContractResolved) ----
    const languageRef = useRef(language);
    languageRef.current = language;
    const sessionRoleRef = useRef(sessionRole);
    sessionRoleRef.current = sessionRole;

    // ---- SpeechSynthesis voices ----
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
    useEffect(() => {
        const load = () => {
            const available = getSpeechVoices();
            if (available.length > 0) setVoices(available);
        };
        load();
        return subscribeSpeechVoices(load);
    }, []);

    // ---- Persist language changes ----
    useEffect(() => {
        saveString(STORAGE_KEYS.LANGUAGE, language);
    }, [language]);

    // ---- Persist session role ----
    useEffect(() => {
        saveString(STORAGE_KEYS.SESSION_ROLE, sessionRole);
    }, [sessionRole]);

    // ---- Persist wake words & debug logs (write-through a FLU_CONFIG ESM) ----
    const setWakeWords = useCallback((value: string) => {
        setWakeWordsState(value);
        saveString(STORAGE_KEYS.WAKE_WORDS, value);
        if (FLU_CONFIG.voiceCommands && Array.isArray(FLU_CONFIG.voiceCommands.wakeWords)) {
            FLU_CONFIG.voiceCommands.wakeWords.length = 0;
            FLU_CONFIG.voiceCommands.wakeWords.push(...value.split('\n').map((w) => w.trim()).filter(Boolean));
        }
    }, []);
    const setDebugLogsEnabled = useCallback((enabled: boolean) => {
        setDebugLogsEnabledState(enabled);
        saveString(STORAGE_KEYS.DEBUG_LOGS_ENABLED, String(enabled));
        if (FLU_CONFIG.debug) FLU_CONFIG.debug.enabled = enabled;
    }, []);

    useEffect(() => {
        if (FLU_CONFIG.voiceCommands && Array.isArray(FLU_CONFIG.voiceCommands.wakeWords)) {
            FLU_CONFIG.voiceCommands.wakeWords.length = 0;
            FLU_CONFIG.voiceCommands.wakeWords.push(...wakeWords.split('\n').map((w) => w.trim()).filter(Boolean));
        }
    }, [wakeWords]);
    useEffect(() => {
        if (FLU_CONFIG.debug) FLU_CONFIG.debug.enabled = debugLogsEnabled;
    }, [debugLogsEnabled]);

    // ---- Text (Gemini) config handlers ----
    const handleTextApiKeyCommit = useCallback((key: string) => {
        const prev = apiKey;
        setApiKey(key);
        saveString(STORAGE_KEYS.TEXT_API_KEY, key);
        auditLog.logChange('config', 'text-api-key', prev, key, 'Text API Key updated').catch(console.error);
    }, [apiKey, auditLog]);

    const handleTextModelCommit = useCallback((model: string) => {
        const prev = textModel;
        setTextModel(model);
        saveString(STORAGE_KEYS.TEXT_MODEL, model);
        auditLog.logChange('config', 'text-model', prev, model, 'Text Model updated').catch(console.error);
    }, [textModel, auditLog]);

    const handleTextApiUrlCommit = useCallback((url: string) => {
        const prev = textApiUrl;
        setTextApiUrl(url);
        saveString(STORAGE_KEYS.TEXT_API_URL, url);
        auditLog.logChange('config', 'text-api-url', prev, url, 'Text API URL updated').catch(console.error);
    }, [textApiUrl, auditLog]);

    // ---- Gemini nativo (paso 5) config handlers ----
    const handleGeminiApiKeyCommit = useCallback((key: string) => {
        const prev = geminiApiKey;
        setGeminiApiKey(key);
        saveString(STORAGE_KEYS.GEMINI_API_KEY, key);
        auditLog.logChange('config', 'gemini-api-key', prev, key, 'Gemini API Key updated').catch(console.error);
    }, [geminiApiKey, auditLog]);

    // ---- Image (Pollinations) config handlers ----
    const handleImageApiKeyCommit = useCallback((key: string) => {
        const prev = imageApiKey;
        setImageApiKey(key);
        saveString(STORAGE_KEYS.IMAGE_API_KEY, key);
        auditLog.logChange('config', 'image-api-key', prev, key, 'Image API Key updated').catch(console.error);
    }, [imageApiKey, auditLog]);

    const handleFalApiKeyCommit = useCallback((key: string) => {
        const prev = falApiKey;
        setFalApiKey(key);
        saveString(STORAGE_KEYS.FALAI_API_KEY, key);
        auditLog.logChange('config', 'falai-api-key', prev, key, 'Fal.ai Video API Key updated').catch(console.error);
    }, [falApiKey, auditLog]);

    const handleFalVideoModelCommit = useCallback((model: string) => {
        const prev = falVideoModel;
        setFalVideoModel(model);
        saveString(STORAGE_KEYS.FALAI_VIDEO_MODEL, model);
        auditLog.logChange('config', 'falai-video-model', prev, model, 'Fal.ai Video model updated').catch(console.error);
    }, [falVideoModel, auditLog]);

    const handleImageModelCommit = useCallback((model: string) => {
        const prev = imageModel;
        setImageModel(model);
        saveString(STORAGE_KEYS.IMAGE_MODEL, model);
        auditLog.logChange('config', 'image-model', prev, model, 'Image Model updated').catch(console.error);
    }, [imageModel, auditLog]);

    const handleImageApiUrlCommit = useCallback((url: string) => {
        const prev = imageApiUrl;
        setImageApiUrl(url);
        saveString(STORAGE_KEYS.IMAGE_API_URL, url);
        auditLog.logChange('config', 'image-api-url', prev, url, 'Image API URL updated').catch(console.error);
    }, [imageApiUrl, auditLog]);

    // ---- OCR config handlers (local Tesseract default + endpoint remoto opcional) ----
    const handleOcrApiKeyCommit = useCallback((key: string) => {
        const prev = ocrApiKey;
        setOcrApiKey(key);
        saveString(STORAGE_KEYS.OCR_API_KEY, key);
        auditLog.logChange('config', 'ocr-api-key', prev, key, 'OCR API Key updated').catch(console.error);
    }, [ocrApiKey, auditLog]);

    const handleOcrModelCommit = useCallback((model: string) => {
        const prev = ocrModel;
        setOcrModel(model);
        saveString(STORAGE_KEYS.OCR_MODEL, model);
        auditLog.logChange('config', 'ocr-model', prev, model, 'OCR Model updated').catch(console.error);
    }, [ocrModel, auditLog]);

    const handleOcrApiUrlCommit = useCallback((url: string) => {
        const prev = ocrApiUrl;
        setOcrApiUrl(url);
        saveString(STORAGE_KEYS.OCR_API_URL, url);
        auditLog.logChange('config', 'ocr-api-url', prev, url, 'OCR API URL updated').catch(console.error);
    }, [ocrApiUrl, auditLog]);

    // ---- Rehidratar apiKey desde localStorage cuando cambia (storage event) ----
    // Defiende contra desync prop↔storage: si otra pestaña o un commit previo
    // actualizó la key, el estado React se sincroniza automáticamente.
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === STORAGE_KEYS.TEXT_API_KEY) {
                setApiKey(String(e.newValue ?? '').trim());
            }
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    // ---- Limpiar caché y forzar recarga ----
    // Mantiene la configuración esencial (API keys, modelo, URL, idioma, rol)
    // y borra el resto del estado volátil que puede quedar obsoleto.
    const handleClearCache = useCallback(() => {
        const keep = new Set<string>([
            STORAGE_KEYS.TEXT_API_KEY,
            STORAGE_KEYS.TEXT_MODEL,
            STORAGE_KEYS.TEXT_API_URL,
            STORAGE_KEYS.GEMINI_API_KEY,
            STORAGE_KEYS.IMAGE_API_KEY,
            STORAGE_KEYS.IMAGE_MODEL,
            STORAGE_KEYS.IMAGE_API_URL,
            STORAGE_KEYS.OCR_API_KEY,
            STORAGE_KEYS.OCR_MODEL,
            STORAGE_KEYS.OCR_API_URL,
            STORAGE_KEYS.LANGUAGE,
            STORAGE_KEYS.SESSION_ROLE,
            STORAGE_KEYS.WAKE_WORDS,
            STORAGE_KEYS.DEBUG_LOGS_ENABLED,
            // Config del buscador (llaves/modelo de proveedores web). Sin esto,
            // "Limpiar caché" borraba la key de OpenRouter/Tavily.
            STORAGE_KEYS.SEARCH_CONFIG_OVERRIDES,
        ]);
        try {
            const toRemove = localKeys().filter((key) => !keep.has(key));
            toRemove.forEach((k) => localRemove(k));
        } catch (e) {
        logCaughtError('[catch] src/hooks/useConfigPersistence.ts', e); /* ignore */ }
        // Rehidratar el estado desde la fuente de verdad (localStorage)
        setApiKey(resolveTextApiKey());
        window.location.reload();
    }, []);

    return {
        apiKey,
        textModel,
        textApiUrl,
        geminiApiKey,
        imageApiKey,
        imageModel,
        imageApiUrl,
        falApiKey,
        falVideoModel,
        ocrApiKey,
        ocrModel,
        ocrApiUrl,
        language,
        sessionRole,
        voices,
        languageRef,
        sessionRoleRef,
        handleTextApiKeyCommit,
        handleTextModelCommit,
        handleTextApiUrlCommit,
        handleGeminiApiKeyCommit,
        handleImageApiKeyCommit,
        handleImageModelCommit,
        handleImageApiUrlCommit,
        handleFalApiKeyCommit,
        handleFalVideoModelCommit,
        handleOcrApiKeyCommit,
        handleOcrModelCommit,
        handleOcrApiUrlCommit,
        handleClearCache,
        setLanguage,
        setSessionRole,
        wakeWords,
        setWakeWords,
        debugLogsEnabled,
        setDebugLogsEnabled,
        wakeWordsRef,
    };
}
