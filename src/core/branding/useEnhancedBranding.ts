// ============================================================
// FLU OS4 — useEnhancedBranding Hook
// ============================================================
// Combina branding estacional con selección de IA ecológica
// 
// Características:
// 1. Branding estacional automático (calendario SEP + cumpleaños)
// 2. Branding ecológico cuando se usa DeepSeek (IA sostenible)
// 3. Mantiene pizarrón verde como elemento visual central
// 4. Resalta beneficios ecológicos: 72% más barato, 2-3x más rápido, 60% menos CO₂
// ============================================================

import { useCallback, useEffect, useMemo } from 'react';
import { useSeasonalBranding, type SeasonalBrandingState } from './useSeasonalBranding';
import { getPalette, applyPaletteToCSS, toggleBrandingClass } from './seasonalPalettes';
import { getPreferredAIProvider, type AIProvider } from '../../services/aiServiceFactory';

// ============================================================
// Types
// ============================================================

export interface EnhancedBrandingState extends SeasonalBrandingState {
    /** Proveedor de IA actual */
    aiProvider: AIProvider;
    /** ¿Está aplicado el branding ecológico? */
    isEcologicalBranding: boolean;
    /** Estadísticas ecológicas */
    ecologicalStats: {
        costSavings: string;      // "72% más barato"
        speedImprovement: string; // "2-3x más rápido"
        co2Reduction: string;     // "60% menos CO₂"
    };
}

export interface EnhancedBrandingActions {
    /** Acciones del branding estacional */
    seasonalActions: ReturnType<typeof useSeasonalBranding>;
    /** Forzar aplicación de branding ecológico */
    applyEcologicalBranding: () => void;
    /** Restaurar branding estacional */
    restoreSeasonalBranding: () => void;
}

// ============================================================
// Hook Principal
// ============================================================

export function useEnhancedBranding(): EnhancedBrandingState & EnhancedBrandingActions {
    // 1. Branding estacional base
    const seasonalBranding = useSeasonalBranding();
    
    // 2. Detectar proveedor de IA
    const aiProvider = getPreferredAIProvider();
    
    // 3. Determinar si aplicar branding ecológico
    const isEcologicalBranding = useMemo(() => {
        // Aplicar branding ecológico SOLO en modo automático (sin elección explícita del usuario).
        // Regla anti-ruta-doble: si el usuario eligió una temporada manualmente
        // (brandingActiveSeason fuerza mode='manual'), su elección SIEMPRE gana
        // y el override ecológico no la pisa.
        // 1. El proveedor es OpenRouter (Gemini 2.5 Flash Lite) o DeepSeek legacy
        // 2. El modo de branding es "auto" (default de fábrica → conserva el eco por defecto)
        // 3. No hay una temporada especial activa (navidad, halloween, etc.)
        const specialSeasons = ['navidad', 'halloween', 'muertos', 'patrio', 'infantil'];
        const isSpecialSeason = specialSeasons.includes(seasonalBranding.config.activeSeason);
        
        return (aiProvider === 'openrouter' || aiProvider === 'deepseek') &&
               seasonalBranding.config.mode === 'auto' &&
               !isSpecialSeason;
    }, [aiProvider, seasonalBranding.config.mode, seasonalBranding.config.activeSeason]);
    
    // 4. Estadísticas ecológicas
    const ecologicalStats = useMemo(() => ({
        costSavings: '72% más barato',
        speedImprovement: '2-3x más rápido',
        co2Reduction: '60% menos CO₂'
    }), []);
    
    // 5. Aplicar paleta según el branding
    useEffect(() => {
        if (isEcologicalBranding) {
            // Aplicar paleta ecológica
            const ecologicalPalette = getPalette('ecologico');
            applyPaletteToCSS(ecologicalPalette);
            
            // Añadir clase CSS adicional para branding ecológico (solo en el área de FLU)
            toggleBrandingClass('branding-ecologico', true);
        } else {
            // Remover clase ecológica
            toggleBrandingClass('branding-ecologico', false);
            
            // Dejar que el branding estacional maneje la paleta
            // (ya se aplica automáticamente en useSeasonalBranding)
        }
        
        return () => {
            toggleBrandingClass('branding-ecologico', false);
        };
    }, [isEcologicalBranding]);
    
    // 6. Acciones
    const applyEcologicalBranding = useCallback(() => {
        const ecologicalPalette = getPalette('ecologico');
        applyPaletteToCSS(ecologicalPalette);
        toggleBrandingClass('branding-ecologico', true);
    }, []);
    
    const restoreSeasonalBranding = useCallback(() => {
        toggleBrandingClass('branding-ecologico', false);
        // El branding estacional se restaurará automáticamente
        // en el próximo ciclo de renderizado
    }, []);
    
    // 7. Estado combinado
    const enhancedState: EnhancedBrandingState = {
        ...seasonalBranding,
        aiProvider,
        isEcologicalBranding,
        ecologicalStats,
    };
    
    const enhancedActions: EnhancedBrandingActions = {
        seasonalActions: seasonalBranding,
        applyEcologicalBranding,
        restoreSeasonalBranding,
    };
    
    return {
        ...enhancedState,
        ...enhancedActions,
    };
}

// ============================================================
// Helper: Obtener mensaje de branding ecológico
// ============================================================

export function getEcologicalBrandingMessage(language: 'es' | 'en' = 'es'): string {
    if (language === 'en') {
        return '🌱 Using DeepSeek: 72% cheaper, 2-3x faster, 60% less CO₂ emissions';
    }
    return '🌱 Usando DeepSeek: 72% más barato, 2-3x más rápido, 60% menos emisiones de CO₂';
}

// ============================================================
// Helper: Verificar si el pizarrón verde está activo
// ============================================================

export function isGreenBoardActive(): boolean {
    // El pizarrón verde siempre está activo en el tab de workspace
    // Verificamos si el elemento existe en el DOM
    const workspaceTab = document.querySelector('.flu-tab-panel--workspace');
    return workspaceTab !== null;
}