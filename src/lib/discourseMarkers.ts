// ============================================================
// Discourse Markers — Natural Language Fillers for FLU
// ============================================================
// Injects natural discourse markers into FLU's speech to make
// it sound more human and less robotic. Markers are selected
// based on the conversational context and FLU's personality.
//
// Cumple:
//   - Rule #1: NO HARDCODE — all markers configurable
//   - Pure functions — no React dependencies
// ============================================================

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export type DiscourseContext =
    | 'thinking'
    | 'agreeing'
    | 'disagreeing_gently'
    | 'adding'
    | 'synthesizing'
    | 'questioning'
    | 'clarifying'
    | 'acknowledging'
    | 'transitioning'
    | 'emphasizing';

export type PersonalityTone = 'formal' | 'casual' | 'friendly' | 'professional' | 'energetic' | 'calm';

// -----------------------------------------------------------
// Marker Dictionaries
// -----------------------------------------------------------

interface MarkerEntry {
    text: string;
    /** 0-1 how strong/emphatic this marker is */
    strength: number;
}

type MarkerDictionary = Record<DiscourseContext, MarkerEntry[]>;

const SPANISH_MARKERS: MarkerDictionary = {
    thinking: [
        { text: 'Mmm... déjame pensar...', strength: 0.3 },
        { text: 'Déjame ver...', strength: 0.2 },
        { text: 'A ver...', strength: 0.2 },
        { text: 'Mmm...', strength: 0.1 },
        { text: 'Bueno...', strength: 0.15 },
    ],
    agreeing: [
        { text: 'Exacto, ', strength: 0.4 },
        { text: 'Totalmente de acuerdo, ', strength: 0.5 },
        { text: 'Así es, ', strength: 0.3 },
        { text: 'Claro que sí, ', strength: 0.35 },
        { text: 'Tienes razón, ', strength: 0.3 },
        { text: 'Me parece bien, ', strength: 0.25 },
    ],
    disagreeing_gently: [
        { text: 'Entiendo tu punto, pero...', strength: 0.3 },
        { text: 'Respeto eso, aunque...', strength: 0.3 },
        { text: 'Buen punto, sin embargo...', strength: 0.35 },
        { text: 'Quizás, pero considera esto...', strength: 0.25 },
    ],
    adding: [
        { text: 'Además, ', strength: 0.3 },
        { text: 'También hay que considerar que ', strength: 0.35 },
        { text: 'Otro aspecto importante es que ', strength: 0.4 },
        { text: 'Sumado a eso, ', strength: 0.3 },
        { text: 'Y algo más...', strength: 0.25 },
    ],
    synthesizing: [
        { text: 'En resumen, ', strength: 0.5 },
        { text: 'Para resumir, ', strength: 0.45 },
        { text: 'En pocas palabras, ', strength: 0.4 },
        { text: 'Recapitulando, ', strength: 0.45 },
        { text: 'Lo que hemos visto hasta ahora es que ', strength: 0.5 },
    ],
    questioning: [
        { text: '¿Qué opinan sobre...?', strength: 0.4 },
        { text: '¿Alguien ha considerado...?', strength: 0.35 },
        { text: 'Me pregunto si...', strength: 0.3 },
        { text: '¿No creen que...?', strength: 0.3 },
    ],
    clarifying: [
        { text: 'O sea, ', strength: 0.2 },
        { text: 'En otras palabras, ', strength: 0.3 },
        { text: 'Déjame ver si entiendo...', strength: 0.25 },
        { text: 'Para aclarar, ', strength: 0.3 },
    ],
    acknowledging: [
        { text: 'Entendido.', strength: 0.2 },
        { text: 'Anotado.', strength: 0.2 },
        { text: 'Gracias por compartir.', strength: 0.3 },
        { text: 'Buen aporte.', strength: 0.25 },
    ],
    transitioning: [
        { text: 'Cambiando de tema, ', strength: 0.4 },
        { text: 'Pasando a otro punto, ', strength: 0.4 },
        { text: 'Ahora, sobre...', strength: 0.3 },
        { text: 'Relacionado con eso, ', strength: 0.3 },
    ],
    emphasizing: [
        { text: 'Es importante destacar que ', strength: 0.5 },
        { text: 'Cabe mencionar que ', strength: 0.4 },
        { text: 'No hay que olvidar que ', strength: 0.45 },
        { text: 'Sobre todo, ', strength: 0.35 },
    ],
};

