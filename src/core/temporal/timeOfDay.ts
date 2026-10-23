// ============================================================
// timeOfDay — selector ÚNICO de hora del día (es/en)
// ------------------------------------------------------------
// Una sola regla para TODO lo que lee hora del habla (temporal, horario,
// recordatorios): si hay varias horas, gana la que trae meridiem explícito
// (am/pm) — y entre esas, la última (corrección del usuario); si no hay
// meridiem, la más temprana. Se reconocen horas sueltas con am/pm ("10 p.m")
// y mediodía/medianoche no pisan una hora explícita.
// Devuelve `timeOfDay` en 'HH:MM' (24h) y el texto SIN las horas (`rest`).
// ============================================================

import { resolveSpokenNumber, spokenNumberAlternation } from '../../lib/spokenNumbers.ts';

export interface PickedTimeOfDay {
    timeOfDay: string | null;
    rest: string;
}

// Hora y minuto también en PALABRAS ("a las siete", "y media"): la alternancia
// se construye desde el léxico ÚNICO (lib/spokenNumbers), nunca desde una lista
// de frases paralela que pueda divergir de la que usan los demás flujos.
const ES_WORDS = spokenNumberAlternation('es');
const EN_WORDS = spokenNumberAlternation('en');

export const ES_TIME = new RegExp(
    '\\b(?:a|para|hacia|de)\\s+las?\\s+(\\d{1,2}|' +
        ES_WORDS +
        ')(?:(?:\\s*[:.]\\s*(\\d{2}))|(?:\\s+(\\d{2}))|(?:\\s+con\\s+(\\d{1,2})\\s+minutos?)|(?:\\s+y\\s+(media|cuarto|' +
        ES_WORDS +
        ')))?' +
        '\\s*(?:de\\s+la\\s+(mañana|manana|tarde|noche|madrugada))?' +
        '\\s*(p\\.?\\s*m\\.?|a\\.?\\s*m\\.?)?',
    'i',
);

export const EN_TIME = new RegExp(
    '\\b(?:at|for)\\s+(\\d{1,2}|' +
        EN_WORDS +
        ')(?::(\\d{2})|\\s+(\\d{2}))?(?:\\s+(' +
        EN_WORDS +
        '))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?\\b',
    'i',
);

