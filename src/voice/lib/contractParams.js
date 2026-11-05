/**
 * contractParams - dueno unico de las ENTRADAS DEL TURNO que el motor de voz envia
 * al borde del contrato (`/api/gemini/contract`).
 *
 * Por que existe este modulo (medido en la auditoria 2026-10-03, P8.29):
 * el borde del servidor reenviaba 13 de los 22 campos que el motor de voz envia,
 * asi que el radar de contexto (diario, notas, horario, resultados), la
 * personalidad del perfil (startupPrompt), el bloque de emocion (recentMemory), el
 * autoconocimiento y la KB/minutas quedaban mudos en el carril de voz. La lista
 * vive AQUI (una sola vez) y `tests/contractBoundaryGuard.test.ts` la mide contra
 * la lista que declara el borde, de modo que anadir/quitar un campo sin declararlo
 * en el borde es ROJO.
 *
 * Contrato de `sources` (todo inyectado, nada se lee por variable global):
 *  - consumeRecentMemory: lee y LIMPIA el bloque de emocion (una sola vez por turno).
 *  - getAgenda: pendientes de hoy (bloques 1-2 del radar).
 *  - getSelfManifesto: manifiesto de autoconocimiento (solo si el turno lo pide).
 *  - getDiaryContext / getNotesContext / getHorarioContext / getResultadosContext:
 *    bloques 6-9 del radar de contexto del Pizarron ('' si no hay datos, Rule #1).
 *
 * La personalidad/creatividad (integrationStore) es la MISMA fuente que lee el
 * configurador: el modulo consulta al store, no una copia.
 */
import { isSelfKnowledgeRequest } from '../../core/selfKnowledge/selfKnowledge'
import { useIntegrationStore } from '../../store/integrationStore'

/**
 * Ensambla las entradas del turno para el contrato de voz.
 * @param {object} turn Campos ya resueltos por el motor de voz.
 * @param {object} sources Getters inyectados (ver contrato del modulo).
 * @returns {object} Payload que consume `requestFluContract` / `generateFluContract`.
 */
export function buildContractParams(turn, sources) {
  const {
    apiKey, transcript, intent, speaker, theme, role, phase, language,
    knowledgeMode, history, knowledgeBase, knowledgeBase2,
  } = turn

  // Personalidad + creatividad desde el FLU Configurator (integrationStore).
  const integrationState = useIntegrationStore.getState?.()
  const personality = integrationState?.config?.personality
    ? {
      traits: integrationState.config.personality.traits || [],
      tone: integrationState.config.personality.tone || 'friendly',
      customInstructions: integrationState.config.personality.customInstructions || '',
    }
    : null
  const creativity = integrationState?.advancedConfig?.creativity ?? null

  // startupPrompt del perfil activo.
  const currentProfile = integrationState?.availableProfiles?.find(
    (profile) => profile.id === integrationState?.profile,
  )
  const startupPrompt = currentProfile?.startupPrompt || ''

  // Bloque de emocion: se lee y se limpia en la misma operacion para que no se
  // repita en las peticiones siguientes.
  const recentMemory = sources.consumeRecentMemory()

  // Pendientes de hoy (agenda de minutas).
  const agendaText = sources.getAgenda() || ''

  // Autoconocimiento: solo se inyecta cuando el turno lo pide (isSelfKnowledgeRequest).
  const selfKnowledgeText = isSelfKnowledgeRequest(transcript, language)
    ? (sources.getSelfManifesto() || '')
    : ''

  // Radar de contexto (Pizarron, paso 5): bloques 6-9, dinamicos y '' si no hay datos.
  const diaryContext = sources.getDiaryContext() || ''
  const notesContext = sources.getNotesContext() || ''
  const horarioContext = sources.getHorarioContext() || ''
  const resultadosContext = sources.getResultadosContext() || ''

  return {
    apiKey,
    transcript,
    intent,
    speaker,
    theme,
    role,
    phase,
    language,
    history,
    knowledgeBase,
    knowledgeBase2,
    knowledgeMode,
    personality,
    creativity,
    recentMemory,
    startupPrompt,
    agendaText,
    selfKnowledgeText,
    diaryContext,
    notesContext,
    horarioContext,
    resultadosContext,
  }
}
