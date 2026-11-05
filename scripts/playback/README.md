# FLU Playback

Herramienta de soporte: reproduce el `audio.wav` de una sesion como microfono
virtual y deja correr la app real. No es una funcion de producto.

## Uso

```bash
npm run playback -- --session <carpeta> --mode clean-room --sr mute --dry-run
npm run playback -- --session <carpeta> --mode clean-room --sr mute --tail 1000
npm run playback -- --session <carpeta> --mode clean-room --sr real --headed
npm run playback -- --session <carpeta> --mode clean-room --sr script
```

- `--mode clean-room`: crea solo el usuario activo minimo; no siembra el estado final.
- `--mode restore-start`: exige un snapshot `base-start`; no usa el `base` final.
- `--sr mute`: microfono virtual + SR mudo (headless, determinista).
- `--sr real`: dispositivo falso de Chrome + WAV con pad; requiere navegador visible.
- `--sr script`: microfono virtual (WAV real) + reconocedor guionizado con los
  finales REALES de la sesion (`chrome-raw`), reubicados del reloj de pared al del
  WAV con el arranque de captura (`LOG:MicPcm`). Sustituye SOLO al reconocedor:
  audio, VAD, tramos, cierre y filas son los del producto. Motivo: la Web Speech
  API de Chrome no consume el dispositivo falso (`error:no-speech` a los ~8 s), asi
  que `real` no produce filas que medir. Medido 2026-10-31 (89a0d948): el microfono
  arranca 11,10 s despues de `meta.startedAt` y el commit del recorder llega hasta
  17 s despues de su final, asi que anclar al commit desplazaba cada final ~8,7 s.
  La corrida es valida solo si el guion se emitio completo (`scriptOk`).
- `--sr local`: no implementado en Fase 1.
- `--dry-run`: valida sesion y WAV sin abrir navegador.

## Artefactos

El directorio `--out` (por defecto `playbacks/<stamp>-<id>/`, ignorado por Git)
contiene `source/`, `rows.ndjson`, `ui.ndjson`, `events.ndjson`, `audio.json`,
`result.json` y, si se capturo, `recorder/`.

## Limites declarados

- Chrome SR no es determinista; en este equipo NI SIQUIERA oye el dispositivo falso
  (`error:no-speech`), asi que `real` hoy no produce filas: para medir transcripcion se
  usa `script` (reconocedor guionizado sobre el WAV real).
- `mute` valida la tuberia de audio/recorder, no la transcripcion.
- `script` reproduce los finales reales del reconocedor en la POSICIÓN del audio
  (`chrome-raw` reubicado con el arranque de captura), no el reloj de pared del
  commit. Si la sesión no tiene `chrome-raw`, cae a la ventana del commit
  (`audioEndSample`) y, en último recurso, al reloj de pared. El guion va anclado
  a la POSICIÓN del WAV en el reloj de audio: si el AudioContext se estrangula, la
  corrida espera por posicion y se declara invalida (`audioOk`) si el WAV no se
  consumio hasta el final.
- El TTS de FLU no se mezcla en el microfono virtual.
- El solapamiento de voces no se separa.
- El audio y las transcripciones son sensibles: no se commitean.
