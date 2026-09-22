import { logCaughtError } from '../../lib/caughtError';

// ============================================================
// FLU OS4 — Calendario General de Temporalidades (Branding Inteligente)
// ============================================================
// Propósito: Detectar la temporada activa según:
//   - Calendario general con festividades globales + estaciones del año
//   - Cumpleaños del usuario (desde perfil)
//   - Eventos personalizados (configurados por voz o UI)
//   - Logros/Materia Gris (hitos del usuario)
//
// Prioridad: CustomEvent > Birthday > Achievement > General Calendar > Default
// ============================================================

export interface SeasonalEvent {
    id: string;
    name: string;
    type: 'general_holiday' | 'season' | 'birthday' | 'custom' | 'achievement';
    /** MM-DD sin año (evento anual) */
    month: number;  // 1-12
    day: number;    // 1-31
    /** Key de la paleta en seasonalPalettes.ts */
    palette: string;
    /** Decoración opcional para el avatar 3D */
    decoration?: string;
    /** Prioridad: 0=default, 1=general, 2=achievement, 3=birthday, 4=custom */
    priority: number;
    /** Mensaje de bienvenida opcional para la temporada */
    welcomeMessage?: string;
}

export interface CustomEvent {
    id: string;
    name: string;
    /** MM-DD */
    month: number;
    day: number;
    palette: string;
    decoration?: string;
    welcomeMessage?: string;
}

