// ============================================================
// useCatalogsSettings — Hook de dominio "ajustes · catálogos".
// ------------------------------------------------------------
// Encapsula el espejo React de los catálogos dinámicos de
// ambientes (A5) y paletas de temporada (B4) usados en el panel
// de Ajustes: estado local, ids dinámicos, hidratación al arranque
// y handlers de CRUD/activación. Extraído de App() (Fase 2) sin
// cambiar el comportamiento observable.
//
// Orquesta únicamente estado/efectos; la lógica de negocio vive en
// src/core/environments/* y src/core/branding/*.
// ============================================================
import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react';
import type { useEnhancedBranding } from '../core/branding/useEnhancedBranding';
import {
    ENVIRONMENTS,
    getAmbientes,
    isAmbienteId,
    type EnvironmentDefinition,
} from '../core/environments/environmentRegistry';
import {
    hydrateAmbientes,
    registerAmbiente,
    removeAmbiente,
    updateAmbiente,
} from '../core/environments/ambientesCatalog';
import { applyEnvironment, resetEnvironment } from '../core/environments/applyEnvironment';
import { useEnvironmentStore, readPersistedActiveAmbienteId } from '../store/environmentStore';
import {
    hydratePalettes,
    registerPaleta,
    removePaleta,
    updatePaleta,
} from '../core/branding/paletasCatalog';
import {
    builtinPaletteEntries,
    getAllPalettes,
    type PaletteDefinition,
} from '../core/branding/seasonalPalettes';
import type { RegisterResult, UpdateResult } from '../core/catalogs/catalogRegistry';
import { logCaughtError } from '../lib/caughtError';

/** Dependencias externas que el hook necesita para activar/rebrandear. */
export interface CatalogsSettingsDeps {
    /** Id del ambiente activo (useEnvironmentStore). */
    activeAmbienteId: string;
    /** Ref del idioma actual (para la bienvenida hablada del ambiente). */
    languageRef: MutableRefObject<string>;
    /** Ref de speakFlu (para anunciar la bienvenida del ambiente). */
    speakFluRef: MutableRefObject<(text: string, lang: string) => Promise<void>>;
    /** Branding Inteligente por Temporalidad (activación/renombre de paletas). */
    branding: ReturnType<typeof useEnhancedBranding>;
}

export interface CatalogsSettings {
    /** Catálogo de ambientes (built-ins + dinámicos). */
    ambientes: readonly EnvironmentDefinition[];
    /** Ids de ambientes dinámicos (editables/borrables). */
    dynamicAmbienteIds: ReadonlySet<string>;
    /** Catálogo de paletas (built-ins + dinámicas). */
    paletas: readonly PaletteDefinition[];
    /** Ids de paletas dinámicas (editables/borrables). */
    dynamicPaletaIds: ReadonlySet<string>;
    /** Activa un ambiente desde el panel (applyEnvironment + bienvenida). */
    handleActivateAmbiente: (ambienteId: string) => Promise<void>;
    /** Registra un ambiente dinámico nuevo. */
    handleRegisterAmbiente: (
        data: EnvironmentDefinition
    ) => Promise<RegisterResult<EnvironmentDefinition>>;
    /** Actualiza un ambiente dinámico (reactiva si era el activo y se renombró). */
    handleUpdateAmbiente: (
        id: string,
        data: EnvironmentDefinition
    ) => Promise<UpdateResult<EnvironmentDefinition>>;
    /** Elimina un ambiente dinámico (resetea si era el activo). */
    handleRemoveAmbiente: (id: string) => Promise<void>;
    /** Activa una temporada desde el panel (setMode manual + setActiveSeason). */
    handleActivatePaleta: (paletaId: string) => Promise<void>;
    /** Registra una paleta dinámica nueva. */
    handleRegisterPaleta: (
        data: PaletteDefinition
    ) => Promise<RegisterResult<PaletteDefinition>>;
    /** Actualiza una paleta dinámica (reactiva si era la activa y se renombró). */
    handleUpdatePaleta: (
        id: string,
        data: PaletteDefinition
    ) => Promise<UpdateResult<PaletteDefinition>>;
    /** Elimina una paleta dinámica. */
    handleRemovePaleta: (id: string) => Promise<void>;
}

/**
 * Espejo React + CRUD de los catálogos de ambientes y paletas del
 * panel de Ajustes. Sin lógica de negocio: delega en core/* y solo
 * refresca el estado local tras cada operación.
 */