// Hora suelta con meridiem explícito ("10 p.m", "10 pm", "10 p. m.") SIN "a las".
export const BARE_MERIDIEM_TIME = /\b(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(p\.?\s*m\.?|a\.?\s*m\.?)\b/i;

const NOON_ES = /\b(?:al\s+|a\s+|el\s+)?(?:mediod[ií]a|medio\s+d[ií]a)\b/i;
const NOON_EN = /\b(?:at\s+)?noon\b/i;
const MIDNIGHT_ES = /\b(?:a\s+la\s+|la\s+)?(?:medianoche|media\s+noche)\b/i;
const MIDNIGHT_EN = /\b(?:at\s+)?midnight\b/i;

function removeRange(text: string, start: number, end: number): string {
    return `${text.slice(0, start)} ${text.slice(end)}`;
}

/** Minutos desde una palabra hablada: "y media", "y cuarto", "y veinte". */
function resolveMinuteWord(word: string | undefined): number | null {
    if (!word) return null;
    const w = word.toLowerCase();
    if (w === 'media') return 30;
    if (w === 'cuarto') return 15;
    return resolveSpokenNumber(w);
}

function resolveEsTime(m: RegExpExecArray): string | null {
    // La hora llega en cifra o en palabra ("a las 7" / "a las siete").
    const base = resolveSpokenNumber(m[1]);
    if (base == null) return null;
    let h = base;
    const min =
        (m[2] ? Number(m[2]) : m[3] ? Number(m[3]) : m[4] ? Number(m[4]) : null) ??
        resolveMinuteWord(m[5]) ??
        0;
    const part = m[6] ? m[6].toLowerCase() : null;
    const meridiem = m[7] ? m[7].toLowerCase().replace(/\./g, '').replace(/\s+/g, '') : null;
    if (meridiem === 'pm') {
        if (h < 12) h += 12;
    } else if (meridiem === 'am') {
        if (h === 12) h = 0;
    } else if (part === 'tarde') {
        if (h < 12) h += 12;
    } else if (part === 'noche') {
        if (h === 12) h = 0;
        else if (h < 12) h += 12;
    }
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function resolveEnTime(m: RegExpExecArray): string | null {
    const base = resolveSpokenNumber(m[1]);
    if (base == null) return null;
    let h = base;
    const min = (m[2] ? Number(m[2]) : m[3] ? Number(m[3]) : null) ?? resolveSpokenNumber(m[4]) ?? 0;
    const meridiem = m[5] ? m[5].toLowerCase().replace(/\./g, '').replace(/\s+/g, '') : null;
    if (meridiem === 'pm') {
        if (h < 12) h += 12;
    } else if (meridiem === 'am') {
        if (h === 12) h = 0;
    }
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function resolveBareMeridiemTime(m: RegExpExecArray): string {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const meridiem = m[3].toLowerCase().replace(/\./g, '').replace(/\s+/g, '');
    if (meridiem === 'pm') {
        if (h < 12) h += 12;
    } else if (meridiem === 'am') {
        if (h === 12) h = 0;
    }
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function pickTimeOfDay(text: string): PickedTimeOfDay {
    const source = String(text || '');
    // rank: 1 = meridiem explícito · 2 = HH:MM concreta · 4 = parte del día sola.
    const candidates: Array<{ start: number; end: number; timeOfDay: string; rank: number }> = [];

    const es = ES_TIME.exec(source);
    if (es) {
        const timeOfDay = resolveEsTime(es);
        if (timeOfDay) {
            candidates.push({
                start: es.index,
                end: es.index + es[0].length,
                timeOfDay,
                rank: es[7] ? 1 : 2,
            });
        }
    }
    const en = EN_TIME.exec(source);
    if (en) {
        const timeOfDay = resolveEnTime(en);
        if (timeOfDay) {
            candidates.push({
                start: en.index,
                end: en.index + en[0].length,
                timeOfDay,
                rank: en[5] ? 1 : 2,
            });
        }
    }
    const bare = BARE_MERIDIEM_TIME.exec(source);
    if (bare) {
        const start = bare.index;
        const end = bare.index + bare[0].length;
        const overlaps = candidates.some((c) => start < c.end && end > c.start);
        if (!overlaps) {
            candidates.push({ start, end, timeOfDay: resolveBareMeridiemTime(bare), rank: 1 });
        }
    }
    const noonEs = NOON_ES.exec(source);
    if (noonEs) candidates.push({ start: noonEs.index, end: noonEs.index + noonEs[0].length, timeOfDay: '12:00', rank: 4 });
    const noonEn = NOON_EN.exec(source);
    if (noonEn) candidates.push({ start: noonEn.index, end: noonEn.index + noonEn[0].length, timeOfDay: '12:00', rank: 4 });
    const midEs = MIDNIGHT_ES.exec(source);
    if (midEs) candidates.push({ start: midEs.index, end: midEs.index + midEs[0].length, timeOfDay: '00:00', rank: 4 });
    const midEn = MIDNIGHT_EN.exec(source);
    if (midEn) candidates.push({ start: midEn.index, end: midEn.index + midEn[0].length, timeOfDay: '00:00', rank: 4 });

    if (candidates.length === 0) return { timeOfDay: null, rest: source };
    candidates.sort((a, b) => a.start - b.start);
    const bestRank = Math.min(...candidates.map((c) => c.rank));
    const best = candidates.filter((c) => c.rank === bestRank).pop() as (typeof candidates)[number];
    let rest = source;
    for (const c of candidates.slice().sort((a, b) => b.start - a.start)) {
        rest = removeRange(rest, c.start, c.end);
    }
    return { timeOfDay: best.timeOfDay, rest };
}

// ------------------------------------------------------------
// Lectura COMPLETA: todas las horas del texto, en orden.
// `pickTimeOfDay` devuelve UNA hora (el contrato histórico: la de meridiem
// explícito o la más temprana). Un cambio de hora ("de las siete a las ocho")
// necesita las DOS: la primera identifica el item y la última es el destino.
// Mismo resolutor y mismas regex que `pickTimeOfDay` (una sola semántica de
// hora); sólo cambia la recolección, que aquí no se corta en el primer match.
// ------------------------------------------------------------

export interface TimeOfDayMatch {
    /** Hora en 'HH:MM' (24h). */
    timeOfDay: string;
    start: number;
    end: number;
    /** 1 = meridiem explícito · 2 = 'a las N' concreta · 4 = parte del día sola. */
    rank: number;
}

const ALL_ES = new RegExp(ES_TIME.source, 'gi');
const ALL_EN = new RegExp(EN_TIME.source, 'gi');
const ALL_BARE = new RegExp(BARE_MERIDIEM_TIME.source, 'gi');
const ALL_NOON_ES = new RegExp(NOON_ES.source, 'gi');
const ALL_NOON_EN = new RegExp(NOON_EN.source, 'gi');
const ALL_MID_ES = new RegExp(MIDNIGHT_ES.source, 'gi');
const ALL_MID_EN = new RegExp(MIDNIGHT_EN.source, 'gi');

function overlapsAny(kept: readonly TimeOfDayMatch[], c: TimeOfDayMatch): boolean {
    return kept.some((k) => c.start < k.end && c.end > k.start);
}

/** Todas las horas del texto, sin solapes y en orden de aparición. */
export function scanTimesOfDay(text: string): TimeOfDayMatch[] {
    const source = String(text || '');
    const matches: TimeOfDayMatch[] = [];
    const collect = (
        re: RegExp,
        resolve: (m: RegExpExecArray) => string | null,
        rank: (m: RegExpExecArray) => number,
    ): void => {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(source)) !== null) {
            if (!m[0].length) {
                re.lastIndex += 1;
                continue;
            }
            const timeOfDay = resolve(m);
            if (timeOfDay) {
                matches.push({ timeOfDay, start: m.index, end: m.index + m[0].length, rank: rank(m) });
            }
        }
    };
    // Prioridad de recolección la de `pickTimeOfDay`: primero las formas con
    // 'a las/at', luego la hora suelta con meridiem, luego parte del día.
    collect(ALL_ES, resolveEsTime, (m) => (m[7] ? 1 : 2));
    collect(ALL_EN, resolveEnTime, (m) => (m[5] ? 1 : 2));
    collect(ALL_BARE, resolveBareMeridiemTime, () => 1);
    collect(ALL_NOON_ES, () => '12:00', () => 4);
    collect(ALL_NOON_EN, () => '12:00', () => 4);
    collect(ALL_MID_ES, () => '00:00', () => 4);
    collect(ALL_MID_EN, () => '00:00', () => 4);

    const kept: TimeOfDayMatch[] = [];
    for (const c of matches) {
        if (overlapsAny(kept, c)) continue;
        kept.push(c);
    }
    return kept.sort((a, b) => a.start - b.start);
}

/** El texto SIN ninguna hora (todas, no sólo la primera). */
export function stripTimesOfDay(text: string): string {
    const source = String(text || '');
    let rest = source;
    for (const c of scanTimesOfDay(source).sort((a, b) => b.start - a.start)) {
        rest = removeRange(rest, c.start, c.end);
    }
    return rest;
}
