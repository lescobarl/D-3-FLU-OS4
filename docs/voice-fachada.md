# Fachada del módulo de voz (R7)

**Regla:** `src/voice/lib/**` es interno. Ningún archivo de producción fuera de `src/voice`
importa una ruta profunda del módulo de voz.

La superficie pública son **módulos por concern** en `src/voice/api/`:

| Fachada | Qué expone |
|---|---|
| `api/config` | `fluConfig` (configuración y wake words) |
| `api/uiConfig` | `visualConfig`, `transcriptConfig`, `fluParticipantConfig` |
| `api/audio` | `audioMath`, `asr/resample`, `pcmChunks` + cargadores perezosos de Whisper |
| `api/speech` | `fluSpeech` (TTS) y `speechRecognitionLocal` (ASR) |
| `api/conversation` | filas de conversación, diálogo, paridad, `navSettleFlag` |
| `api/identity` | firmas, clusters, directorio de voces, anclas de participantes |
| `api/commands` | ids/gramática de comandos, árbitro determinista, comandos de juego |
| `api/storage` | `fluStorage` (Dexie/UI) |
| `api/sessionLog` | `sessionRecorder` (solo grafo seguro para servidor) |
| `api/media` | generación de imagen/vídeo y diagnóstico de gemini |
| `api/workers` | puente de workers |
| `api/server` | `gemini` y `audioConstants` (SÓLO dev-server) |

No hay un barrel único a propósito: un `index` que re-exporte todo obliga a cada
consumidor a evaluar el grafo completo (el store, la identidad, el almacenamiento) al
importar `FLU_CONFIG`, rompe mocks parciales en tests y mete módulos de navegador en el
grafo del `vite.config`. Por eso la separación `config`/`sessionLog` (grafo del servidor)
frente a `storage`/`uiConfig`/`conversation` (cliente) es funcional, no cosmética.

Los módulos pesados (Whisper) se consumen por cargadores perezosos
(`loadWhisperWasmTranscriber`, `loadWhisperRecognitionEngine`) para que no entren en el
chunk de quien solo necesita configuración.

## Barrera

- `tests/voiceFacadeGuard.test.ts` (en `GUARD_FILES`): recorre `src/**` excepto
  `src/voice/**`, resuelve cada import/export-from/`import()` y falla si apunta a
  `src/voice/lib/**` (también vía `@voice/lib/...`). Exige ver >50 archivos (no es vacío),
  comprueba que las 12 fachadas existen y no usan `export *`, y prueba el detector con una
  entrada infractora y una limpia.
- Los tests pueden seguir importando internos de `src/voice/lib/**`: el guard mide
  **producción** (`src/**`), no el arnés de pruebas.
- El grafo del `vite.config` (dev-server) exige imports **con extensión**
  (`tests/viteConfigNativenessGuard.test.ts`): las fachadas y los middlewares la llevan.
