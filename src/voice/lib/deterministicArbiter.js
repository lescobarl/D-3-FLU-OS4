// ============================================================
// FLU OS4 — Árbitro determinista UNIFICADO (módulo puro)
// ------------------------------------------------------------
// §1A / §2A del plan de afinado estructural (2026-09-04).
//
// Centraliza la resolución de TODOS los dominios deterministas de voz
// (configuración, juego, ambiente, navegación y, en el futuro, horario y
// búsqueda web) en UNA función pura, SIN dependencia de React, refs ni
// estado. Esto permite:
//   - Testear el árbitro en aislamiento (tests/deterministicArbiter.test.ts).
//   - Eliminar la duplicación de `resolveConfigCommandFromText` que hoy se
//     repite en 3 lugares del hook useFluVoiceAssistant.
//   - Cambiar la semántica a "si hay match determinista → manda y NO llamar
//     a Gemini" (§2B) desde un único punto.
//
// Regla de capas (§1B): este módulo vive en src/voice/lib/* = lógica pura y
// testeable (sin React, sin refs). La orquestación y el despacho (llamadas a
// onContractResolved) siguen en el hook.
// ============================================================

import { resolveConfigCommandFromText } from './configCommands.js'
import { resolveGameCommandFromText } from './gameCommands.js'
import { resolveEnvironmentIntent } from '../../core/environments/environmentIntents'
import { parseHorarioIntent } from '../../core/horario/horarioIntentParser'
import { resolveNavigationCommandFromTexts } from './voiceCommands.js'

/**
 * Dominios deterministas soportados por el árbitro.
 * Orden de prioridad de resolución (config > juego > ambiente > horario >
 * navegación): los dominios con efecto de estado (config/juego/ambiente/
 * horario) se evalúan antes que la navegación pura para que un comando de
 * configuración no se trague una navegación, y viceversa.
 */
export const ARBITER_DOMAINS = Object.freeze([
  'config',
  'game',
  'environment',
  'horario',
  'navigation',
])

/**
 * Resuelve de forma determinista y local un comando de voz a partir del texto
 * transcrito, contrastando contra TODOS los resolvers de dominio en orden de
 * prioridad. NO depende de Gemini.
 *
 * @param {string} text Texto transcrito (crudo o ya limpio).
 * @param {object} [options]
 * @param {string} [options.language='es'] Idioma detectado (para ambiente).
 * @param {string[]} [options.texts] Fragmentos ASR alternativos (buffer+final)
 *   usados por la resolución de navegación. Si se omite, se usa `text`.
 * @returns {{ matched: boolean, domain: string|null, action: object|null }}
 *   - `matched`: true si algún dominio resolvió una acción.
 *   - `domain`:  nombre del dominio que ganó ('config'|'game'|'environment'|
 *                'horario'|'navigation') o null.
 *   - `action`:  objeto de acción resuelto por el dominio (forma específica de
 *                cada resolver) o null.
 */
export function resolveDeterministicCommand(text = '', options = {}) {
  const { language = 'es', texts = null } = options || {}
  const transcript = String(text || '').trim()
  if (!transcript && !(Array.isArray(texts) && texts.some((t) => String(t || '').trim()))) {
    return { matched: false, domain: null, action: null }
  }

  // 1. Configuración (configCommands): efecto de estado de configuración.
  const config = resolveConfigCommandFromText(transcript)
  if (config?.accion) {
    return { matched: true, domain: 'config', action: config }
  }

  // 2. Juego (gameCommands): arranque/turno/fin de partida.
  const game = resolveGameCommandFromText(transcript)
  if (game?.gameId) {
    return { matched: true, domain: 'game', action: game }
  }

  // 3. Ambiente (environmentIntents): activar/reset de ambiente.
  const env = resolveEnvironmentIntent(transcript, language)
  if (env?.tipo) {
    return { matched: true, domain: 'environment', action: env }
  }

  // 4. Horario por dictado (horarioIntentParser): agregar/consultar/quitar
  //    entradas del horario semanal. §2C del plan de afinado estructural.
  //    Solo se considera MATCH cuando el parser devuelve una intención
  //    ACCIONABLE (horario.add/query/remove). Los casos de aclaración
  //    (action === null, p. ej. falta la hora) NO se marcan como match aquí:
  //    el despacho real vive en App.tsx (__fluHandleHorarioText, que sí
  //    maneja la aclaración) y este árbitro solo reconoce el dictado completo
  //    para que el flujo pueda saltarse Gemini (§2B).
  const horario = parseHorarioIntent(transcript)
  if (horario?.handled && horario?.action) {
    return { matched: true, domain: 'horario', action: horario }
  }

  // 5. Navegación (voiceCommands): comandos de UI/navegación directos.
  const navTexts = Array.isArray(texts) && texts.length ? texts : [transcript]
  const nav = resolveNavigationCommandFromTexts(navTexts)
  if (nav) {
    return { matched: true, domain: 'navigation', action: nav }
  }

  return { matched: false, domain: null, action: null }
}

