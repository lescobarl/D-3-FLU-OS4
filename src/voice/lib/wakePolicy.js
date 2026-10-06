/**
 * Politica de wake en RUNTIME: la bandera "exigir la wake en cada frase".
 *
 * El DUENO UNICO de la decision sigue siendo `requiresWakeWord`
 * (src/voice/lib/wakeTurnCommit.js), que lee `voiceCommands.requireWakeAlways`.
 * Aqui solo se ESCRIBE ese valor cuando el usuario lo pide por voz (la bandera
 * del configurador, en su version por voz). Sin orden del usuario manda el
 * default de la config, asi que el comportamiento no cambia solo.
 *
 * LIMITE DECLARADO (P8.68): el ajuste vive en memoria (se pierde al recargar) y
 * el toggle de UI + su persistencia son la otra mitad del item, bloqueada por el
 * gate (tests/fluSettingsTabView.test.tsx no puede entrar en lint:guards).
 */
import { FLU_CONFIG } from './fluConfig.js'
import { cleanForSpeech, splitTranscriptAtWakeWord, stripDiacritics } from './audioMath.js'

/** Ordenes de politica (valor interno, no dato de config). */
export const WAKE_POLICY_ORDER = Object.freeze({ ON: 'on', OFF: 'off' })

export function getWakePolicyPhrases(config = FLU_CONFIG) {
    return config.voiceCommands?.wakePolicyPhrases || {}
}

/**
 * Orden de politica de wake pedida por el texto.
 * @returns {'on'|'off'|null}
 */
export function resolveWakePolicyOrder(text = '', config = FLU_CONFIG, { requireWake = false } = {}) {
    const raw = cleanForSpeech(text)
    const split = splitTranscriptAtWakeWord(raw, config.voiceCommands?.wakeWords || [])
    // Modo CERRADO: la orden necesita su PROPIO wake en el enunciado (mismo criterio
    // que un comando). Si no, una frase del aula/TV ("piso abierto") cambiaria la
    // bandera sola. En el gate pasivo la wake ya la valido la puerta del turno.
    if (requireWake && !split.wakeWordMatched) return null
    // La orden llega CON la wake delante ("okay flow exige la wake") o ya pelada
    // (el gate pasivo entrega el commandText): el splitter unico decide.
    const norm = stripDiacritics(cleanForSpeech(split.wakeWordMatched ? split.afterWake || split.commandText : raw)).toLowerCase()
    if (!norm) return null
    const phrases = getWakePolicyPhrases(config)
    const matches = (list) =>
        (list || []).some((candidate) => stripDiacritics(cleanForSpeech(candidate)).toLowerCase() === norm)
    if (matches(phrases.on)) return WAKE_POLICY_ORDER.ON
    if (matches(phrases.off)) return WAKE_POLICY_ORDER.OFF
    return null
}

/**
 * Aplica la orden al valor que lee el dueno unico (`requireWakeAlways`).
 * @returns {boolean} true si aplico.
 */
export function applyWakePolicyOrder(order, config = FLU_CONFIG) {
    if (order !== WAKE_POLICY_ORDER.ON && order !== WAKE_POLICY_ORDER.OFF) return false
    if (!config?.voiceCommands) return false
    config.voiceCommands.requireWakeAlways = order === WAKE_POLICY_ORDER.ON
    return true
}

/** Frase de confirmacion del turno (una sola fuente, es/en). */
export function wakePolicySpeech(order, language = 'es', config = FLU_CONFIG) {
    const phrases = getWakePolicyPhrases(config)
    const entry = order === WAKE_POLICY_ORDER.OFF ? phrases.speechOff : phrases.speechOn
    if (!entry) return ''
    return language === 'en' ? entry.en || entry.es || '' : entry.es || entry.en || ''
}
