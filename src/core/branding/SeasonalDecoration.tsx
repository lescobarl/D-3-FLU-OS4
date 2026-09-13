// ============================================================
// SeasonalDecoration — Decoraciones visuales del avatar 3D
// ============================================================
// Lee el estado actual de branding (useSeasonalBranding) y
// aplica decoraciones visuales al avatar Bunny mediante
// el useBunnyStore (Zustand).
//
// IMPORTANTE (arquitectura): la visibilidad de la gorra (Bunny_cap) y del
// pelo (Bunny_bangs) la controla ÚNICAMENTE el perfil activo a través de
// useAvatarVoiceSync (imageConfig.capVisible / hairVisible). Este componente
// NO toca la visibilidad de componentes del avatar: solo gestiona la
// decoración 3D (setDecoration → DecorationsRenderer) y las señales /
// animaciones de celebración, que son mecanismos independientes y temporales.
//
// Mapeo decoration → señal en el avatar:
//   santa-hat  → señal NONE
//   party-hat  → señal CELEBRATE
//   marigold   → señal NONE
//   flag       → señal HIGHLIGHT
//   crown      → señal HIGHLIGHT
//   sparkle    → señal CELEBRATE
//   heart      → señal HIGHLIGHT
//   flower     → señal NONE
//   clover     → señal HIGHLIGHT
//   leaf       → señal NONE
//   sun        → señal NONE
//   pumpkin    → señal HIGHLIGHT
//   snowflake  → señal NONE
//   undefined  → señal NONE
//
// Precedencia ambiente > temporada: cuando el ambiente activo (rebranding
// por oficio) define una decoración, esa decoración controla la decoración
// 3D y la paleta estacional solo aporta su tema.
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
    /** Decoración del ambiente activo (rebranding por oficio) — precedencia sobre la estacional */
    environmentDecoration?: string | null;
}

// -----------------------------------------------------------
// Mapeo decoration → acciones del avatar
// -----------------------------------------------------------

interface DecorationAction {
    signal: 'NONE' | 'CELEBRATE' | 'HIGHLIGHT' | 'WAVE';
    animation?: BunnyAnimation;
}

const DECORATION_MAP: Record<string, DecorationAction> = {
    'santa-hat': {
        signal: 'NONE',
    },
    'party-hat': {
        signal: 'CELEBRATE',
    },
    marigold: {
        signal: 'NONE',
    },
    flag: {
        signal: 'HIGHLIGHT',
    },
    crown: {
        signal: 'HIGHLIGHT',
    },
    sparkle: {
        signal: 'CELEBRATE',
    },
    heart: {
        signal: 'HIGHLIGHT',
    },
    flower: {
        signal: 'NONE',
    },
    clover: {
        signal: 'HIGHLIGHT',
    },
    leaf: {
        signal: 'NONE',
    },
    sun: {
        signal: 'NONE',
    },
    pumpkin: {
        signal: 'HIGHLIGHT',
    },
    snowflake: {
        signal: 'NONE',
    },
};

const DEFAULT_ACTION: DecorationAction = {
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
    environmentDecoration,
}: SeasonalDecorationProps) {
    const prevSeasonRef = useRef<string | null>(null);
    const prevBirthdayRef = useRef(false);

    useEffect(() => {
        // Precedencia ambiente > temporada: la decoración del ambiente activo
        // controla la decoración 3D; la paleta estacional solo aporta su tema.
        // NOTA: la visibilidad de la gorra (Bunny_cap) y el pelo (Bunny_bangs)
        // la controla ÚNICAMENTE el perfil activo vía useAvatarVoiceSync.
        const environmentDecorationResolved =
            environmentDecoration && DECORATION_MAP[environmentDecoration] !== undefined
                ? environmentDecoration
                : null;

        const store = useBunnyStore.getState();

        if (mode === 'disabled' && !environmentDecorationResolved) {
            // Modo disabled sin decoración de ambiente: restaurar el estado base
            // de la decoración 3D y la señal. La gorra la sigue controlando el perfil.
            store.setSignal('NONE');
            store.setDecoration(null);
            prevSeasonRef.current = null;
            prevBirthdayRef.current = false;
            return;
        }

        const palette = getPalette(activeSeason);

        // La decoración del ambiente gana sobre la estacional para la decoración 3D.
        const decoration = environmentDecorationResolved
            ? environmentDecorationResolved
            : palette.decoration;
        const action = decoration ? DECORATION_MAP[decoration] : DEFAULT_ACTION;

        // 1. Aplicar señal visual
        store.setSignal(action.signal);

        // 2. Aplicar decoración 3D (catálogo) anclada a la cabeza
        store.setDecoration(decoration ?? null);

        // 3. Eventos especiales estacionales (solo con branding activo y al activarse)
        const seasonChanged = prevSeasonRef.current !== activeSeason;
        const birthdayJustActivated = isBirthday && !prevBirthdayRef.current;

        if (mode !== 'disabled' && seasonChanged) {
            const specialEvent = SPECIAL_EVENTS[activeSeason];
            if (specialEvent) {
                store.playAnimation(specialEvent.animation);
                store.setSignal(specialEvent.signal);
            }
        }

        if (mode !== 'disabled' && birthdayJustActivated && isBirthday) {
            // Reproducir animación de celebración por cumpleaños
            store.playAnimation('Dance');
            store.setSignal('CELEBRATE');

            // Log opcional
            if (celebrandoA) {
            }
        }

        // Actualizar refs
        prevSeasonRef.current = activeSeason;
        prevBirthdayRef.current = isBirthday;
    }, [mode, activeSeason, isBirthday, celebrandoA, environmentDecoration]);

    // Este componente no renderiza nada visual directamente
    return null;
}
