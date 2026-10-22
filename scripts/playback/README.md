# FLU Playback

Herramienta de soporte: reproduce el `audio.wav` de una sesion como microfono
virtual y deja correr la app real. No es una funcion de producto.

## Uso

```bash
npm run playback -- --session <carpeta> --mode clean-room --sr mute --dry-run
npm run playback -- --session <carpeta> --mode clean-room --sr mute --tail 1000
npm run playback -- --session <carpeta> --mode clean-room --sr real --headed
```

- `--mode clean-room`: crea solo el usuario activo minimo; no siembra el estado final.
- `--mode restore-start`: exige un snapshot `base-start`; no usa el `base` final.
- `--sr mute`: microfono virtual + SR mudo (headless, determinista).
- `--sr real`: dispositivo falso de Chrome + WAV con pad; requiere navegador visible.
- `--sr local`: no implementado en Fase 1.
- `--dry-run`: valida sesion y WAV sin abrir navegador.

## Artefactos

El directorio `--out` (por defecto `playbacks/<stamp>-<id>/`, ignorado por Git)
contiene `source/`, `rows.ndjson`, `ui.ndjson`, `events.ndjson`, `audio.json`,
`result.json` y, si se capturo, `recorder/`.

## Limites declarados

- Chrome SR no es determinista; `real` valida la vivencia, no una salida exacta.
- `mute` valida la tuberia de audio/recorder, no la transcripcion.
- El TTS de FLU no se mezcla en el microfono virtual.
- El solapamiento de voces no se separa.
- El audio y las transcripciones son sensibles: no se commitean.