/**
 * Conveniencia: resuelve solo los dominios con efecto de estado (config/juego/
 * ambiente), ignorando navegación. Usado por la idempotencia del contrato
 * tardío en el hook (los fast-paths de estado se despachan por onContractResolved
 * y luego se anulan del contrato tardío).
 *
 * @param {string} text
 * @param {object} [options]
 * @returns {{ config: object|null, game: object|null, env: object|null }}
 */
export function resolveStatefulDomains(text = '', options = {}) {
  const { language = 'es' } = options || {}
  const transcript = String(text || '').trim()
  return {
    config: transcript ? resolveConfigCommandFromText(transcript) : null,
    game: transcript ? resolveGameCommandFromText(transcript) : null,
    env: transcript ? resolveEnvironmentIntent(transcript, language) : null,
  }
}

// ------------------------------------------------------------
// §2B — Frase de cortesía determinista (sin Gemini)
// ------------------------------------------------------------
// Etiquetas amigables por clave de configuración, usadas para construir la
// confirmación verbal cuando el árbitro matchea un dominio de estado y el flag
// `FLU_CONFIG.arbiter.skipGeminiOnMatch` está activo (§2B). Solo cubre las
// claves más comunes orientadas al usuario; el resto cae a un genérico con la
// clave cruda. NO pretende ser exhaustivo: es un respaldo determinista, no un
// sustituto de la riqueza verbal de Gemini.
const CONFIG_LABEL_ES = Object.freeze({
  mode: 'el modo del branding estacional',
  activeSeason: 'la temporada visual',
  birthday: 'la fecha de cumpleaños',
  celebrateAchievements: 'las celebraciones por logros',
  customEvent: 'la festividad personalizada',
  language: 'el idioma de la interfaz',
  sessionRole: 'el rol de la sesión',
  voiceSpeed: 'la velocidad de voz',
  voice: 'la voz',
  pitch: 'el tono de voz',
  volume: 'el volumen',
  aiProvider: 'el proveedor de inteligencia artificial',
  profile: 'el perfil',
  wakeWords: 'las palabras de activación',
  debugLogs: 'los registros de depuración',
  capVisible: 'la visibilidad de la gorra',
  hairVisible: 'la visibilidad del cabello',
  avatarColor: 'el color del avatar',
  pantsColor: 'el color del pantalón',
  bodyColor: 'el color del cuerpo',
  faceColor: 'el color de la cara',
  resetAvatarColors: 'los colores del avatar',
  clearCache: 'la caché',
})

const CONFIG_LABEL_EN = Object.freeze({
  mode: 'the seasonal branding mode',
  activeSeason: 'the visual season',
  birthday: 'the birthday date',
  celebrateAchievements: 'achievement celebrations',
  customEvent: 'the custom festivity',
  language: 'the interface language',
  sessionRole: 'the session role',
  voiceSpeed: 'the voice speed',
  voice: 'the voice',
  pitch: 'the voice pitch',
  volume: 'the volume',
  aiProvider: 'the AI provider',
  profile: 'the profile',
  wakeWords: 'the wake words',
  debugLogs: 'the debug logs',
  capVisible: 'the cap visibility',
  hairVisible: 'the hair visibility',
  avatarColor: 'the avatar color',
  pantsColor: 'the pants color',
  bodyColor: 'the body color',
  faceColor: 'the face color',
  resetAvatarColors: 'the avatar colors',
  clearCache: 'the cache',
})

