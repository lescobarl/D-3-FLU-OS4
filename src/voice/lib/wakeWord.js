/**
 * Normalizador ÚNICO de wake word (fuente: FLU_CONFIG.voiceCommands.wakeWords).
 * Antes cada parser tenía su propio regex de wake, desalineado con la config
 * ("Okay flu" no se limpiaba porque el regex solo aceptaba "ok flu"/"okay flow").
 * Toda limpieza de wake pasa por aquí.
 */
import { FLU_CONFIG } from './fluConfig.js'

function escapeRe(text = '') {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Vocabulario de activación vigente (fuente: FLU_CONFIG). */
function configuredWakeWords() {
    return (FLU_CONFIG?.voiceCommands?.wakeWords || [])
        .map((word) => String(word || '').trim())
        .filter(Boolean)
}

/**
 * Patrón regex del vocabulario de activación. ÚNICA fuente de "cómo se escribe"
 * el wake (compuestos primero, espacios flexibles). El consumidor decide dónde
 * buscarlo: inicio (`anywhere: false`) o cualquier posición (`anywhere: true`).
 */
export function buildWakeWordPattern(wakeWords = [], { anywhere = false } = {}) {
    const words = (wakeWords || []).map((word) => String(word || '').trim()).filter(Boolean)
    if (!words.length) return null
    const alternatives = words
        .map((word) => word.split(/\s+/).map(escapeRe).join('\\s+'))
        .sort((a, b) => b.length - a.length)
    const lead = anywhere ? '(?:^|\\s)' : '^'
    return new RegExp(`${lead}(?:${alternatives.join('|')})(?:\\b|$)`)
}

let cacheKey = ''
let cacheRe = null

/** Regex anclado al inicio que tolera espacios variables dentro del wake. */
function wakeLeadRegex() {
    const words = configuredWakeWords()
    if (!words.length) return null
    const key = words.join('|')
    if (key !== cacheKey) {
        const base = buildWakeWordPattern(words)
        cacheKey = key
        cacheRe = base ? new RegExp(`${base.source}[,.:;\\s]*`, 'i') : null
    }
    return cacheRe
}

/** Quita el wake word configurado SOLO al inicio; resto de la frase intacto. */
export const stripWakeWord = (text = '') => {
    const clean = String(text || '').trim()
    const re = wakeLeadRegex()
    return re ? clean.replace(re, ' ').trim() : clean
}

/**
 * Quita el wake word configurado en CUALQUIER posición (eco ASR que lo mete en
 * medio de la frase). Mismo vocabulario que `stripWakeWord`: no duplica la lista
 * de wake words ni hardcodea variantes.
 */
export const stripWakeWordAnywhere = (text = '') => {
    const clean = String(text || '')
    const base = buildWakeWordPattern(configuredWakeWords(), { anywhere: true })
    if (!base) return clean.trim()
    return clean.replace(new RegExp(base.source, 'gi'), ' ').replace(/\s+/g, ' ').trim()
}
