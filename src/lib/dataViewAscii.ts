/**
 * DUENO UNICO de la escritura ASCII en un `DataView` (cabeceras WAV/RIFF).
 *
 * El mismo cuerpo estaba copiado en `src/dev/asrLab/AsrLab.tsx` (`writeStr`) y en
 * `src/voice/lib/sessionRecorder.js` (`writeAscii`); el guard de duplicacion
 * estructural lo marco (2026-10-19). Los dos escriben byte a byte el texto en el
 * buffer del WAV, asi que la implementacion vive aqui.
 *
 * @param view Vista binaria sobre el buffer de destino.
 * @param offset Posicion del primer byte del texto.
 * @param text Texto ASCII a escribir (RIFF/WAVE/'fmt '/'data').
 */
export function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
}
