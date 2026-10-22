# FLU Playback

**Tipo:** herramienta de soporte (dev/QA), no funcionalidad de producto.  
**Estado:** FASE 1 IMPLEMENTADA. Micrófono virtual, clean-room/mute/real, captura y CLI. Pendiente: restore-start validado con una grabación base-start, diff UI avanzado y local.
**Ejecutor previsto:** Kilo.  
**Fecha:** 2026-10-21.  
**Relación con otros proyectos:** independiente del runner determinista de filas/caja (`npm run replay`), que ya está cerrado y commiteado. FLU Playback usa el **audio** y el **micrófono virtual**; no reinyecta texto ni eventos.

---

## 1. Objetivo

Permitir que una grabación real de una sesión de FLU se reproduzca **como si fuera el micrófono**, en tiempo real, para que la aplicación ejecute su flujo normal:

`getUserMedia -> AudioWorklet -> PCM -> VAD -> ASR -> ingress -> commit -> caja -> diarización -> UI`

La herramienta debe:

1. Abrir la app limpia.
2. Restaurar solo el **estado inicial** que existía antes de grabar.
3. Esperar a que la app esté escuchando.
4. Reproducir el `audio.wav` por un micrófono virtual.
5. Capturar todo lo que produce la app durante la reproducción.
6. Dejar artefactos y un diff legible para que el agente (Kilo/Goose) analice sin que el dueño tenga que repetir la prueba.
7. Restaurar el micrófono real y cerrar limpio.

El objetivo del dueño es **grabar una vez** y que el agente pueda reproducir y analizar muchas veces.

---

## 2. Principios

1. **No es un motor nuevo.** Es un arnés alrededor de `getUserMedia`; la lógica de la app no se toca.
2. **El audio es la única entrada de la conversación.** No se inyectan filas, textos, vectores ni etiquetas.
3. **Participantes y hablantes se descubren en la conversación.** No se siembra el resultado final.
4. **Un solo dueño por pieza:** un CLI, un micrófono virtual, un cargador de sesión, un capturador, un comparador, un reporte.
5. **No hardcode:** sesión, rutas, sample rate, pad, umbrales y modos por argumento/config.
6. **No parches:** si falta un dato para ser fiel, se declara; no se inventa un OK.
7. **Privacidad:** audio y vectores son biometría. Local, consentido, con retención y sin commit.

---

## 3. Alcance

### Incluye

- CLI `npm run playback -- ...`.
- Micrófono virtual desde `audio.wav`/`audio.pcm`.
- Espera a `LISTENING` y `leadIn` opcional.
- Modos de estado inicial: `clean-room` y `restore-start`.
- Modos de reconocimiento: `real` (Chrome SR), `mute`, `local` (etiquetado no-producción).
- Captura de audio, eventos, turnos, filas, caja/UI, errores y manifiesto.
- Diff fuente vs reproducción para filas, hablantes y caja.
- Tests de humo, arranque, limpieza y no-siembra.
- Documentación y retención.

### No incluye

- Cambiar ASR, VAD, diarización, commit, caja, hablantes o UI de producto.
- Reinyectar eventos o `expected.json` (eso es `npm run replay`).
- Separar voces solapadas o hacer source separation.
- Generar goldens automáticos.
- Probar TTS/eco real salvo fase opcional de mezcla de TTS.
- Reproducir audio en producción para usuarios finales.

---

## 4. Estado actual aprovechable

| Pieza | Dónde | Qué aporta |
|---|---|---|
| Recorder de sesión | `src/voice/lib/sessionRecorder.js` | `audio.pcm`, WAV, eventos, turnos, manifest, control y descarga |
| Sink de disco | `src/server/recorderSink.ts` | `audio.pcm`, `audio.wav`, `events.ndjson`, `turns.ndjson`, `manifest.json`, `meta.json`, `control.json` |
| Stub de micrófono | `tests/e2e/replay45aeb8e2-audio.spec.ts:38-64` | Sustituye `getUserMedia` por un `MediaStream` construido desde WAV con Web Audio |
| Helpers e2e | `tests/e2e/_helpers.ts` | `gotoClean`, `autoSkipOnboarding`, `stubLocalSpeech` |
| Snapshots de turno | `turns.ndjson` | `base`, `commit`, `resolved`; firma 512-D, clusters, hablantes |
| Manifiesto | `manifest.json` | `schemaVersion`, `appCommit`, `configHash`, `modelIds`, `language`, `sampleRate` |
| Runner determinista | `scripts/replay/*` | Ya cerrado; **no se reutiliza para playback**, salvo comparadores puros si aplica |

