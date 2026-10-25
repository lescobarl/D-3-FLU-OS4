# LAE — Módulo CONVERSACIÓN

**Módulo nuevo desde cero. No se traduce, no se copia, no se adapta. Muere la tubería vieja, no `lib/**` completo.**

Incluye: hablantes, diarización, transcripción, conversación, caja y **flu playback**.
El panel, los comandos y el avatar solo usan la API pública. No se cambia el look & feel: solo el motor.

## 7 reglas

1. Entra PCM con su índice de muestra (`sampleRate` incluido).
2. **Primero se aplica el texto a la locución abierta; después se evalúa la frontera.** Si hay silencio ≥900 ms **y** llega texto ajeno → se cierra. El VAD mide; no decide.
3. Una locución abierta: el ASR la revisa o la extiende; **nunca pierde palabras**. Final del mismo tramo completa; final de otro tramo abre fila.
4. Al cerrar: hay tramo y hay texto → **una fila**; si no, descarte contado.
5. Etiqueta: nombre solo con medida/confirmación (`ok flu soy XXX`); si no, la anterior; si no, `Hablante 1`. Nunca `?`.
6. Caja = el texto de la locución abierta. **Nunca retrocede**: puede reemplazar palabras, pero una revisión que pierde palabras no se pinta. Solo el cierre la vacía.
7. Playback = lo mismo con otro `AudioSource`.

## Mecanismo de la regla 3

El **ingestor emite `tramoId` al cortar el buffer**; es el único id de la locución. No hay un segundo `locutionId`: `locutionId` = `tramoId`.

- **Mismo `tramoId` + más largo** → extiende. El prefijo **no** es obligatorio: el ASR puede corregir la primera palabra y alargar.
- **Mismo `tramoId` sin crecer** → revisa. Una revisión que pierde palabras no se pinta (guarda de no-pérdida).
- **`tramoId` distinto** → locución nueva.

## Fila

```ts
Fila {
  locutionId, sessionId, turnId,
  texto,
  tramo: { inicio, fin, sampleRate },
  etiqueta, evidencia,
  idioma,
  overlap,
  provisional,
  reason: 'user' | 'system' | 'watchdog',
  revision, updated_at, deleted
}
```

`[inicio,fin]` sin `sampleRate` no significa nada: captura 48 kHz, ASR/embedding 16 kHz. `locutionId` es el `tramoId` del ingestor; un solo id. El ingestor emite también `turnId`, que agrupa locuciones del mismo turno.

`provisional` lo consume el commit/auditoría para distinguir un cierre humano; se **promueve al llegar el final del mismo tramo**. Si el final no llega, queda provisional; el panel la muestra igual, sin cambio de look.

## Config (defaults)

| Clave | Default | Dueño |
|---|---:|---|
| `minSilenceMs` | 900 | frontera |
| `silenceCloseMs` | 5000 | frontera (silencio sin texto ajeno; ≈ `srGapCommitMs` 3,5 s + margen) |
| `orphanBufferMs` | 8000 | ingesta (ASR huérfano) |
| `asr.engine` | `auto` | ASR |
| `asr.lang` | `es` | ASR |
| `maxRetentionMin` | 120 | buffer/sesiones |
| `overlapMargin` | medir en Etapa 0 (`null`) | identidad |
| `conversation.engine` | `legacy` (`new` para probar) | arranque |

Sin estas claves no hay `900 ms`, ni `auto`, ni retención: sería hardcode. `overlapMargin` no se inventa: se mide en Etapa 0; sin medida, sin margen → continuidad. `conversation.engine` es la bandera de motor: `legacy` hasta que la pantalla esté validada; `new` sólo para probar, y con una sola implementación escribiendo filas.

## ASR y diarización

`asr.engine`: `auto` (default) · `cloud` · `local`.

- **`cloud`:** Chrome `SpeechRecognition`; `lang` = idioma activo de la app. El audio sale del equipo.
- **`local`:** Whisper WASM (`Xenova/whisper-tiny`). El audio no sale.
- **`auto`:** Chrome primero; degrada a Whisper solo si está habilitado (`voiceIdentity.capture.recognition.localFallbackEnabled`) y hay error `network`/`no-speech` o el reconocedor lleva **12 000 ms** mudo (+1 000 de margen, 2 rebuilds, 600 ms de habla, evaluación 1 000 ms). Recupera a Chrome a los **20 000 ms** o 3 segmentos; sonda 4 000 ms.
- **Gate de resultados locales:** final ≥180 ms de habla; parcial ≥300 ms.
- **VAD:** trama 30 ms, energía 0,02, habla mínima 450 ms, silencio 900 ms, segmento máximo 8 000 ms, pre-roll 180 ms.
- **Swap, no convivencia:** al cambiar de motor se suelta el anterior; nunca dos reconocedores activos.
- **Diarización:** local (`Xenova/wavlm-base-plus-sv`, 512-D, en worker). El audio no sale; solo se descargan los pesos la primera vez.

## API

**7 llamadas:** `start`, `stop`, `ingestAudio`, `ingestAsr`, `snapshot`, `subscribe`, `registerName`.
`snapshot()` incluye `fraseCanonica` y `fraseParaMostrar`.

**6 eventos:** `locution.closed`, `row.committed`, `speaker.labeled`, `box.updated`, `asr.status`, `barge.in`.

`stop(stopKind)`:

| stopKind | Resultado |
|---|---|
| `user` | provisional con tramo parcial; `reason:user`; se promueve con final del mismo tramo |
| `system` / `watchdog` | provisional si hay texto, `reason:system/watchdog`; si no, descarte contado |

`aborted` es estado del ASR (`asr.status`), no de la fila. Nunca se pierde en silencio.