// ============================================================
// Calendario General Global — Festividades + Estaciones
// ============================================================
// Incluye festividades internacionales y estaciones del hemisferio norte.
// El usuario puede complementar con cumpleaños y eventos personalizados.
// ============================================================
export const GENERAL_CALENDAR: SeasonalEvent[] = [
    // -------------------------------------------------------
    // Enero — Año Nuevo
    // -------------------------------------------------------
    {
        id: 'ano_nuevo',
        name: 'Año Nuevo',
        type: 'general_holiday',
        month: 1, day: 1,
        palette: 'ano_nuevo',
        decoration: 'sparkle',
        priority: 1,
        welcomeMessage: '¡Feliz Año Nuevo! 🎉',
    },
    {
        id: 'reyes_magos',
        name: 'Día de Reyes Magos',
        type: 'general_holiday',
        month: 1, day: 6,
        palette: 'reyes',
        decoration: 'crown',
        priority: 1,
        welcomeMessage: '¡Feliz Día de Reyes! 👑',
    },

    // -------------------------------------------------------
    // Febrero — Amor, invierno
    // -------------------------------------------------------
    {
        id: 'san_valentin',
        name: 'San Valentín',
        type: 'general_holiday',
        month: 2, day: 14,
        palette: 'san_valentin',
        decoration: 'heart',
        priority: 1,
        welcomeMessage: '¡Feliz San Valentín! ❤️',
    },

    // -------------------------------------------------------
    // Marzo — Primavera, San Patricio
    // -------------------------------------------------------
    {
        id: 'primavera',
        name: 'Equinoccio de Primavera',
        type: 'season',
        month: 3, day: 20,
        palette: 'primavera',
        decoration: 'flower',
        priority: 1,
        welcomeMessage: '¡Llegó la Primavera! 🌸',
    },
    {
        id: 'san_patricio',
        name: 'Día de San Patricio',
        type: 'general_holiday',
        month: 3, day: 17,
        palette: 'san_patricio',
        decoration: 'clover',
        priority: 1,
        welcomeMessage: '¡Feliz Día de San Patricio! 🍀',
    },

    // -------------------------------------------------------
    // Abril — Día de la Tierra, humor
    // -------------------------------------------------------
    {
        id: 'dia_tontos',
        name: 'April Fools / Día de los Inocentes',
        type: 'general_holiday',
        month: 4, day: 1,
        palette: 'infantil',
        decoration: 'party-hat',
        priority: 1,
        welcomeMessage: '¡No te dejes engañar! 😄',
    },
    {
        id: 'dia_tierra',
        name: 'Día de la Tierra',
        type: 'general_holiday',
        month: 4, day: 22,
        palette: 'tierra',
        decoration: 'leaf',
        priority: 1,
        welcomeMessage: '¡Cuida nuestro planeta! 🌍',
    },

    // -------------------------------------------------------
    // Mayo — Flores, trabajo
    // -------------------------------------------------------
    {
        id: 'dia_trabajo',
        name: 'Día del Trabajo',
        type: 'general_holiday',
        month: 5, day: 1,
        palette: 'trabajo',
        priority: 1,
        welcomeMessage: '¡Feliz Día del Trabajo! 💪',
    },
    {
        id: 'dia_madres',
        name: 'Día de las Madres',
        type: 'general_holiday',
        month: 5, day: 10,
        palette: 'madres',
        decoration: 'flower',
        priority: 1,
        welcomeMessage: '¡Feliz Día de las Madres! 🌷',
    },

    // -------------------------------------------------------
    // Junio — Verano, padres
    // -------------------------------------------------------
    {
        id: 'verano',
        name: 'Solsticio de Verano',
        type: 'season',
        month: 6, day: 21,
        palette: 'verano',
        decoration: 'sun',
        priority: 1,
        welcomeMessage: '¡Bienvenido Verano! ☀️',
    },
    {
        id: 'dia_padres',
        name: 'Día del Padre',
        type: 'general_holiday',
        month: 6, day: 16,  // 3er domingo de junio, usamos fecha aproximada
        palette: 'padres',
        priority: 1,
        welcomeMessage: '¡Feliz Día del Padre! 👔',
    },

    // -------------------------------------------------------
    // Julio — Verano (continúa), independencia USA
    // -------------------------------------------------------
    {
        id: 'independencia_usa',
        name: '4 de Julio (Independencia EE.UU.)',
        type: 'general_holiday',
        month: 7, day: 4,
        palette: 'patrio',
        decoration: 'flag',
        priority: 1,
        welcomeMessage: '¡Feliz 4 de Julio! 🎆',
    },

    // -------------------------------------------------------
    // Agosto — Verano (continúa)
    // -------------------------------------------------------

    // -------------------------------------------------------
    // Septiembre — Otoño
    // -------------------------------------------------------
    {
        id: 'otono',
        name: 'Equinoccio de Otoño',
        type: 'season',
        month: 9, day: 22,
        palette: 'otono',
        decoration: 'leaf',
        priority: 1,
        welcomeMessage: '¡Bienvenido Otoño! 🍂',
    },

    // -------------------------------------------------------
    // Octubre — Halloween
    // -------------------------------------------------------
    {
        id: 'halloween',
        name: 'Halloween / Noche de Brujas',
        type: 'general_holiday',
        month: 10, day: 31,
        palette: 'halloween',
        decoration: 'pumpkin',
        priority: 1,
        welcomeMessage: '¡Feliz Halloween! 🎃',
    },

    // -------------------------------------------------------
    // Noviembre — Día de Muertos, Acción de Gracias
    // -------------------------------------------------------
    {
        id: 'dia_muertos',
        name: 'Día de Muertos',
        type: 'general_holiday',
        month: 11, day: 2,
        palette: 'muertos',
        decoration: 'marigold',
        priority: 1,
        welcomeMessage: 'Día de Muertos — tradición y memoria 💀',
    },
    {
        id: 'accion_gracias',
        name: 'Thanksgiving / Acción de Gracias',
        type: 'general_holiday',
        month: 11, day: 28,  // 4to jueves de noviembre, fecha aproximada
        palette: 'otono',
        decoration: 'leaf',
        priority: 1,
        welcomeMessage: '¡Feliz Día de Acción de Gracias! 🦃',
    },

    // -------------------------------------------------------
    // Diciembre — Invierno, Navidad, Fin de año
    // -------------------------------------------------------
    {
        id: 'invierno',
        name: 'Solsticio de Invierno',
        type: 'season',
        month: 12, day: 21,
        palette: 'invierno',
        decoration: 'snowflake',
        priority: 1,
        welcomeMessage: '¡Bienvenido Invierno! ❄️',
    },
    {
        id: 'navidad',
        name: 'Navidad',
        type: 'general_holiday',
        month: 12, day: 25,
        palette: 'navidad',
        decoration: 'santa-hat',
        priority: 1,
        welcomeMessage: '¡Feliz Navidad! 🎄',
    },
    {
        id: 'fin_ano',
        name: 'Fin de Año',
        type: 'general_holiday',
        month: 12, day: 31,
        palette: 'ano_nuevo',
        decoration: 'sparkle',
        priority: 1,
        welcomeMessage: '¡Feliz Fin de Año! 🎆',
    },
];