### Huecos actuales

1. El e2e existente está atado a `45aeb8e2`, a un WAV pad de 90 s y a rutas fijas.
2. Siembra **todos** los participantes del snapshot `base`, incluidos vectores aprendidos durante la sesión. Eso pre-resuelve la diarización y no es fiel.
3. No hay un snapshot `base-start` garantizado al inicio de la grabación.
4. No hay CLI genérico ni ciclo play/stop/restauración.
5. No hay captura de la secuencia de caja/UI como artefacto de primera clase.
6. No hay diff fuente vs reproducción para filas/hablantes/caja.
7. No hay política de retención/limpieza ni documentación de modos.
8. `real` con Chrome SR puede no funcionar en headless/CI; falta declararlo y ofrecer `mute`.
9. El TTS de FLU no entra en el micrófono virtual salvo mezcla explícita.
10. El recorder en memoria está limitado a 10 min/20k eventos; el sink en disco tiene tope de 2 GB. La sesión de reproducción debe ser un directorio nuevo.

---

## 5. Arquitectura propuesta

```
scripts/playback/
  playback.mjs             # CLI: args, validación, exit codes, orquestación
  loadSession.mjs          # lee manifest/meta/turns/audio; valida schema y rutas
  initialState.mjs         # clean-room / restore-start; NUNCA siembra el final
  virtualMic.mjs           # WAV -> AudioContext -> MediaStreamDestination -> getUserMedia
  browser.mjs              # Playwright: abrir app, esperar LISTENING, play, stop, cleanup
  capture.mjs              # enciende recorder, copia artefactos, ui.ndjson
  diff.mjs                 # fuente vs reproducción (filas, hablantes, caja)
  report.mjs               # report.json + report.md + tabla consola
  README.md                # uso, modos, límites, privacidad
```

Un solo dueño por pieza. No se crea un segundo micrófono, un segundo recorder ni un segundo comparador de filas. Si se reutiliza `sourceRowDiff` del runner, se importa; no se copia.

### Flujo

1. Validar sesión y argumentos.
2. Crear directorio de playback.
3. Abrir navegador y app con estado inicial elegido.
4. Instalar el micrófono virtual **antes** de que la app pida `getUserMedia`.
5. Esperar `LISTENING` (o `leadIn` si se pidió).
6. Iniciar el WAV en tiempo real.
7. Enciende la captura de sesión en un directorio nuevo.
8. Esperar fin del audio + margen de cierre.
9. Detener el micrófono, restaurar `getUserMedia`, cerrar el navegador.
10. Escribir artefactos y diff.
11. Salir con código 0/1/2 según resultado.

---

## 6. Entradas de una sesión

Ruta por argumento: `--session <carpeta>`.

Archivos obligatorios:

- `manifest.json`: `schemaVersion`, `sampleRate`, `samples`, `seconds`, `events`, `turns`, `audioBytes`.
- `meta.json`: `startedAt`, `language`, `userAgent`, `url`.
- `audio.wav` o `audio.pcm` + `manifest.sampleRate`.
- `turns.ndjson`: para estado inicial y diff.
- `events.ndjson`: para contexto y diff.

Archivos opcionales:

- `base-start.ndjson` o un turno `kind: "base-start"` en `turns.ndjson`.
- `expected.json`: solo si se quiere regresión; no requerido para soporte.

Validaciones de entrada:

- `schemaVersion` soportada.
- Audio con bytes > 0 y duración coherente con el manifiesto.
- `turns.ndjson` parseable.
- Si falta audio o manifiesto: exit 2, mensaje claro, sin abrir la app.
- Si falta fidelidad (`appCommit`, `configHash`, `modelIds`): advertencia visible; no bloquear el playback de soporte.

---

## 7. Estado inicial: la decisión clave

### 7.1 `restore-start`

Restaura **solo** lo que existía al empezar la grabación:

- participantes ya registrados al inicio;
- usuario/persona activa si la app lo exige;
- idioma/config/epoch iniciales.

No restaura:

- etiquetas `Hablante N`/nombres asignados durante la conversación;
- vectores aprendidos durante la sesión;
- filas, turnos, caja o directorio final;
- participantes que aparecieron en la conversación.

Requisito: un snapshot `base-start` capturado al inicio. Si no existe, `restore-start` no es válido.

### 7.2 `clean-room` (por defecto si no hay `base-start`)

- No siembra participantes de la conversación.
- Solo crea el usuario/persona activa mínimo que la app exija para funcionar, sin vector de voz aprendido en la sesión.
- Si la app puede arrancar sin usuario, no crea ninguno.
- El audio debe descubrir a todos los hablantes.

### 7.3 Regla anti-leak

Prohibido usar el `base` final de `turns.ndjson` para sembrar participantes. El `base` final puede contener a la mujer descubierta durante la sesión y su vector; sembrarlo convierte la prueba en un escenario distinto.

Si el snapshot no distingue inicio/final:

- no se siembra;
- se marca `fidelity: "base-start-missing"`;
- el reporte lo declara.

---

## 8. Micrófono virtual

### 8.1 Implementación

Instalar en la página, antes de cargar la app:

1. Leer el WAV por una URL temporal servida desde disco (`page.route`) o por `fetch` de un blob.
2. `AudioContext.decodeAudioData`.
3. `AudioBufferSourceNode -> MediaStreamAudioDestinationNode`.
4. Devolver `dest.stream` desde `navigator.mediaDevices.getUserMedia({ audio: true })`.
5. Cachear el `streamPromise` para que múltiples llamadas de la app devuelvan el mismo stream.
6. Al terminar: `source.stop()`, `ac.close()`, restaurar `getUserMedia`.

No se toca el AudioWorklet, el VAD, el ASR ni el commit.

### 8.2 Arranque

- Esperar el estado `LISTENING` real de la app antes de `source.start()`.
- Si no se puede observar `LISTENING`, usar `--lead-in <ms>` con silencio al inicio o un WAV con pad.
- No hardcodear 90 s; el pad es un argumento.
- Registrar `playbackStartedAt` y `listeningAt` en el manifiesto.

### 8.3 Fin

- Esperar `audio.duration` + `--tail <ms>` (por defecto el cierre de la app, p. ej. 4-6 s).
- Detener fuente y stream.
- Restaurar `getUserMedia`.
- Cerrar navegador y contexto.

---

## 9. Modos de reconocimiento

| Modo | Qué hace | Fidelidad | Uso |
|---|---|---|---|
| `real` | Chrome SpeechRecognition real sobre el micrófono virtual | Alta, no determinista; puede requerir headed/red | Validación de producto |
| `mute` | SR mudo que arranca y no emite | Determinista para el escenario Chrome mudo | Probar cierres/rebuild |
| `local` | Whisper local sobre el audio | No es la política de producción | Diagnóstico offline; etiquetado |

`real` debe declarar si el navegador no soporta SR o si corre headless. Nunca fingir que `local` es `real`.

---

## 10. CLI previsto

```bash
npm run playback -- \
  --session <carpeta> \
  --mode clean-room|restore-start \
  --sr real|mute|local \
  [--lead-in 0] \
  [--tail 5000] \
  [--out <carpeta>] \
  [--url http://127.0.0.1:5173] \
  [--headed|--headless] \
  [--timeout 300000] \
  [--no-capture] \
  [--keep-open]
```

Reglas:

- Sin `--session`: exit 2.
- `--out` por defecto: `<repo>/playbacks/<timestamp>-<sessionId>` o `%TEMP%/flu-playbacks/...`; configurable.
- `--mode` por defecto: `clean-room`; `restore-start` exige `base-start`.
- `--sr` por defecto: `mute` en headless/CI, `real` en headed.
- `--timeout`: aborta con exit 2 y limpia.
- Exit codes:
  - `0`: reproducción completada y artefactos escritos.
  - `1`: reproducción completada con hallazgos/diferencias.
  - `2`: sesión inválida, timeout, navegador/SR no disponible o error de arranque.

---

## 11. Captura y artefactos

Directorio de playback:

```
playbacks/<timestamp>-<sessionId>/
  manifest.json          # fuente, modo, sr, versiones, duración, hashes
  source/                # referencia: copia o enlace de la sesión fuente
  audio.wav              # audio reproducido (o copia del fuente)
  playback.wav           # audio capturado por el recorder, si se captura
  events.ndjson          # eventos de la reproducción
  turns.ndjson           # turnos/commits de la reproducción
  ui.ndjson              # cada actualización de caja/filas/hablantes
  rows.ndjson            # filas finales normalizadas
  errors.log             # pageerror/console/errores de captura
  report.json            # métricas y checks
  report.md              # resumen legible
  screenshots/           # opcional: estados clave
```

### `ui.ndjson`

Una entrada por actualización visible:

```json
{ "t": 1234, "kind": "box", "text": "...", "reason": "publish|clear|revision" }
{ "t": 1250, "kind": "row", "id": "...", "text": "...", "speaker": "Hablante 1" }
```

Fuente preferida: instrumentación dev del dueño de la caja/commit (un `recordSessionEvent`), no un observador DOM frágil. Si no se puede, usar un observer de Playwright como respaldo declarado.

### Captura

- Encender `sessionRecorder` al inicio del playback, en un directorio/ID nuevos.
- No reutilizar el directorio fuente.
- Copiar/renombrar artefactos al directorio de playback al terminar.
- Si `--no-capture`, solo escribir manifiesto y reporte básico.
- Respetar límites del recorder; si se superan, declararlo.

---

## 12. Diff fuente vs reproducción

No es un golden escrito a mano. Es una comparación diagnóstica:

- **Filas**: fuente (`turns.ndjson` commits) vs reproducción; clasificar duplicados de fuente, faltantes únicos, extras justificados/no justificados y variantes de ASR. Reutilizar el dueño `sourceRowDiff` existente; no duplicarlo.
- **Hablantes**: etiquetas fuente vs reproducción; cobertura, aciertos, mismatches, omitidos por falta de vector/duración. Nunca usar la etiqueta fuente como input.
- **Caja**: secuencia fuente (si se capturó) vs reproducción; duplicación, congelación, pérdida. Reutilizar los checks de caja del runner si son puros; no copiar la lógica.
- **Audio**: duración, sample rate, bytes, relación con el manifiesto.
- **Errores**: pageerror, excepciones, timeouts.

El reporte debe distinguir:

- diferencia esperada por ASR no determinista;
- diferencia real de flujo;
- dato faltante/no concluyente.

Nunca marcar OK si falta evidencia.

---

## 13. Privacidad y retención

- Grabaciones y vectores son datos biométricos.
- Default: apagado; el agente enciende explícitamente.
- Solo local; sin subida a nube.
- Consentimiento explícito del dueño antes de capturar.
- Retención por defecto: borrar tras N días o al cerrar el caso; configurable.
- No commitear audio, transcripciones, vectores ni `expected` reales.
- `.gitignore` para `playbacks/`, `flu-recordings/`, `*.wav`, `*.pcm` si se descargan al repo.
- Redactar logs/reportes que se compartan; no incluir transcripción completa salvo necesidad.
- Si se comparte un caso, usar un recorte mínimo o una fixture sintética.

---

## 14. Fidelidad y límites declarados

1. **Chrome SR no es determinista.** El mismo audio puede dar textos distintos. `real` valida la experiencia, no una salida exacta.
2. **Headless/CI** puede no tener Chrome SR; `real` se salta con motivo y `mute` queda como modo determinista.
3. **TTS/eco**: el micrófono virtual solo tiene el audio grabado. Si FLU habla, su voz no entra en el micrófono salvo que se mezcle explícitamente la salida TTS.
4. **Tiempo real**: una sesión de 150 s tarda ~150 s. No se acelera con Chrome SR real.
5. **Solapamiento**: el audio con dos voces simultáneas se reproduce, pero la diarización puede no separarlas; eso es límite del producto, no del playback.
6. **Estado inicial**: si no hay `base-start`, `restore-start` no es válido; se usa `clean-room` y se declara.
7. **Snapshots finales**: nunca se usan para sembrar; si se usan, la prueba no es fiel.
8. **Recorder**: 10 min en memoria y 2 GB en disco; sesiones largas pueden truncar/limitar; declararlo.
9. **Schema 1**: grabaciones viejas con fidelidad unknown solo sirven para observación, no para golden.

---

## 15. Fases de implementación

### Fase 0 — Este documento

- Plan completo, sin código.
- Revisión y aprobación del dueño.

### Fase 1 — Micrófono virtual genérico + CLI base