## Hablantes y `ok flu soy XXX`

- Voz sin nombre → `Hablante N`; sin medida → continuidad; primera vez → `Hablante 1`.
- `ok flu soy XXX` = wake configurada + `soy <Nombre>`. Solo bautiza **a la voz que lo dijo**.
- El nombre se guarda como **perfil de voz persistente** (`VoiceProfiles`); la sesión puede reasignar, pero no bautizar otra voz.
- Sin medida suficiente no hay nombre: se conserva la continuidad.
- Muchas voces o solape → `overlap`, medida dominante. Sin margen → **continuidad**; un `Hablante N` nuevo solo con evidencia positiva de voz no registrada. Nunca “desconocido” ni nombre inventado.
- `?` solo transitorio; **nunca** en fila cerrada o persistida.

## Flu playback y barge-in

- Playback = misma tubería con otro `AudioSource` (micrófono o archivo).
- ASR determinista: stub/Whisper. Chrome en vivo se declara **NO COMPARABLE**.
- Fixture: `events.ndjson`, `turns.ndjson`, `audio`, `manifest.json`; aceptación `N/0/0`.
- **Barge-in: sí.** El eco es el portero y el módulo emite **`barge.in`**; el consumidor apaga `fluSpeech`. La voz de FLU no es fila del usuario.

## 6 archivos

```text
src/voice/conversation/
  index.ts       API
  frontera.ts    regla 2: cuándo cerrar
  revision.ts    regla 3: mismo tramo / revisa / extiende
  fila.ts        reglas 4–5: commit, etiqueta y modelo
  ports.ts       ASR, audio, embeddings, store, reloj, VAD
  adapters.ts    micrófono, archivo, ASR, embeddings, store
```

## Reglas de operación y repo

- Un **solo ASR** y un **solo escritor de fila** por sesión. `auto` elige uno al abrir con criterio: permiso de micrófono, modelo local disponible, latencia y configuración; no fallback en caliente. Sin permiso: `asr.status: no-permission` y no arranca.
- Una **cola de ingesta** ordenada por tiempo; ASR antes de locución se retiene, no se duplica. Si llega después del cierre: descarte contado o locución nueva; no se mezcla.
- **Frase canónica única**; wake solo para mostrar; IA y comandos reciben la misma.
- **Eco**: detector propio por comparación contra el último TTS (cobertura, sufijo, mínimo de palabras). `normalizeSpokenCommand` es higiene de comandos, no el eco. Barge-in consume el detector.
- **ASR lifecycle**: permiso, error y watchdog; locución abierta se cierra o se marca `aborted`.
- **Silencio sin texto ajeno**: cierra por `silenceCloseMs` (provisional o descarte contado). Es un segundo cierre, distinto de la frontera.
- **Buffer por locución** y retención para sesiones largas; no se usa el contador del turno.
- **Idioma**: cloud fija `lang` al arrancar; local puede autodetectar por locución.
- **Privacidad**: si `asr.engine: cloud`, el audio sale; se declara.
- **Datos viejos**: exportar y versionar antes del corte; no migrar a ciegas.
- **Logs**: apertura, cierre y motivo de descarte con `sessionId`, `locutionId` y tramo; `logCaughtError`, no `console.*`.
- **Imports**: config, splitter y TTS entran por **ports**; no se importa `api/*` mientras re-exporte `lib`.
- **Dos pestañas**: una pestaña activa escribe; la segunda es solo lectura. Sin lock, se declara.
- UUIDv4, tupla `[revision, updated_at, deleted]`, borrado lógico, un solo escritor.
- Reloj inyectado; cero `Date.now()` dentro del módulo.
- Sin imports a la **tubería vieja** (`conversation*`, `transcriptIngress`, `speakerDiarization`, `activeListen`, `turnStream`).
- **No se borra** `FLU_CONFIG`, `fluStorage`, `fluSpeech`, el splitter de wake, comandos, TTS ni agenda. Muere la tubería, no el resto de `lib/**`.
- Sin hardcode, sin excepciones, sin triage que se autoaprueba.

## 3 pasos

1. Dominio con pruebas. Primero `ports`/`adapters`; `revision.ts` antes de `index.ts`.
2. Cablear detrás de bandera: el producto usa la API nueva. Si la pantalla no da paridad, se apaga la bandera, vuelve el motor viejo y las filas nuevas se conservan con su `sessionId`.
3. Borrar la tubería vieja completa.

## Aceptación

- 0 missing, 0 extra **contra el fixture `N` congelado**.
- Dos voces reales → dos etiquetas.
- `ok flu soy XXX` → nombre solo a la voz que lo dijo; perfil persistente.
- Caja sin pérdidas, sin acortes, sin congelación.
- **Flu playback** sobre fixture → `N/0/0`; Chrome en vivo no comparable.
- `stop()` a media frase → provisional o descarte, nunca pérdida.
- Barge-in: FLU habla, usuario interrumpe, eco no genera fila.
- Guards en `tests/*.test.ts`, uno por regla, con prueba de mutación.
- `typecheck`, `lint`, `build`.
- Pantalla validada: dictado normal, dos voces, silencio largo, dos locuciones sin pausa.
- Tubería vieja borrada; no así config, storage, TTS, wake, comandos ni agenda.

## Riesgos reales

- Techo del micrófono con muchas voces; `overlap` se declara.
- Idioma fijo en cloud; Whisper local sí autodetecta.
- Playback Chrome no comparable: solo stub/Whisper.
- Sin grabación no hay `N` ni aceptación reproducible.

## Lo difícil

El cutover: 74 consumidores, 49 tests montando el hook y `useFluVoiceAssistant` de 4.471 líneas. Se resuelve cableando y borrando, no con más prosa.
