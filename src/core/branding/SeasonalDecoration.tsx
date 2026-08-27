// ============================================================
// SeasonalDecoration — Decoraciones visuales del avatar 3D
// ============================================================
// Lee el estado actual de branding (useSeasonalBranding) y
// aplica decoraciones visuales al avatar Bunny mediante
// el useBunnyStore (Zustand).
//
// Mapeo decoration → acción en el avatar:
//   santa-hat  → Bunny_cap visible + señal NONE
//   party-hat  → Bunny_cap visible + señal CELEBRATE
//   marigold   → Bunny_cap visible (flores) + señal NONE
//   flag       → Bunny_cap visible + señal HIGHLIGHT
//   crown      → Bunny_cap visible + señal HIGHLIGHT
//   sparkle    → Bunny_cap oculto + señal CELEBRATE
//   heart      → Bunny_cap visible + señal HIGHLIGHT
//   flower     → Bunny_cap visible + señal NONE
//   clover     → Bunny_cap visible + señal HIGHLIGHT
//   leaf       → Bunny_cap visible + señal NONE
//   sun        → Bunny_cap visible + señal NONE
//   pumpkin    → Bunny_cap visible + señal HIGHLIGHT
//   snowflake  → Bunny_cap visible + señal NONE
//   undefined  → Bunny_cap según estado base + señal NONE
//
// También reproduce animaciones especiales en eventos:
//   - Cumpleaños: animación Dance + señal CELEBRATE
//   - Año Nuevo: animación Jump_in_place + señal CELEBRATE
//   - San Valentín: animación Dance + señal HIGHLIGHT
//   - Navidad: animación Dance + señal CELEBRATE
//   - Halloween: animación Jump_in_place + señal HIGHLIGHT
// ============================================================

import { useEffect, useRef } from 'react';
import { useBunnyStore } from '../../avatar/store/bunnyStore';
import type { BunnyAnimation } from '../../avatar/types/bunny';
import { getPalette } from './seasonalPalettes';
import type { BrandingMode } from './useSeasonalBranding';

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export interface SeasonalDecorationProps {
    /** Modo de branding activo */
    mode: BrandingMode;
    /** Key de la paleta activa */
    activeSeason: string;
    /** Indica si hoy es cumpleaños del usuario */
    isBirthday: boolean;
    /** Nombre de la persona que cumple años (opcional) */
    celebrandoA?: string;
}

// -----------------------------------------------------------
// Mapeo decoration → acciones del avatar
// -----------------------------------------------------------

interface DecorationAction {
    capVisible: boolean;
    signal: 'NONE' | 'CELEBRATE' | 'HIGHLIGHT' | 'WAVE';
    animation?: BunnyAnimation;
}

const DECORATION_MAP: Record<string, DecorationAction> = {
    'santa-hat': {
        capVisible: true,
        signal: 'NONE',
    },
    'party-hat': {
        capVisible: true,
        signal: 'CELEBRATE',
    },
    marigold: {
        capVisible: true,
        signal: 'NONE',
    },
    flag: {
        capVisible: true,
        signal: 'HIGHLIGHT',
    },
    crown: {
        capVisible: true,
        signal: 'HIGHLIGHT',
    },
    sparkle: {
        capVisible: false,
        signal: 'CELEBRATE',
    },
    heart: {
        capVisible: true,
        signal: 'HIGHLIGHT',
    },
    flower: {
        capVisible: true,
        signal: 'NONE',
    },
    clover: {
        capVisible: true,
        signal: 'HIGHLIGHT',
    },
    leaf: {
        capVisible: true,
        signal: 'NONE',
    },
    sun: {
        capVisible: true,
        signal: 'NONE',
    },
    pumpkin: {
        capVisible: true,
        signal: 'HIGHLIGHT',
    },
    snowflake: {
        capVisible: true,
        signal: 'NONE',
    },
};

const DEFAULT_ACTION: DecorationAction = {
    capVisible: true,
    signal: 'NONE',
};

// -----------------------------------------------------------
// Eventos especiales que disparan animaciones
// -----------------------------------------------------------

const SPECIAL_EVENTS: Record<string, { animation: BunnyAnimation; signal: 'CELEBRATE' | 'HIGHLIGHT' }> = {
    cumpleanos: {
        animation: 'Dance',
        signal: 'CELEBRATE',
    },
    ano_nuevo: {
        animation: 'Jump_in_place',
        signal: 'CELEBRATE',
    },
    navidad: {
        animation: 'Dance',
        signal: 'CELEBRATE',
    },
    san_valentin: {
        animation: 'Dance',
        signal: 'HIGHLIGHT',
    },
    halloween: {
        animation: 'Jump_in_place',
        signal: 'HIGHLIGHT',
    },
};

// -----------------------------------------------------------
// Componente
// -----------------------------------------------------------

export function SeasonalDecoration({
    mode,
    activeSeason,
    isBirthday,
    celebrandoA,
}: SeasonalDecorationProps) {
    const prevSeasonRef = useRef<string | null>(null);
    const prevBirthdayRef = useRef(false);

    useEffect(() => {
        if (mode === 'disabled') {
            // Modo disabled: restaurar estado base del avatar
            const store = useBunnyStore.getState();
            store.setComponentVisibility('Bunny_cap', true);
            store.setSignal('NONE');
            store.setDecoration(null);
            prevSeasonRef.current = null;
            prevBirthdayRef.current = false;
            return;
        }

        const palette = getPalette(activeSeason);
        const decoration = palette.decoration;
        const action = decoration ? DECORATION_MAP[decoration] : DEFAULT_ACTION;

        const store = useBunnyStore.getState();

        // 1. Aplicar visibilidad del cap según decoración
        store.setComponentVisibility('Bunny_cap', action.capVisible);

        // 2. Aplicar señal visual
        store.setSignal(action.signal);

        // 3. Aplicar decoración 3D (catálogo) anclada a la cabeza
        store.setDecoration(decoration ?? null);

        // 3. Eventos especiales (solo al activarse, no en cada render)
        const seasonChanged = prevSeasonRef.current !== activeSeason;
        const birthdayJustActivated = isBirthday && !prevBirthdayRef.current;

        if (seasonChanged) {
            const specialEvent = SPECIAL_EVENTS[activeSeason];
            if (specialEvent) {
                store.playAnimation(specialEvent.animation);
                store.setSignal(specialEvent.signal);
            }
        }

        if (birthdayJustActivated && isBirthday) {
            // Reproducir animación de celebración por cumpleaños
            store.playAnimation('Dance');
            store.setSignal('CELEBRATE');

            // Log opcional
            if (celebrandoA) {
                console.log(`[SeasonalDecoration] 🎂 Celebrando cumpleaños de ${celebrandoA}`);
            }
        }

        // Actualizar refs
        prevSeasonRef.current = activeSeason;
        prevBirthdayRef.current = isBirthday;
    }, [mode, activeSeason, isBirthday, celebrandoA]);

    // Este componente no renderiza nada visual directamente
    return null;
}