Entregables:

- `scripts/playback/playback.mjs`, `loadSession.mjs`, `virtualMic.mjs`, `browser.mjs`.
- `npm run playback`.
- Abrir app limpia, esperar `LISTENING`, reproducir WAV, cerrar limpio.
- `--session`, `--mode`, `--sr`, `--lead-in`, `--tail`, `--timeout`.
- Tests: WAV inválido, sin sesión, timeout, arranque/cierre, restauración de `getUserMedia`.

Aceptación:

- Una sesión corta se reproduce y la app recibe PCM (recorder/status > 0).
- No se toca el código de producto.
- No se siembra ningún participante final.

### Fase 2 — Estado inicial y no-siembra

Entregables:

- `initialState.mjs`.
- `clean-room` y `restore-start`.
- Requisito `base-start`; si falta, clean-room + warning.
- Tests con una sesión donde el `base` final tiene un nombre/vector que no existía al inicio: el playback no debe pre-cargarlo.

Aceptación:

- El audio descubre a los hablantes; no se inyectan etiquetas/vectores finales.
- El reporte marca `fidelity: base-start-missing` cuando aplica.

### Fase 3 — Captura UI/caja y diff

Entregables:

- `capture.mjs`, `ui.ndjson`, `rows.ndjson`.
- `diff.mjs`, `report.json`, `report.md`.
- Reutilizar comparadores existentes; no duplicar.
- Tests de caja: prefijo creciente, bloque duplicado, congelación, pérdida; filas: duplicados/faltantes/variantes.

Aceptación:

- El reporte muestra fuente vs playback y distingue duplicado de pérdida.
- No marca OK sin evidencia.

### Fase 4 — Modos real/mute/local, repetición y TTS opcional

Entregables:

- `real` con Chrome SR headed; `mute`; `local` etiquetado.
- Repetición de la misma sesión sin reiniciar.
- Mezcla opcional de TTS en el micrófono virtual (detrás de flag).
- Documentación de límites/CI.

Aceptación:

- `mute` reproducible en headless.
- `real` se salta con motivo si no hay SR.
- Dos ejecuciones seguidas no dejan micrófono/stream colgados.

### Fase 5 — Validación con sesiones reales

- Probar con `<d4c1c8f3>` y `<45aeb8e2>`.
- Reproducir, capturar, diff y revisar con el agente.
- Ajustar lead-in/tail y documentar resultados.
- No commitear audio/transcripción real.

---

## 16. Tests y criterios de aceptación

### Tests unitarios

- Loader: manifest ausente/incompleto/schema inválido/audio vacío.
- Selección de estado: `restore-start` sin base-start falla; `clean-room` no siembra final.
- WAV: sample rate/canales/duración; WAV corrupto.
- CLI: args, exit codes, timeout, `--no-capture`.
- Diff: filas/faltantes/extras/variantes; caja duplicada/congelada/pérdida; no falsos OK.
- Privacidad: no escribir fuera de `--out`; no commit.

### Tests de integración/e2e

1. **Sesión corta, `clean-room`, `mute`:** app arranca, espera `LISTENING`, reproduce, captura, termina 0, restaura micrófono.
2. **No-siembra:** sesión con `base` final que incluye mujer/vector; playback no la precarga; el audio debe descubrirla.
3. **`restore-start`:** con base-start válido, restaura solo lo inicial.
4. **Sin grabación:** exit 2, sin abrir app.
5. **Timeout:** exit 2, navegador cerrado, procesos limpios.
6. **Repetición:** dos ejecuciones seguidas; no queda stream/worker/micrófono colgado.
7. **`real`:** headed con Chrome SR; si no hay SR, skip declarado; no fingir.
8. **Captura UI:** `ui.ndjson` contiene actualizaciones de caja y filas; el diff las usa.
9. **Regresión de producto:** con el audio real, comparar fuente vs playback; cualquier diferencia se clasifica, no se oculta.

### Criterio de cierre de FLU Playback

- Un comando reproduce cualquier sesión con `clean-room` o `restore-start`.
- Espera `LISTENING`; no pierde el inicio por arranque.
- No siembra estado final.
- Captura artefactos completos y reporte.
- Restaura el micrófono y no deja procesos.
- Exit codes claros.
- Tests/gate/build verdes.
- Documentación de modos, límites y privacidad.
- El dueño solo valida visualmente; el agente puede repetir el análisis sin él.

