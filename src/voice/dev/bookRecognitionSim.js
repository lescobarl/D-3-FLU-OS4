/**
 * Dev-only simulation module for speech recognition events.
 * Used by useFluVoiceAssistant.js in DEV mode via window.__fluDev.simulateBook()
 *
 * buildChromeLikeEvents() returns an array of simulated recognition events
 * that mimic a "book" reading scenario for testing the voice pipeline.
 */

/**
 * @returns {Array<{type: 'interim'|'final', text: string}>}
 */
export function buildChromeLikeEvents() {
  return [
    { type: 'interim', text: 'hola' },
    { type: 'interim', text: 'hola flu' },
    { type: 'final', text: 'hola flu como estas' },
    { type: 'interim', text: 'estoy' },
    { type: 'interim', text: 'estoy leyendo' },
    { type: 'final', text: 'estoy leyendo un libro' },
    { type: 'interim', text: 'me' },
    { type: 'interim', text: 'me gusta' },
    { type: 'final', text: 'me gusta mucho este libro' },
  ]
}