// ============================================================
// Detectar temporada activa
// ============================================================

export interface SeasonResult {
    event: SeasonalEvent;
    isBirthday: boolean;
    celebrandoA?: string;
}

/**
 * Obtiene la temporada activa según la fecha actual y los eventos configurados.
 * Sigue la jerarquía de prioridad: CustomEvent > Birthday > Achievement > General Calendar > Default
 */
export function getActiveSeason(
    userBirthday?: string | null,
    customEvents?: CustomEvent[],
    _celebrateAchievements?: boolean,
): SeasonResult {
    const now = new Date();
    const todayMonth = now.getMonth() + 1; // 1-12
    const todayDay = now.getDate();         // 1-31

    // 1. Custom events (highest priority: 4)
    if (customEvents && customEvents.length > 0) {
        for (const custom of customEvents) {
            if (custom.month === todayMonth && custom.day === todayDay) {
                return {
                    event: {
                        id: custom.id,
                        name: custom.name,
                        type: 'custom',
                        month: todayMonth,
                        day: todayDay,
                        palette: custom.palette,
                        decoration: custom.decoration,
                        priority: 4,
                        welcomeMessage: custom.welcomeMessage,
                    },
                    isBirthday: false,
                };
            }
        }
    }

    // 2. Birthday (priority: 3)
    if (userBirthday) {
        try {
            const bday = new Date(userBirthday);
            if (!isNaN(bday.getTime())) {
                const bdayMonth = bday.getMonth() + 1;
                const bdayDay = bday.getDate();
                if (bdayMonth === todayMonth && bdayDay === todayDay) {
                    return {
                        event: {
                            id: 'cumpleanos',
                            name: '¡Cumpleaños!',
                            type: 'birthday',
                            month: todayMonth,
                            day: todayDay,
                            palette: 'cumpleanos',
                            decoration: 'party-hat',
                            priority: 3,
                            welcomeMessage: '¡Feliz Cumpleaños! 🎂',
                        },
                        isBirthday: true,
                    };
                }
            }
        } catch {
        logCaughtError('[catch] src/core/branding/seasonalCalendar.ts');
            // Invalid date, skip birthday detection
        }
    }

    // 3. General calendar holidays & seasons (priority: 1)
    for (const holiday of GENERAL_CALENDAR) {
        if (holiday.month === todayMonth && holiday.day === todayDay) {
            return {
                event: holiday,
                isBirthday: false,
            };
        }
    }

    // 4. Default (priority: 0)
    return {
        event: {
            id: 'default',
            name: 'Default',
            type: 'general_holiday',
            month: todayMonth,
            day: todayDay,
            palette: 'default',
            priority: 0,
        },
        isBirthday: false,
    };
}

/**
 * Verifica si dos fechas (MM-DD) son iguales.
 */
export function isSameDay(month1: number, day1: number, month2: number, day2: number): boolean {
    return month1 === month2 && day1 === day2;
}

/**
 * Obtiene el nombre del mes en español.
 */
export function getMonthName(month: number): string {
    const names = [
        'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
    ];
    return names[month - 1] || 'desconocido';
}