---

## 17. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Chrome SR no disponible/headless | Modo `mute`; skip declarado; `real` headed |
| Primeros segundos perdidos | Esperar `LISTENING`; `lead-in` configurable |
| Sembrar el estado final | `base-start`/clean-room; tests de no-siembra |
| Audio/vectores sensibles | default off, local, retención, no commit |
| Sesiones largas | límites del recorder; chunks; declarar truncado |
| TTS no incluido | flag de mezcla TTS, documentado |
| Solapamiento | límite de producto; no prometer separación |
| Micrófono no restaurado | cleanup en `finally`; test de repetición |
| Falsa sensación de validación | el reporte distingue observación, partial y error |

---

## 18. Decisiones abiertas

1. **Runner:** CLI standalone con Playwright o spec e2e dedicada. Recomendación: CLI standalone `scripts/playback` que pueda correr también en CI.
2. **`base-start`:** añadir snapshot al inicio del recorder (recomendado) o aceptar clean-room para grabaciones viejas.
3. **UI:** instrumentación dev del dueño de la caja (preferido) o DOM observer de Playwright (respaldo).
4. **TTS/eco:** fase opcional; no bloquea el MVP.
5. **Retención:** días por defecto y ubicación (`%TEMP%` vs repo/playbacks).
6. **Reutilización del diff:** importar `sourceRowDiff`/checks del runner o extraer un módulo compartido; nunca copiar.
7. **Golden:** opcional; el soporte no lo requiere. Para regresión, usar sesiones schema 2 y expected aprobado.

---

## 19. Comandos previstos

```bash
# Listar/validar una sesión
npm run playback -- --session "%TEMP%/flu-recordings/<id>" --dry-run

# Reproducción limpia, SR mudo (determinista)
npm run playback -- --session "%TEMP%/flu-recordings/<id>" --mode clean-room --sr mute

# Reproducción con estado inicial (si hay base-start)
npm run playback -- --session "%TEMP%/flu-recordings/<id>" --mode restore-start --sr mute

# Reproducción con Chrome SR real (headed)
npm run playback -- --session "%TEMP%/flu-recordings/<id>" --mode clean-room --sr real --headed

# Salida explícita y timeout
npm run playback -- --session "<dir>" --out "playbacks/caso-01" --timeout 300000
```

---

## 20. No objetivos explícitos

- No es `npm run replay`: ese runner es determinista por eventos/expected y ya está cerrado.
- No es una feature de usuario.
- No arregla productos por sí solo: descubre diferencias y las deja medidas.
- No sustituye la validación visual del dueño.
- No promete diarización perfecta ni separación de solapamiento.

---

## 21. Definición de terminado

FLU Playback estará terminado cuando:

1. `npm run playback -- --session <dir> --mode clean-room --sr mute` funcione de punta a punta.
2. `restore-start` funcione solo con `base-start` y nunca siembre el final.
3. La app reciba el audio por su tubería real y produzca filas/caja.
4. Los artefactos (`audio`, `events`, `turns`, `ui`, `rows`, `report`) existan en `--out`.
5. El diff fuente vs playback clasifique filas, hablantes y caja sin falsos OK.
6. El micrófono se restaure y no queden procesos/streams.
7. `real` y `mute` estén etiquetados; `real` se salte con motivo si no hay SR.
8. Tests, typecheck, lint, gate y build estén verdes.
9. La documentación de privacidad, retención y límites esté en el README.
10. El dueño solo tenga que validar la pantalla; el agente pueda repetir el análisis sin él.

---

## 22. Registro

- **2026-10-21:** creado el plan. Sin implementación. Pendiente aprobación del dueño.

---

## 23. Estado de implementación (2026-10-21)

- Implementado: npm run playback, loader de sesión/WAV, micrófono virtual, clean-room, mute, real con dispositivo falso de Chromium, captura de filas/UI/eventos/recorder, --dry-run, timeout y tests del CLI.
- Validado: mute con tests/fixtures/playback/mini; real con un recorte de 10 s de una grabación real (3 filas, 8 actualizaciones de caja, 0 pageerrors).
- Pendiente: restore-start real (no hay base-start en las grabaciones actuales), local, diff UI fuente/playback y validación visual del dueño.
- Sin commit de esta implementación todavía.