const ENGLISH_MARKERS: MarkerDictionary = {
    thinking: [
        { text: 'Hmm... let me think...', strength: 0.3 },
        { text: 'Let me see...', strength: 0.2 },
        { text: 'Well...', strength: 0.15 },
        { text: 'Let me consider...', strength: 0.2 },
    ],
    agreeing: [
        { text: 'Exactly, ', strength: 0.4 },
        { text: 'Totally agree, ', strength: 0.5 },
        { text: 'That\'s right, ', strength: 0.3 },
        { text: 'Absolutely, ', strength: 0.35 },
        { text: 'You\'re right, ', strength: 0.3 },
        { text: 'Sounds good, ', strength: 0.25 },
    ],
    disagreeing_gently: [
        { text: 'I see your point, but...', strength: 0.3 },
        { text: 'I respect that, although...', strength: 0.3 },
        { text: 'Good point, however...', strength: 0.35 },
        { text: 'Maybe, but consider this...', strength: 0.25 },
    ],
    adding: [
        { text: 'Furthermore, ', strength: 0.3 },
        { text: 'Also, ', strength: 0.25 },
        { text: 'Another important aspect is that ', strength: 0.4 },
        { text: 'On top of that, ', strength: 0.3 },
        { text: 'And another thing...', strength: 0.25 },
    ],
    synthesizing: [
        { text: 'In summary, ', strength: 0.5 },
        { text: 'To sum up, ', strength: 0.45 },
        { text: 'In a nutshell, ', strength: 0.4 },
        { text: 'Recapping, ', strength: 0.45 },
        { text: 'What we\'ve seen so far is that ', strength: 0.5 },
    ],
    questioning: [
        { text: 'What do you think about...?', strength: 0.4 },
        { text: 'Has anyone considered...?', strength: 0.35 },
        { text: 'I wonder if...', strength: 0.3 },
        { text: 'Don\'t you think that...?', strength: 0.3 },
    ],
    clarifying: [
        { text: 'In other words, ', strength: 0.3 },
        { text: 'Let me see if I understand...', strength: 0.25 },
        { text: 'To clarify, ', strength: 0.3 },
        { text: 'So basically, ', strength: 0.2 },
    ],
    acknowledging: [
        { text: 'Got it.', strength: 0.2 },
        { text: 'Noted.', strength: 0.2 },
        { text: 'Thanks for sharing.', strength: 0.3 },
        { text: 'Good input.', strength: 0.25 },
    ],
    transitioning: [
        { text: 'Changing the subject, ', strength: 0.4 },
        { text: 'Moving on, ', strength: 0.4 },
        { text: 'Now, regarding...', strength: 0.3 },
        { text: 'Related to that, ', strength: 0.3 },
    ],
    emphasizing: [
        { text: 'It\'s important to note that ', strength: 0.5 },
        { text: 'Worth mentioning that ', strength: 0.4 },
        { text: 'Let\'s not forget that ', strength: 0.45 },
        { text: 'Above all, ', strength: 0.35 },
    ],
};

// -----------------------------------------------------------
// Tone-based filtering
// -----------------------------------------------------------

/**
 * Get markers appropriate for a given tone.
 * Formal/professional tones use lower-strength markers.
 * Energetic/casual tones use higher-strength markers.
 */
function filterMarkersByTone(markers: MarkerEntry[], tone: PersonalityTone): MarkerEntry[] {
    switch (tone) {
        case 'formal':
        case 'professional':
            return markers.filter((m) => m.strength <= 0.4);
        case 'casual':
        case 'friendly':
            return markers.filter((m) => m.strength >= 0.2);
        case 'energetic':
            return markers.filter((m) => m.strength >= 0.3);
        case 'calm':
            return markers.filter((m) => m.strength <= 0.35);
        default:
            return markers;
    }
}

// -----------------------------------------------------------
// Main API
// -----------------------------------------------------------

/**
 * Get a random discourse marker for the given context.
 */
export function getDiscourseMarker(
    context: DiscourseContext,
    language: 'es' | 'en' = 'es',
    tone: PersonalityTone = 'friendly',
): string {
    const dictionary = language === 'en' ? ENGLISH_MARKERS : SPANISH_MARKERS;
    const markers = dictionary[context];
    if (!markers || markers.length === 0) return '';

    const filtered = filterMarkersByTone(markers, tone);
    const pool = filtered.length > 0 ? filtered : markers;
    const index = Math.floor(Math.random() * pool.length);
    return pool[index].text;
}

/**
 * Prepend a discourse marker to text based on context.
 * Returns the text with an appropriate marker, or the original text if no marker fits.
 */
export function addDiscourseMarker(
    text: string,
    context: DiscourseContext,
    language: 'es' | 'en' = 'es',
    tone: PersonalityTone = 'friendly',
): string {
    if (!text) return text;
    const marker = getDiscourseMarker(context, language, tone);
    if (!marker) return text;

    // Don't add marker if text already starts with something similar
    const textLower = text.toLowerCase();
    const markerLower = marker.toLowerCase().replace(/[^a-záéíóúñü\s]/g, '');
    const markerStart = markerLower.split(' ').slice(0, 2).join(' ');
    if (markerStart && textLower.startsWith(markerStart)) {
        return text;
    }

    return marker + text;
}