/**
 * Construye una frase de cortesía DETERMINISTA (sin Gemini) para un dominio de
 * estado matcheado por el árbitro (§2B). Se usa como `respuesta_voz` del
 * contrato cuando `FLU_CONFIG.arbiter.skipGeminiOnMatch` está activo y el
 * fast-path ya aplicó el efecto.
 *
 * Semántica por dominio:
 *   - 'config': la acción de configuración NO habla por sí sola (el efecto lo
 *     aplica applyConfigAction), así que aquí se produce la confirmación verbal.
 *   - 'game' / 'environment': el motor local (src/core/games|environments) ya
 *     habla su propia voz de bienvenida/turno, así que se devuelve '' para NO
 *     duplicar el habla (mismo comportamiento que el fast-path actual).
 *
 * @param {object|null} action Acción resuelta por el dominio (config/juego/ambiente).
 * @param {string} domain Nombre del dominio ('config'|'game'|'environment').
 * @param {string} [language='es'] Idioma detectado ('es'|'en').
 * @returns {string} Frase de cortesía ('' si el motor local ya habla).
 */
export function resolveDeterministicCourtesySpeech(action = null, domain = '', language = 'es') {
  const isEn = String(language || 'es').toLowerCase().startsWith('en')
  if (!action) return ''

  if (domain === 'game' || domain === 'environment') {
    // El motor local ya habla su propia voz; no duplicar.
    return ''
  }

  if (domain !== 'config') return ''

  const clave = String(action.clave || '').trim()
  const valor = action.valor
  const label = (isEn ? CONFIG_LABEL_EN : CONFIG_LABEL_ES)[clave] || clave

  // Caso especial: apagar el branding estacional (mode=disabled).
  if (clave === 'mode' && String(valor).toLowerCase() === 'disabled') {
    return 'Listo, he apagado el branding estacional.'
  }

  if (valor == null || valor === '') {
    return `Listo, he actualizado ${label}.`
  }

  const displayValor = Array.isArray(valor) ? valor.join(', ') : String(valor)
  return `Listo, he configurado ${label} a ${displayValor}.`
}

/**
 * Semántica §2B (función pura testeable): decide si un texto de voz debe
 * SALTARSE a Gemini porque el árbitro determinista matcheó un dominio con
 * efecto de estado (config/juego/ambiente) y el flag `skipGeminiOnMatch` está
 * activo.
 *
 * Devuelve `null` cuando NO se debe saltar Gemini (flag apagado, o sin match de
 * dominio de estado, o dominio no-estado como navegación/horario). Devuelve un
 * objeto `{ domain, contract }` cuando SÍ se debe saltar: `contract` es el
 * contrato determinista completo (con `respuesta_voz` de cortesía) listo para
 * despachar por `onContractResolved`.
 *
 * Extraída del hook para poder testear la semántica "no llamar a Gemini si hay
 * match" (paso 3B) sin mockear React. La orquestación (diálogo, sesión,
 * onContractResolved) sigue en el hook.
 *
 * @param {object} opts
 * @param {string} opts.text Texto de voz (pregunta o transcripción completa).
 * @param {string} [opts.language='es'] Idioma detectado.
 * @param {boolean} [opts.skipGeminiOnMatch=false] Flag de feature (§2B).
 * @returns {{ domain: string, contract: object } | null}
 */
export function resolveDeterministicSkipGeminiContract({
  text = '',
  language = 'es',
  skipGeminiOnMatch = false,
} = {}) {
  if (!skipGeminiOnMatch) return null

  const stateful = resolveStatefulDomains(text, { language })
  const domain = stateful.config?.accion
    ? 'config'
    : stateful.game?.gameId
      ? 'game'
      : stateful.env?.tipo
        ? 'environment'
        : null

  if (!domain) return null

  const action =
    domain === 'config'
      ? stateful.config
      : domain === 'game'
        ? stateful.game
        : stateful.env

  const courtesy = resolveDeterministicCourtesySpeech(action, domain, language)

  const contract = {
    respuesta_voz: courtesy,
    navegacion: { comando: null, destino: null, parametros: {} },
    workspace: null,
    musica: null,
    configuracion: domain === 'config' ? stateful.config : null,
    juego: domain === 'game' ? stateful.game : null,
    ambiente: domain === 'environment' ? stateful.env : null,
    metadata: { provider: 'deterministic-arbiter', transcript: text, rawText: '' },
  }

  return { domain, contract }
}
