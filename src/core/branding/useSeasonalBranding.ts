// ============================================================
// FLU OS4 — useSeasonalBranding Hook
// ============================================================
// Hook principal que conecta el calendario de temporalidades
// con las paletas de colores y la UI.
//
// Modos:
//   - auto: Detecta automáticamente según calendario SEP + cumpleaños
//   - manual: Usa la temporada configurada por el usuario
//   - disabled: No aplica branding (tema oscuro default siempre)
//
// Persiste la configuración en IndexedDB (brandingConfig table).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { fluDb, newId, newSyncTuple, bumpSync } from '../db/fluDatabase';
import { addAuditLog } from '../db/fluDatabase';
import { getActiveSeason, type CustomEvent, type SeasonalEvent } from './seasonalCalendar';
import { getPalette, applyPaletteToCSS, resetPaletteToDefault, type Palette } from './seasonalPalettes';

// ============================================================
// Types
// ============================================================

export type BrandingMode = 'auto' | 'manual' | 'disabled';

export interface BrandingConfig {
    mode: BrandingMode;
    /** Temporada activa (key de paleta). En auto se detecta; en manual se fija. */
    activeSeason: string;
    /** Fecha de cumpleaños del usuario (YYYY-MM-DD) o null */
    birthday: string | null;
    /** Eventos personalizados */
    customEvents: CustomEvent[];
    /** Celebrar logros de Materia Gris */
    celebrateAchievements: boolean;
    /** Celebrar aniversarios de uso */
    celebrateAnniversaries: boolean;
}

export interface SeasonalBrandingState {
    config: BrandingConfig;
    currentEvent: SeasonalEvent | null;
    currentPalette: Palette;
    isBirthday: boolean;
    celebrandoA?: string;
}

export interface SeasonalBrandingActions {
    setMode: (mode: BrandingMode) => Promise<void>;
    setActiveSeason: (season: string) => Promise<void>;
    setBirthday: (birthday: string | null) => Promise<void>;
    addCustomEvent: (event: CustomEvent) => Promise<void>;
    removeCustomEvent: (id: string) => Promise<void>;
    setCelebrateAchievements: (enabled: boolean) => Promise<void>;
    setCelebrateAnniversaries: (enabled: boolean) => Promise<void>;
    refresh: () => Promise<void>;
}

// ============================================================
// Default config
// ============================================================

// El branding arranca APAGADO (disabled) por defecto. Solo se enciende a
// petición explícita por voz ("activa la estación/branding" → auto, o
// "activa la estación de X" → manual + X). No está asociado a perfiles:
// es global y por temporada/calendario.
const DEFAULT_CONFIG: BrandingConfig = {
    mode: 'disabled',
    activeSeason: 'default',
    birthday: null,
    customEvents: [],
    celebrateAchievements: false,
    celebrateAnniversaries: false,
};

// ============================================================
// DB helpers
// ============================================================

const CONFIG_KEYS = {
    MODE: 'branding_mode',
    ACTIVE_SEASON: 'branding_activeSeason',
    BIRTHDAY: 'branding_birthday',
    CUSTOM_EVENTS: 'branding_customEvents',
    CELEBRATE_ACHIEVEMENTS: 'branding_celebrateAchievements',
    CELEBRATE_ANNIVERSARIES: 'branding_celebrateAnniversaries',
    // Bandera de migración única: el branding ahora arranca APAGADO por defecto.
    MIGRATED: 'branding_migrated_v2',
} as const;

