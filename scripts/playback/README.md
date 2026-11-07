# FLU Playback

Herramienta de depuración: reproduce el `audio.wav` de una sesión como micrófono
virtual y deja que la app FLU lo escuche con su motor normal.

No sustituye el ASR, no inyecta transcripciones y no escribe filas.

## Uso

```bash
npm run playback -- --session <carpeta> --dry-run
npm run playback -- --session <carpeta> --tail 5000
npm run playback -- --session <carpeta> --headed
```

- `--lead-in <ms>`: espera extra tras LISTENING.
- `--tail <ms>`: margen tras terminar el audio.
- `--out <carpeta>`: carpeta del resultado.
- `--url <url>`: app (default `http://localhost:5173`).
- `--headed`: navegador visible.

## Requisito de audio

La app debe poder oír el micrófono virtual. En este entorno se usa el motor
local ya existente de la app (Whisper); no se parchea el reconocedor. Si se usa
Chrome SpeechRecognition, hace falta un dispositivo de audio virtual del
sistema que Chrome vea como micrófono real.

## Límites

- Solo reproduce audio; no valida filas por comparación de guion.
- El micrófono virtual no se mezcla con el TTS.
- El audio de las sesiones es sensible: no se commitea.
