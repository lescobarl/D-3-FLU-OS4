# FLU Playback

Herramienta de depuración: reproduce el audio de una sesión por un **cable de
audio virtual** y deja que la app lo escuche por el micrófono del sistema, como
si el usuario estuviera hablando.

No sustituye el ASR, no inyecta PCM, no cancela el TTS y no escribe filas por su
cuenta. La app ejecuta su camino real: Chrome SpeechRecognition, captura del
micrófono, VAD, tramos y reglas de conversación.

## Requisitos

1. Google Chrome instalado (Playwright usa `channel: 'chrome'`). Chromium no
   tiene el ASR de producción.
2. Un cable de audio virtual (VB-Audio Cable, VoiceMeeter u equivalente).
3. La **grabación** del cable (`CABLE Output`/`Voicemeeter Out B1`) configurada
   como micrófono predeterminado del sistema.
4. La **reproducción** física (altavoces/auriculares) como salida
   predeterminada. El WAV se envía a la entrada del cable con
   `AudioContext.setSinkId`; así el TTS de FLU no entra en el cable.
5. Red disponible para Chrome SpeechRecognition (Web Speech API).

Si usas VoiceMeeter, su motor (`voicemeeter.exe`) debe estar en ejecución: el
driver solo expone los endpoints; el mezclador hace el routing del input virtual
al bus de grabación (`Voicemeeter Out B1`). VB-Cable es punto a punto y no
necesita aplicación.

El playback comprueba (3) y la existencia de (2) antes de reproducir y falla con
instrucciones si no están configurados. No hay fallback silencioso a Whisper ni
a un micrófono falso.

## Uso

```bash
npm run playback -- --session <carpeta> --tail 5000
npm run playback -- --session <carpeta> --headed
npm run playback -- --session <carpeta> --report-rows --timeout 600000
npm run playback -- --session <carpeta> --output-device "CABLE Input" --input-device "CABLE Output"
```

- `--output-device <texto>`: salida donde suena el WAV (subcadena del nombre).
  Por defecto autodetecta `CABLE Input`/`Voicemeeter Input`/`Virtual Cable`.
- `--input-device <texto>`: micrófono que debe ser el predeterminado
  (subcadena). Por defecto autodetecta `CABLE Output`/`Voicemeeter Out`.
- `--lead-in <ms>`: silencio añadido antes del audio (default 0).
- `--tail <ms>`: silencio añadido después del audio (default 5000). Da margen
  al ASR para cerrar el último turno.
- `--report-rows`: imprime las filas finales de la conversación (no las compara
  con `turns.ndjson`; la validación de contenido es del usuario).
- `--url <url>`: app (default `http://localhost:5173`).
- `--headed`: navegador visible.
- `--timeout <ms>`: límite total.

## Qué reconstruye de la grabación

- El audio completo (`audio.wav` o `audio.pcm`), sin alterar el contenido; solo
  puede añadir silencio inicial/final.
- El idioma de `manifest.json`/`meta.json` (`flu-language`).
- Los participantes del snapshot `base-start` de `turns.ndjson` y el que estaba
  activo. Sin snapshot se crea un usuario activo mínimo (la app rechaza datos
  per-usuario sin usuario activo).

## Cierre de la reproducción

El playback solo entrega audio. La app publica `LISTENING` cuando su motor está
listo; entonces se reproduce el WAV. Al terminar se espera la cola de
transcripción (`__fluWhenRecognitionIdle`) y a que la conversación deje de
cambiar antes de cerrar. La ventana de estabilidad es `FLU_PLAYBACK_SETTLE_MS`
(default 3000) y su tope `FLU_PLAYBACK_SETTLE_MAX_MS` (default 60000).

## Límites

- Solo reproduce audio; no valida filas por comparación de guion.
- La app debe estar configurada como en la grabación (wake words, idioma,
  proveedor de IA). La firma de la grabación (`configHash`) sirve de referencia.
- El audio de las sesiones es sensible: no se commitea.