export function useCatalogsSettings({
    activeAmbienteId,
    languageRef,
    speakFluRef,
    branding,
}: CatalogsSettingsDeps): CatalogsSettings {
    // ---- 1A: catálogo dinámico de ambientes (A5) ----
    const [ambientes, setAmbientes] = useState<readonly EnvironmentDefinition[]>(() =>
        getAmbientes()
    );
    const refreshAmbientes = useCallback(() => {
        setAmbientes(getAmbientes());
    }, []);
    const dynamicAmbienteIds = useMemo(
        () =>
            new Set(
                ambientes
                    .filter((a) => !ENVIRONMENTS.some((b) => b.id === a.id))
                    .map((a) => a.id)
            ),
        [ambientes]
    );

    // ---- 1B: catálogo dinámico de paletas (B4) ----
    const [paletas, setPaletas] = useState<readonly PaletteDefinition[]>(() => getAllPalettes());
    const refreshPaletas = useCallback(() => {
        setPaletas(getAllPalettes());
    }, []);
    const dynamicPaletaIds = useMemo(
        () =>
            new Set(
                paletas
                    .filter((p) => !builtinPaletteEntries().some((b) => b.id === p.id))
                    .map((p) => p.id)
            ),
        [paletas]
    );

    // ---- Hidrata los catálogos dinámicos al arranque. El merge del store
    // corrige ids inválidos a 'asistente'; aquí se restaura un ambiente
    // dinámico ya hidratado y se refrescan las paletas. ----
    useEffect(() => {
        let active = true;
        (async () => {
            try {
                await hydrateAmbientes();
                await hydratePalettes();
                if (!active) return;
                refreshAmbientes();
                refreshPaletas();
                const persistedId = readPersistedActiveAmbienteId();
                const currentId = useEnvironmentStore.getState().activeAmbienteId;
                if (persistedId && persistedId !== currentId && isAmbienteId(persistedId)) {
                    applyEnvironment(persistedId);
                }
            } catch (err) {
                logCaughtError('[App] hydrate catalogs failed (non-critical)', err);
            }
        })();
        return () => {
            active = false;
        };
    }, [refreshAmbientes, refreshPaletas]);

    // ---- Ambientes (B5): activación desde el panel de Ajustes ----
    const handleActivateAmbiente = useCallback(
        async (ambienteId: string) => {
            try {
                const ambiente = applyEnvironment(ambienteId);
                const envLang = languageRef.current === 'en' ? 'en' : 'es';
                await speakFluRef.current?.(ambiente.bienvenida[envLang], envLang);
            } catch (err) {
                logCaughtError('[App] applyEnvironment failed (non-critical)', err);
            }
        },
        [languageRef, speakFluRef]
    );

    // ---- 1A: CRUD de ambientes dinámicos (delegado a ambientesCatalog) ----
    const handleRegisterAmbiente = useCallback(
        async (data: EnvironmentDefinition): Promise<RegisterResult<EnvironmentDefinition>> => {
            const result = await registerAmbiente(data);
            refreshAmbientes();
            return result;
        },
        [refreshAmbientes]
    );

    const handleUpdateAmbiente = useCallback(
        async (
            id: string,
            data: EnvironmentDefinition
        ): Promise<UpdateResult<EnvironmentDefinition>> => {
            const result = await updateAmbiente(id, data);
            if (result.ok && activeAmbienteId === id && result.record.data.id !== id) {
                // El ambiente activo fue renombrado: su slug (id canónico) cambió → reactivar.
                applyEnvironment(result.record.data.id);
            }
            refreshAmbientes();
            return result;
        },
        [refreshAmbientes, activeAmbienteId]
    );

    const handleRemoveAmbiente = useCallback(
        async (id: string): Promise<void> => {
            const wasActive = activeAmbienteId === id;
            if (wasActive) resetEnvironment();
            await removeAmbiente(id);
            refreshAmbientes();
        },
        [refreshAmbientes, activeAmbienteId]
    );

    // ---- 1B: CRUD de paletas dinámicas (delegado a paletasCatalog) ----
    const handleRegisterPaleta = useCallback(
        async (data: PaletteDefinition): Promise<RegisterResult<PaletteDefinition>> => {
            const result = await registerPaleta(data);
            refreshPaletas();
            return result;
        },
        [refreshPaletas]
    );

    const handleUpdatePaleta = useCallback(
        async (
            id: string,
            data: PaletteDefinition
        ): Promise<UpdateResult<PaletteDefinition>> => {
            const result = await updatePaleta(id, data);
            if (
                result.ok &&
                branding.config.activeSeason === id &&
                result.record.data.id !== id
            ) {
                // La temporada activa fue renombrada: su slug (id canónico) cambió → reactivar.
                await branding.seasonalActions.setMode('manual');
                await branding.seasonalActions.setActiveSeason(result.record.data.id);
            }
            refreshPaletas();
            return result;
        },
        [refreshPaletas, branding]
    );

    const handleRemovePaleta = useCallback(
        async (id: string): Promise<void> => {
            await removePaleta(id);
            refreshPaletas();
        },
        [refreshPaletas]
    );

    // Activa una temporada desde el panel (mismo patrón que el handler de voz).
    const handleActivatePaleta = useCallback(
        async (paletaId: string) => {
            await branding.seasonalActions.setMode('manual');
            await branding.seasonalActions.setActiveSeason(paletaId);
        },
        [branding]
    );

    return {
        ambientes,
        dynamicAmbienteIds,
        paletas,
        dynamicPaletaIds,
        handleActivateAmbiente,
        handleRegisterAmbiente,
        handleUpdateAmbiente,
        handleRemoveAmbiente,
        handleActivatePaleta,
        handleRegisterPaleta,
        handleUpdatePaleta,
        handleRemovePaleta,
    };
}
