// ============================================================
// Transcript Quality Heuristics
// ============================================================
// Pure functions for filtering, normalizing, and validating
// speech-to-text transcripts before they enter the conversation
// log. Designed to reduce noise, echo, and low-quality ASR output.
//
// Cumple:
//   - Rule #1: NO HARDCODE — all thresholds configurable
//   - Pure functions — no React dependencies
// ============================================================

// -----------------------------------------------------------
// Default thresholds
// -----------------------------------------------------------
export interface TranscriptQualityConfig {
    /** Minimum character length for a valid transcript (default: 3) */
    minChars: number;
    /** Maximum character length before truncation (default: 2000) */
    maxChars: number;
    /** If > 0, reject transcripts where the ratio of repeated words exceeds this (default: 0.6) */
    maxRepeatRatio: number;
    /** If true, reject transcripts that are exact duplicates of the last N entries (default: true) */
    rejectExactDuplicates: boolean;
    /** Number of prior entries to check for duplicates (default: 3) */
    duplicateLookback: number;
    /** Regex pattern for characters considered non-speech noise (default: /^[^a-zA-ZáéíóúñüÁÉÍÓÚÑÜ\s]+$/) */
    noisePattern: RegExp;
    /** Minimum unique word ratio — if too many repeated words, likely echo (default: 0.3) */
    minUniqueWordRatio: number;
}

export const DEFAULT_TRANSCRIPT_QUALITY_CONFIG: TranscriptQualityConfig = {
    minChars: 3,
    maxChars: 2000,
    maxRepeatRatio: 0.6,
    rejectExactDuplicates: true,
    duplicateLookback: 3,
    noisePattern: /^[^a-zA-ZáéíóúñüÁÉÍÓÚÑÜ\s]+$/,
    minUniqueWordRatio: 0.3,
};

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

/**
 * Count word frequency in a string.
 */
function wordFrequency(text: string): Map<string, number> {
    const words = text.toLowerCase().match(/\S+/g) || [];
    const freq = new Map<string, number>();
    for (const w of words) {
        freq.set(w, (freq.get(w) || 0) + 1);
    }
    return freq;
}

/**
 * Compute the ratio of the most frequent word to total words.
 * High values indicate echo/stutter (e.g. "si si si si").
 */
function maxWordRepeatRatio(text: string): number {
    const words = text.toLowerCase().match(/\S+/g) || [];
    if (words.length === 0) return 0;
    const freq = wordFrequency(text);
    const maxCount = Math.max(...freq.values());
    return maxCount / words.length;
}

/**
 * Compute ratio of unique words to total words.
 * Low values indicate repetitive/echo transcripts.
 */
function uniqueWordRatio(text: string): number {
    const words = text.toLowerCase().match(/\S+/g) || [];
    if (words.length === 0) return 0;
    const unique = new Set(words);
    return unique.size / words.length;
}

/**
 * Check if text is mostly non-speech noise (symbols, numbers, etc.).
 */
function isMostlyNoise(text: string, pattern: RegExp): boolean {
    const chars = text.replace(/\s/g, '');
    if (chars.length === 0) return true;
    const noiseChars = chars.split('').filter((c) => pattern.test(c));
    return noiseChars.length / chars.length > 0.5;
}

/**
 * Check if text is an exact duplicate of any of the last N entries.
 */
function isExactDuplicate(text: string, recentEntries: string[], lookback: number): boolean {
    const normalized = text.toLowerCase().trim();
    const start = Math.max(0, recentEntries.length - lookback);
    for (let i = start; i < recentEntries.length; i++) {
        if (recentEntries[i].toLowerCase().trim() === normalized) {
            return true;
        }
    }
    return false;
}

/**
 * Check if text is a substring of the last entry (ASR revision).
 * E.g. "hola" → "hola como" → "hola como estas" — keep only the longest.
 */
function isAsrRevision(text: string, recentEntries: string[]): boolean {
    const normalized = text.toLowerCase().trim();
    for (let i = recentEntries.length - 1; i >= 0; i--) {
        const prev = recentEntries[i].toLowerCase().trim();
        if (prev && normalized.startsWith(prev) && normalized.length > prev.length) {
            return true;
        }
    }
    return false;
}

// -----------------------------------------------------------
// Main validation function
// -----------------------------------------------------------

export interface TranscriptValidationResult {
    /** Whether the transcript is valid and should be kept */
    valid: boolean;
    /** The (possibly normalized) transcript text */
    text: string;
    /** Reason for rejection, if invalid */
    reason?: string;
    /** Whether this is an ASR revision of a previous entry */
    isRevision?: boolean;
}

/**
 * Validate and normalize a transcript before it enters the conversation log.
 *
 * @param transcript - Raw transcript from ASR
 * @param recentEntries - Last N committed transcript texts for duplicate detection
 * @param config - Optional quality config overrides
 * @returns Validation result
 */
export function validateTranscript(
    transcript: string,
    recentEntries: string[] = [],
    config: Partial<TranscriptQualityConfig> = {},
): TranscriptValidationResult {
    const cfg: TranscriptQualityConfig = { ...DEFAULT_TRANSCRIPT_QUALITY_CONFIG, ...config };
    const text = (transcript || '').trim();

    // Empty transcript
    if (!text) {
        return { valid: false, text: '', reason: 'empty' };
    }

    // Too short
    if (text.length < cfg.minChars) {
        return { valid: false, text, reason: `too_short:${text.length}<${cfg.minChars}` };
    }

    // Too long
    if (text.length > cfg.maxChars) {
        return { valid: false, text: text.slice(0, cfg.maxChars), reason: `too_long:${text.length}>${cfg.maxChars}` };
    }

    // Mostly noise (symbols, numbers without letters)
    if (isMostlyNoise(text, cfg.noisePattern)) {
        return { valid: false, text, reason: 'mostly_noise' };
    }

    // Check for echo/repetition (e.g. "si si si si si")
    const repeatRatio = maxWordRepeatRatio(text);
    if (repeatRatio > cfg.maxRepeatRatio) {
        return { valid: false, text, reason: `echo:repeat_ratio_${repeatRatio.toFixed(2)}` };
    }

    // Check unique word ratio (low = repetitive)
    const uniqRatio = uniqueWordRatio(text);
    if (uniqRatio < cfg.minUniqueWordRatio) {
        return { valid: false, text, reason: `repetitive:unique_ratio_${uniqRatio.toFixed(2)}` };
    }

    // Check for exact duplicates
    if (cfg.rejectExactDuplicates && isExactDuplicate(text, recentEntries, cfg.duplicateLookback)) {
        return { valid: false, text, reason: 'exact_duplicate' };
    }

    // Check for ASR revision (substring of previous)
    const isRevision = isAsrRevision(text, recentEntries);
    if (isRevision) {
        // Revisions are valid but marked — the caller should REPLACE the previous entry
        return { valid: true, text, isRevision: true };
    }

    return { valid: true, text, isRevision: false };
}

/**
 * Normalize a transcript for comparison/dedup purposes.
 * Strips punctuation, lowercases, collapses whitespace.
 */
export function normalizeTranscript(text: string): string {
    return (text || '')
        .toLowerCase()
        .replace(/[^\w\sáéíóúñüÁÉÍÓÚÑÜ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Check if two transcripts are semantically equivalent (after normalization).
 */
export function areTranscriptsEquivalent(a: string, b: string): boolean {
    return normalizeTranscript(a) === normalizeTranscript(b);
}
