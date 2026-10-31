/**
 * FACHADA DE CONVERSATION del modulo de voz (R7). Superficie PUBLICA.
 * Ningun consumidor de fuera de `src/voice` importa `src/voice/lib/**`: el guard
 * `tests/voiceFacadeGuard.test.ts` lo prohibe.
 */

export { buildFluSpeechAuditRows, deriveUserLastText, selectVisiblePhrase } from '../lib/conversationDialogue.js'
export { createConversationModeController } from '../lib/conversationMode.ts'
export { normalizeRowSignature, resolveRowSpeakerLabel, speakerIdToDefaultName } from '../lib/conversationRow.js'
export { renameRowSpeakerName } from '../conversation/index.ts'
export { logFluReply } from '../lib/fluConversationLog.ts'
export { evaluateListenParity } from '../lib/listenParity.js'
export { setNavSettlePending } from '../lib/navSettleFlag.js'
export { resolvedActionIdentity } from '../lib/resolvedActionIdentity.ts'
