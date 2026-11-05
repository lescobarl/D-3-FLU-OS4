# Plan — Arnés de comparación ASR (Android/offline)

- **Estado:** LISTO PARA MEDIR. Laboratorio dev en `src/dev/asrLab/`, **no afecta producción**.
- **Hecho:** `vosk-browser` instalado (devDependency) + modelo ES en
  `public/models/vosk-es/vosk-model-small-es-0.42/` (57.5 MB, servido en dev).
- **URL del lab:** `http://localhost:5173/asr-lab` (dev).
- **Objetivo:** decidir con números el mejor transcriptor para **Android + offline + 1 sola captura**.

## Candidatos
| Candidato | Estado | Deps |
|---|---|---|
| **Chrome SR** (referencia) | listo (nativo) | ninguna |
| **Whisper tiny/base** (referencia) | listo (ya integrado) | `@huggingface/transformers` |
| **Vosk** (`vosk-browser`) | adaptador lazy | `npm i vosk-browser` + modelo ES |
| **sherpa-onnx** (WASM) | documentado | vendorizar WASM + modelos ONNX |

## Métricas (mismo audio, misma máquina)
1. Latencia: fin de captura → texto (y primer interim si aplica).
2. Precisión: comparación contra texto esperado (aciertos/errores).
3. Offline: repetir en **modo avión**.
4. CPU/batería.

## Cómo usarlo
1. `npm run dev` y abrir `http://localhost:5173/asr-lab`.
2. Grabar una frase; corre cada motor y muestra latencia + texto.
3. Repetir 10 frases fijas, con y sin red.

## Decisiones
- Ganador por **(latencia, precisión, offline)**.
- Si Vosk/sherpa ganan → reemplazar **solo el transcriptor** detrás del contrato actual (misma captura PCM, misma unificación). No hay "otra ruta".
- Requiere actualizar `AGENTS.md §4` (hoy dice "Whisper WASM").

## Riesgos
- `vosk-browser` 0.0.8 (antiguo) puede necesitar ajuste de bundling.
- Modelo ES de Vosk (~40-50 MB) debe servirse (p. ej. `public/models/vosk-es/`).
- sherpa-onnx web no es paquete npm: se vendoriza.
- No validado en Android desde acá: la corrida la hace el usuario.
