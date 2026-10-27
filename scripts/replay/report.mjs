/**
 * DECLARACION DE PLAYBACK (ETAPA 6).
 *
 * El playback corre la MISMA tuberia sobre la grabacion; no tiene reglas propias. Pero solo
 * es COMPARABLE si el ASR es determinista:
 *  - `stub` (reinyectar los eventos grabados) y `whisper-local` (modelo fijo) son
 *    reproducibles: la misma entrada da la misma salida;
 *  - Chrome SpeechRecognition (la nube) NO es reproducible: el mismo audio puede devolver
 *    otro texto y otras fronteras. Se declara NO COMPARABLE en vez de vender un golden.
 *
 * @param {Array<{ event?: string, data?: { kind?: string } }>} [events]
 * @returns {{ asr: 'stub'|'whisper-local'|'chrome-web-speech'|'desconocido', determinista: boolean, comparable: boolean, motivo: string }}
 */
export function declararPlayback(events = []) {
  const filas = Array.isArray(events) ? events : []
  const hayChrome = filas.some((fila) => String(fila?.event || '') === 'chrome-raw')
  const hayStub = filas.some((fila) => String(fila?.event || '') === 'stub-asr')
  if (hayStub) {
    return {
      asr: 'stub',
      determinista: true,
      comparable: true,
      motivo: 'ASR reinyectado (stub): misma entrada, misma salida',
    }
  }
  if (hayChrome) {
    return {
      asr: 'chrome-web-speech',
      determinista: false,
      comparable: false,
      motivo: 'Chrome SpeechRecognition en vivo: el texto y las fronteras no se reproducen',
    }
  }
  return {
    asr: 'desconocido',
    determinista: false,
    comparable: false,
    motivo: 'la grabacion no declara su motor de ASR: no se puede afirmar reproducibilidad',
  }
}
