/**
 * FACHADA DE COMMANDS del modulo de voz (R7). Superficie PUBLICA.
 * Ningun consumidor de fuera de `src/voice` importa `src/voice/lib/**`: el guard
 * `tests/voiceFacadeGuard.test.ts` lo prohibe.
 */

export { COMMAND_IDS } from '../lib/commandIds.js'
export { hasVoiceToken, normalizeForMatch, normalizeJuego } from '../lib/configCommands.js'
export { resolveDeterministicCommand } from '../lib/deterministicArbiter.js'
export { isClaimedByOtherDomain, setAudioPlayingProbe } from '../lib/gameCommands.js'
export { resolveNoteVoiceIntent } from '../lib/noteIntentParser.js'
export { getCommandSpeech, userRequestedNavigationCommand } from '../lib/voiceCommands.js'
