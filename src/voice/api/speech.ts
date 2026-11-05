/**
 * FACHADA DE SPEECH del modulo de voz (R7). Superficie PUBLICA.
 * Ningun consumidor de fuera de `src/voice` importa `src/voice/lib/**`: el guard
 * `tests/voiceFacadeGuard.test.ts` lo prohibe.
 */

export { cancelSpeech, getSpeechVoices, isSpeechBusy, isSpeechSupported, speakResponse, subscribeSpeechVoices, waitForSpeechIdle } from '../lib/fluSpeech.js'
export { abortSpeechRecognition, acquireSpeechRecognition, bindSpeechRecognition, isSpeechRecognitionSupported, startSpeechRecognition, stopSpeechRecognition } from '../lib/speechRecognitionLocal.js'