async function loadConfigFromDB(): Promise<BrandingConfig> {
    try {
        const records = await fluDb.brandingConfig.toArray();
        const config = { ...DEFAULT_CONFIG };
        let hasMigratedFlag = false;

        for (const record of records) {
            switch (record.key) {
                case CONFIG_KEYS.MODE:
                    if (record.value === 'auto' || record.value === 'manual' || record.value === 'disabled') {
                        config.mode = record.value;
                    }
                    break;
                case CONFIG_KEYS.ACTIVE_SEASON:
                    config.activeSeason = record.value;
                    break;
                case CONFIG_KEYS.BIRTHDAY:
                    config.birthday = record.value || null;
                    break;
                case CONFIG_KEYS.CUSTOM_EVENTS:
                    try {
                        const parsed = JSON.parse(record.value);
                        if (Array.isArray(parsed)) {
                            config.customEvents = parsed;
                        }
                    } catch { /* ignore */ }
                    break;
                case CONFIG_KEYS.CELEBRATE_ACHIEVEMENTS:
                    config.celebrateAchievements = record.value === 'true';
                    break;
                case CONFIG_KEYS.CELEBRATE_ANNIVERSARIES:
                    config.celebrateAnniversaries = record.value === 'true';
                    break;
                case CONFIG_KEYS.MIGRATED:
                    hasMigratedFlag = record.value === 'true';
                    break;
            }
        }

        // Migración única: el branding arranca APAGADO por defecto. Los usuarios
        // que tenían 'auto' guardado en su navegador pasan a 'disabled' una sola
        // vez (se persiste el nuevo estado y se marca la bandera para no repetir).
        if (!hasMigratedFlag) {
            if (config.mode === 'auto') {
                config.mode = 'disabled';
                await saveConfigToDB(CONFIG_KEYS.MODE, 'disabled');
            }
            await saveConfigToDB(CONFIG_KEYS.MIGRATED, 'true');
        }

        return config;
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

async function saveConfigToDB(key: string, value: string): Promise<void> {
    const existing = await fluDb.brandingConfig
        .where('key')
        .equals(key)
        .first();

    if (existing) {
        await fluDb.brandingConfig.put({
            ...existing,
            value,
            timestamp: new Date().toISOString(),
            sync: bumpSync(existing.sync),
        });
    } else {
        await fluDb.brandingConfig.add({
            id: newId(),
            key,
            value,
            timestamp: new Date().toISOString(),
            sync: newSyncTuple(),
        });
    }
}

// ============================================================
// Hook
// ============================================================

export function useSeasonalBranding(): SeasonalBrandingState & SeasonalBrandingActions {
    const [config, setConfig] = useState<BrandingConfig>(DEFAULT_CONFIG);
    const [loaded, setLoaded] = useState(false);
    const loadedRef = useRef(false);

    // Cargar configuración desde DB al montar
    useEffect(() => {
        if (loadedRef.current) return;
        loadedRef.current = true;

        loadConfigFromDB().then((cfg) => {
            setConfig(cfg);
            setLoaded(true);
        }).catch((err) => {
            console.error('[useSeasonalBranding] Error loading config:', err);
            setLoaded(true); // Still mark as loaded so UI works with defaults
        });
    }, []);

    // Aplicar branding cuando cambie la configuración o se cargue
    const applyBranding = useCallback((cfg: BrandingConfig) => {
        if (cfg.mode === 'disabled') {
            resetPaletteToDefault();
            return;
        }

        let seasonKey: string;

        if (cfg.mode === 'auto') {
            const result = getActiveSeason(cfg.birthday, cfg.customEvents, cfg.celebrateAchievements);
            seasonKey = result.event.palette;
        } else {
            // manual: usar la temporada que el usuario configuró
            seasonKey = cfg.activeSeason;
        }

        const palette = getPalette(seasonKey);
        applyPaletteToCSS(palette);

        // Actualizar estado interno
        setConfig((prev) => ({
            ...prev,
            activeSeason: seasonKey,
        }));

        if (cfg.mode === 'auto') {
            const result = getActiveSeason(cfg.birthday, cfg.customEvents, cfg.celebrateAchievements);
            setCurrentEvent(result.event);
            setIsBirthdayState(result.isBirthday);
            setCelebrandoA(result.celebrandoA);
        }
    }, []);

    const [currentEvent, setCurrentEvent] = useState<SeasonalEvent | null>(null);
    const [isBirthdayState, setIsBirthdayState] = useState(false);
    const [celebrandoA, setCelebrandoA] = useState<string | undefined>(undefined);

    // Aplicar branding cuando la config se cargue o cambie
    useEffect(() => {
        if (!loaded) return;
        applyBranding(config);
    }, [loaded, config.mode, config.activeSeason, config.birthday, config.customEvents, applyBranding]);

    // ============================================================
    // Actions
    // ============================================================

    const setMode = useCallback(async (mode: BrandingMode) => {
        setConfig((prev) => ({ ...prev, mode }));
        await saveConfigToDB(CONFIG_KEYS.MODE, mode);
        await addAuditLog('config:branding', 'branding', CONFIG_KEYS.MODE, config.mode, mode, 'Branding mode changed');
    }, [config.mode]);

    const setActiveSeason = useCallback(async (season: string) => {
        setConfig((prev) => ({ ...prev, activeSeason: season }));
        await saveConfigToDB(CONFIG_KEYS.ACTIVE_SEASON, season);
        await addAuditLog('config:branding', 'branding', CONFIG_KEYS.ACTIVE_SEASON, config.activeSeason, season, 'Active season changed');
    }, [config.activeSeason]);

    const setBirthday = useCallback(async (birthday: string | null) => {
        setConfig((prev) => ({ ...prev, birthday }));
        await saveConfigToDB(CONFIG_KEYS.BIRTHDAY, birthday || '');
        await addAuditLog('config:branding', 'branding', CONFIG_KEYS.BIRTHDAY, config.birthday, birthday, 'Birthday updated');
    }, [config.birthday]);

    const addCustomEvent = useCallback(async (event: CustomEvent) => {
        const updated = [...(config.customEvents || []), event];
        setConfig((prev) => ({ ...prev, customEvents: updated }));
        await saveConfigToDB(CONFIG_KEYS.CUSTOM_EVENTS, JSON.stringify(updated));
        await addAuditLog('config:branding', 'branding', CONFIG_KEYS.CUSTOM_EVENTS, config.customEvents, updated, 'Custom event added');
    }, [config.customEvents]);

    const removeCustomEvent = useCallback(async (id: string) => {
        const updated = (config.customEvents || []).filter((e) => e.id !== id);
        setConfig((prev) => ({ ...prev, customEvents: updated }));
        await saveConfigToDB(CONFIG_KEYS.CUSTOM_EVENTS, JSON.stringify(updated));
        await addAuditLog('config:branding', 'branding', CONFIG_KEYS.CUSTOM_EVENTS, config.customEvents, updated, 'Custom event removed');
    }, [config.customEvents]);

    const setCelebrateAchievements = useCallback(async (enabled: boolean) => {
        setConfig((prev) => ({ ...prev, celebrateAchievements: enabled }));
        await saveConfigToDB(CONFIG_KEYS.CELEBRATE_ACHIEVEMENTS, String(enabled));
        await addAuditLog('config:branding', 'branding', CONFIG_KEYS.CELEBRATE_ACHIEVEMENTS, config.celebrateAchievements, enabled, 'Celebrate achievements toggled');
    }, [config.celebrateAchievements]);

    const setCelebrateAnniversaries = useCallback(async (enabled: boolean) => {
        setConfig((prev) => ({ ...prev, celebrateAnniversaries: enabled }));
        await saveConfigToDB(CONFIG_KEYS.CELEBRATE_ANNIVERSARIES, String(enabled));
        await addAuditLog('config:branding', 'branding', CONFIG_KEYS.CELEBRATE_ANNIVERSARIES, config.celebrateAnniversaries, enabled, 'Celebrate anniversaries toggled');
    }, [config.celebrateAnniversaries]);

    const refresh = useCallback(async () => {
        const cfg = await loadConfigFromDB();
        setConfig(cfg);
        applyBranding(cfg);
    }, [applyBranding]);

    // ============================================================
    // Derived state
    // ============================================================

    const currentPalette = getPalette(config.activeSeason);

    return {
        config,
        currentEvent,
        currentPalette,
        isBirthday: isBirthdayState,
        celebrandoA,
        setMode,
        setActiveSeason,
        setBirthday,
        addCustomEvent,
        removeCustomEvent,
        setCelebrateAchievements,
        setCelebrateAnniversaries,
        refresh,
    };
}
