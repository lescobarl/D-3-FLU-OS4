# Contrato — Transcripción con Whisper local como respaldo de Chrome

**Estado:** propuesta cerrada para ejecución. **No implementa nada por sí solo.**
**Alcance:** recuperar el texto que Chrome no transcribe (voz baja/lejana, turno largo, final truncado) sin reintroducir las alucinaciones que motivaron el paso a Chrome.

---

## 1. Decisión de arquitectura

**Chrome sigue siendo el transcriptor primario y el dueño de comandos. Whisper local entra como respaldo por tramo, solo cuando el final de Chrome es vacío o de rendimiento implausible para el audio, y su texto nunca ejecuta acciones.**

Flujo:

```text
PCM de la app
  ├─ Chrome: parciales en vivo + wake/commands
  └─ VAD/tramo cierra
       ├─ Chrome final
       ├─ ¿final vacío o palabras/segundo por debajo del umbral?
       │    ├─ NO → se usa Chrome (flujo actual)
       │    └─ SÍ → Whisper local sobre el audio del tramo
       │              ├─ puerta anti-alucinación
       │              ├─ pasa → texto local = final de la fila
       │              └─ falla → Chrome (o sinTexto)
       └─ commit de UNA fila, por el escritor actual
```

**Por qué así y no local-first:** local-first vuelve a exponer todas las alucinaciones. El respaldo por tramo solo se activa donde Chrome ya falló, y la puerta descarta silencio/ruido. Para comandos no cambia nada: local no es accionable.

**Solución estructural (en paréntesis):** (cerrar el tramo por duración máxima cuando haga falta y **esperar el final local antes de commitear la fila**, sin escribir dos veces; Chrome para comandos/parciales, Whisper local como respaldo gateado del texto).

---

## 2. No objetivos

- No reemplazar Chrome como motor de comandos ni wake word.
- No crear un segundo store, segundo watchdog, segundo escritor de filas ni segunda ruta de ASR.
- No usar texto local para agenda/juegos/acciones.
- No correr la suite completa en local.
- No validar solo con mocks o tests sintéticos.

---

## 3. Dueños actuales (no crear otros)

| Responsabilidad | Dueño |
|---|---|
| Orquestación de motores/fallback local | `src/voice/hooks/useLocalAsrFallback.js` |
| Política/instalación del motor local y gate existente | `src/voice/lib/voiceLocalFallback.js` (`isLocalFallbackEnabled`, `classifyLocalResult`, `getLocalFallbackRuntimeConfig`) |
| Motor Whisper (parcial/final, cola) | `src/voice/lib/asr/whisperRecognitionEngine.js` |
| Transcriptor Whisper/worker | `src/voice/lib/asr/whisperWasmTranscriber.js`, `src/voice/workers/whisperAsr.worker.js` |
| Ingesta/cierre/commit de la locución | `src/voice/conversation/producto.ts`, `texto.ts`, `cierre.ts`, `fila.ts` |
| Espera de fila/turno | `src/voice/conversation/turnRowWait.ts` |
| Chrome / watchdog | `src/voice/hooks/useFluVoiceAssistant.js`, `src/voice/lib/asrWatchdog.js` |
| Comandos (compuerta de aceptación) | `extractFluVoiceCommand` / árbitro determinista existente |
| Configuración | `src/voice/lib/fluConfig.js` (`transcript.asr`, `restart`, `localFallbackEnabled`) |

Si el cambio requiere un archivo nuevo, **se detiene y se declara dueño + consumidor en `docs/OWNERS.md` antes de crearlo**. Preferencia: editar el dueño existente.

---

## 4. Reglas de oro

1. **Un solo escritor de filas:** el módulo de conversación. El respaldo local no inserta; entrega texto al mismo cierre.
2. **Una sola fila por tramo/turno:** el texto local se aplica al `turnId`/`tramoId` de ese tramo, no abre otra.
3. **El final local se espera antes del commit.** No se commitea con Chrome y luego se “actualiza” con local; eso rompe insert-only y duplica.
4. **La puerta manda:** si el texto local no pasa, no se escribe. Mejor `sinTexto` que una alucinación.
5. **Local no accionable:** ningún texto de origen local llega al árbitro de comandos. Solo Chrome + wake.
6. **Sin hardcode:** umbrales, modelo, timeout y gate en `FLU_CONFIG`, no en el código.
7. **Un cambio a la vez, con prueba real.**

---

## 5. Disparador del respaldo local

Después del cierre de audio de un tramo y antes de commitear la fila:

- `audioSegundos = (tramo.fin - tramo.inicio) / sampleRate`
- `palabrasChrome = contarPalabras(textoFinalChrome)`
- Se activa local si:
  - `textoFinalChrome` está vacío, **o**
  - `palabrasChrome < minPalabras` (config), **o**
  - `palabrasChrome / audioSegundos < minPalabrasPorSegundo` (config), **o**
  - Chrome no emitió final (`sinTexto`) pero el tramo tiene voz medida.
- Si Chrome ya dio un texto plausible, **local no corre** (ahorra CPU y evita alucinaciones).

Config nueva en `transcript.localFinal` (valores iniciales a medir, no hardcode):
`enabled`, `modelId` (MEDIDO con b6d82bca, 2026-11-13: `Xenova/whisper-tiny` fp32
tarda 7,2–8,1 s por tramo de 35,6/37,1 s; `Xenova/whisper-base` fp32 tarda
15,4–19,2 s y AGOTA `timeoutMs` 12000 en los dos tramos — con base el respaldo se
descartaría por timeout siempre), `timeoutMs`, `minPalabras`, `minPalabrasPorSegundo`, `minVozMs`.

### 5-bis. Fidelidad del texto local — MEDIDA ABIERTA (2026-11-14, decisión del dueño pendiente)

Medido con el camino de producción real (worker `whisperAsr.worker.js`, fp32,
`language:'es'`, `initialPrompt` del producto, `downsample` 48k→16k) sobre la
ventana exacta de los dos tramos de `b6d82bca` (`audioStartSample..audioEndSample`):

| tramo | audio | Chrome | tiny: latencia | tiny: palabras | base: latencia | base: palabras |
|---|---|---|---|---|---|---|
| `c7013264` | 35,57 s | 12 | 8,05 s | 113 | 15,4–16,0 s | 101 |
| `2ea145a2` | 37,09 s | 9 | 7,25 s | 109 | 15,3–19,2 s | 118 |

Medición independiente del arquitecto sobre la misma grabación: tiny da 141 y 175
palabras. Coincide en lo esencial: la CANTIDAD ya no se pierde; la FIDELIDAD no es
aceptable todavía. Muestras reales:

- tiny `c7013264`: «¡Oigo! ¡Oigal! ¡Elo no es en la obsala escuela! … Después de que me hayan atacado bilmente porque no había hecho del pacto escugado…»
- base `c7013264`: «¡Ay, oigan! El UNES entro psa la escuela. Back to the cojo. Después de que me haya atacado…»
- base `2ea145a2`: «Ok vamos a equipar la primera compra también estas plumas…» (Chrome: «Okay vamos a equiparla primero de estas plumas negras»)

Los dos ensucian y alucinan («Back to the cojo» aparece en base); base es algo más
coherente por frases, no limpio. Con la regla de reemplazo por palabras, ese texto
garbled sustituye al Chrome corto pero correcto: hay más contenido, no más
fidelidad.

Coste de cada opción (DECISIÓN DE PRODUCTO DEL DUEÑO — no tomada aquí):

- **a) tiny:** aparece mucho más, texto sucio; latencia 7–8 s dentro de `timeoutMs` 12000.
- **b) base + `timeoutMs` 20–25 s:** texto algo mejor (sigue sucio) y el cierre espera 15–19 s por tramo antes del commit: bloquea el turno y choca con §9.6.
- **c) motor local nativo (faster-whisper):** la única que da fidelidad y latencia; fuera de WASM/en navegador, exige runtime nativo (arquitectura nueva).

Estado del código hasta la decisión: `Xenova/whisper-tiny` + `timeoutMs` 12000, sin
cambios. La fidelidad queda **NO validada**. El Playback sigue **no validado en
vivo** por el ruteo de VoiceMeeter.

### 5-ter. DECISIÓN DEL DUEÑO (2026-11-14): opción c — sidecar nativo

`a` y `b` quedan DOCUMENTADAS y **no encendidas**: tiny devuelve más contenido pero
sucio (peor que una frase corta correcta) y base+20–25 s bloquea el turno 15–19 s.

- **Acción inmediata:** `transcript.localFinal.enabled = false` en el camino vivo
  (`LOCAL_FINAL_DEFAULTS.enabled`), y `preload()` no descarga el modelo con el
  respaldo apagado. El código de disparador/puerta/reemplazo (puntos 1 y 2 del
  arquitecto) queda intacto y probado.
- **Opción elegida:** `faster-whisper` small/medium (o `whisper.cpp`) en un
  sidecar local, integrado por el mismo `TranscriptorTramoPort`: misma puerta,
  misma fila, mismo commit. Sin sidecar, Chrome manda. Sin nube, sin 429,
  privacidad local.
- **Spike que decide (medido, no test sintético):** faster-whisper small/medium
  sobre los DOS tramos exactos de `b6d82bca`, mismo PCM. Criterio: **mejor texto
  que base y < ~5 s por tramo**. Si el texto sigue sucio, el cuello no es el
  modelo (es micrófono/sala → array/beamforming), no otro ASR.
- **Nada se commitea hasta que c pase esa medición.** La validación sigue siendo
  Playback/audio real.

### 5-quater. SPIKE faster-whisper — MEDIDO (2026-11-14): texto SÍ, latencia NO en este equipo

Equipo del spike: Intel i7-1355U (10C/12T), iGPU Intel Iris Xe, sin CUDA ni
`nvidia-smi`; Windows 11; Python 3.12.10; faster-whisper 1.2.1 / ctranslate2 4.9.0,
`device:"cpu"`, `compute_type:"int8"`; mismo PCM de `b6d82bca` (PCM16LE 48k→16k,
antialias boxcar), `language:"es"` + `initialPrompt` del producto, `vad_filter`
según fila. (El primer intento vía PyAV falló con `av` 19 — `metadata_errors` —:
el spike pasa float32 mono 16k directo, sin decodificador de contenedores.)

| configuración | `c7013264` (35,57 s) | `2ea145a2` (37,09 s) | palabras |
|---|---|---|---|
| small, beam 5, CPU int8 | 19,4 s | 21,7 s | 130 / 139 |
| small, beam 1 | 12,3 s | 12,0 s | 127 / 142 |
| small, beam 1, 8 hilos | 11,5 s | 11,2 s | 126 / 139 |
| small, batched (VAD, lote 8), 8 hilos | **8,9 s** | **9,3 s** | 117 / 123 |
| medium, beam 1, 8 hilos | 30,7 s | 33,0 s | 126 / 142 |
| referencia WASM: tiny / base / Chrome | 8,0 s / 15,4–16,0 s / — | 7,3 s / 15,3–19,2 s / — | 113/109 / 101/118 / 12/9 |

Texto, mismo tramo `c7013264`:

- base (WASM): «¡Ay, oigan! El UNES entro psa la escuela. Back to the cojo. Después de que me haya atacado…»
- small: «Hola, oigan, el lunes entramos a la escuela. Back to school hall. … Una mochila de este año. … Es de Loro Lemon, esta como guina, me agrada. También me pedí el bote de Loro Lemon para hacer match. …»
- medium: «… Es de Lululemon, está como guina…» (corrige el nombre propio).

small/medium producen una narración **coherente y seguible** (mochila, plumas,
lápicera, Isla del Padre); los errores que quedan son nombres propios/dialecto
(«Loro Lemon»→Lululemon en small), no garabato. `without_timestamps`+sin contexto
se probó y degrada (33 palabras): descartado.

**Veredicto contra el criterio del dueño:**

- *Mejor texto que base:* **SÍ**, sin ambigüedad. Y ya no es texto sucio: el audio
  se entiende, así que el cuello del spike **no** es micrófono/sala.
- *Por debajo de ~5 s por tramo:* **NO en este equipo.** Mejor caso medido:
  small batched 8,9 s (RTF ≈ 0,25). Para < 5 s hace falta RTF < 0,14.

El límite es de CÓMPUTO, no de modelo: este equipo no tiene GPU CUDA y no tiene
cadena de compilación para whisper.cpp+Vulkan (sin `cmake`, MSVC ni Vulkan SDK —
no se instala un toolchain completo por iniciativa propia). Para que c pase la
medición hace falta una de: (i) máquina/sidecar con GPU CUDA; (ii) build de
whisper.cpp con Vulkan sobre la iGPU (requiere instalar toolchain); (iii)
OpenVINO sobre Iris Xe (runtime distinto). Es decisión de infraestructura del dueño.

**Estado (superado por §5-quinquies):** con el tramo completo de 35 s c no pasaba
por latencia; §5-quinquies mide la ventana real de producto (12 s) y **c pasa**.
El respaldo vivo quedó APAGADO en ese momento (`LOCAL_FINAL_DEFAULTS.enabled:
false`, `preload()` gateado) y se encendió en §5-nonies tras la validación real.
Playback sigue **no validado en vivo** por el ruteo de VoiceMeeter.

### 5-quinquies. c CON VENTANAS DE 12 s — MEDIDO (2026-11-14): la prueba real de c

Corrección de alcance del dueño: el 8,9 s era el límite de un tramo de 35 s, no de
c. La app sigue cerrando locuciones de 35 s; con máximo de locución 12–15 s la
ventana que recibe el sidecar es de 10–15 s. Se mide small sobre los DOS tramos de
`b6d82bca` partidos en ventanas de 12 s y 10 s, mismo PCM, mismo `initialPrompt`,
CPU int8, 8 hilos, `beam_size=1`; 2 repeticiones por ventana y dos corridas (12 s).

| ventanas | tramo | latencias por ventana (2 corridas) | palabras |
|---|---|---|---|
| 12 s seq | `c7013264` (12+12+11,57) | 4,50/4,33 · 3,85/3,78 · 3,89/3,74 — 2.ª: 4,02/3,58 · 3,79/3,98 · 3,71/3,33 | 130 (igual en 2 corridas) |
| 12 s seq | `2ea145a2` (12+12+12+1,09) | 3,94/3,86 · 4,86/5,36 · 5,09/4,84 — 2.ª: 3,26/3,27 · 3,70/3,62 · 3,72/3,70 | 150 / 147 |
| 10 s seq | `c7013264` (10+10+10+5,57) | 3,65–4,46 | 133 |
| 10 s seq | `2ea145a2` (10×3+7,09) | 3,76–4,73 | 143 |
| 12 s VAD por lotes | `c7013264` | 2,6–4,4 | **105** |
| 12 s VAD por lotes | `2ea145a2` | 2,4–3,5 | **98** |

- **Latencia 12 s seq:** 3,3–5,4 s por ventana normal (mediana ≈ 3,8 s; 11 de 12
  repeticiones ≤ 5 s; un solo pico de 5,36 s que en la otra corrida fue 3,70 s).
  **Entra en el criterio de 4–5 s.**
- **Texto 12 s seq:** 130/147–150 palabras vs 126/139 del tramo completo,
  coherente y seguible; las costuras de 12 s cortan alguna frase («La neta ya…» /
  «Estás hasta la chat…») sin garabato. 10 s baja latencia pero EMPEORA el texto
  («Provectipores», «piscera», «es una familia»): 12 s es el punto de operación
  dentro del rango 10–12 s.
- **VAD por lotes, medido por ventana, NO es "igual de bueno":** pierde 25–30 %
  del texto (105/98 palabras; en una ventana desaparece «La pluma de la perra no
  puede faltar… llovero… El zipper»). La configuración que pasa es **secuencial
  por ventana**, no lotes.
- **Ventanas muy cortas son patológicas:** 1,09 s de audio paga el encoder fijo
  de 30 s + prompt y tardó 9,3–21,7 s (secuencial). En producto: el máximo de
  locución elimina las colas largas, pero el disparador necesita un MÍNIMO de
  duración (350 ms de `minVozMs` no basta) y `timeoutMs` de respaldo.
- **Veredicto: c PASA en CPU** con ventanas de 12 s y small secuencial
  (beam 1, 8 hilos): texto igual o mejor que el tramo completo y 3,3–5,4 s por
  segmento. Siguiente paso pendiente de VoBo: máximo de locución 12 s en el
  cierre + sidecar faster-whisper por `TranscriptorTramoPort` (misma puerta,
  misma fila, mismo commit, Chrome de respaldo). `LOCAL_FINAL_DEFAULTS.enabled`
  quedó en `false` hasta esa implementación y se encendió en §5-nonies.

### 5-sexies. Implementación paso 1 de 3 — tope de locución (HECHO 2026-11-14)

VoBo: «tope de locución 12 s en el cierre (`maxLocutionMs` en config) + test de
que la fila se parte sin perder texto». Implementado sin tocar el camino vivo ni
el modelo:

- **Dueño del umbral:** `CONVERSACION_CONFIG` (`ports.ts`), `maxLocutionMs:
  12000` (0 = sin tope). Medido en §5-quinquies: 12 s es el punto de operación.
- **Dueño de la decisión:** `frontera.ts` sigue con DOS puertas. El TOPE es una
  tercera medida del mismo eje TIEMPO (puerta 2), no una puerta nueva: causa
  `'maximo'`. Con voz presente el tiempo solo cierra por tope; sin voz, las
  medidas de silencio mandan. Barreras de dos puertas intactas (`cierre-dos-puertas`,
  `rutas-dobles`, `final-confirmado`).
- **Dónde se evalúa:** `ingesta.ts`, `cerrarPorTope()`, al ENTRAR el bloque y
  DESPUÉS del drenaje de resultados (el primer resultado posterior al borde
  todavía entra en la locución que cierra; evaluarlo al final del bloque lo
  perdía como huérfano). Cierra por `flujo.cerrarPorFrontera` + `flushPendientes`
  (misma costura que el silencio) y deja `estado.tramoAudio = null` para que el
  bloque en curso abra la ventana contigua.
- **Sin duplicar línea:** el caparazón de la ventana nueva nace con
  `partidaDeVoz=true` cuando arranca exactamente en `previa.tramo.fin` del mismo
  turno y sample rate (la línea de Chrome re-incluye lo ya commiteado; el
  recorte de prefijo necesita la marca). Con hueco real no se toca.
- **Pruebas:** `conversacionApi.test.ts` (12 s de voz continua → dos filas
  contiguas, unión = frase completa, causas `['maximo','silencio']`, cero
  descartes de texto; y tope inyectado a 3 s para probar que sale de config) y
  `conversacionFrontera.test.ts` (borde 12000/11999, sin duración, tope 0,
  silencio gana la causa). Falsificación medida: sin el disparo → una sola fila;
  sin el corte del tramo → continuación perdida; sin `partidaDeVoz` → frase
  duplicada. Los tres hacen fallar el test.
- **Estado:** `LOCAL_FINAL_DEFAULTS.enabled` apagado en este paso; se enciende
  en §5-nonies.

### 5-septies. Implementación paso 2 de 3 — mínimo de audio en el disparador (HECHO 2026-11-14)

VoBo: «mínimo de duración en el disparador (`minAudioSegundos`, además de
`minVozMs`) + test de 1,09 s no invoca local».

- **Dueño del valor:** `LOCAL_FINAL_DEFAULTS.minAudioSegundos = 3`
  (`asrDefaults.js`), proyectado por `FLU_CONFIG.transcript.localFinal` y leído
  por `getLocalFallbackRuntimeConfig` (lector único). Medido en §5-quinquies: la
  ventana de 1,09 s tardó 9,3–21,7 s por el encoder fijo de 30 s + prompt.
- **Dueño de la decisión:** `necesitaRespaldoLocal` (`cierre.ts`) añade
  `audio-corto` al vocabulario `MotivoRespaldoLocal`, DESPUÉS de `minVozMs` y
  ANTES de transcribir: por debajo del mínimo el modelo no se paga y el tramo
  cierra con Chrome (o `sinTexto`).
- **Pruebas:** `conversacionApi.test.ts` — el tramo de 1,09 s (voz REAL en el
  PCM) NO invoca el transcriptor y cierra `sinTexto`; el borde de 3 s exactos
  SÍ lo invoca; los casos existentes del disparador (sin voz, comando,
  no-hace-falta, fallo, puerta) se alargan a ≥3 s para que cada uno mida SOLO
  su regla. `voiceLocalFallbackDefaults.test.ts` fija la proyección única
  (config = defaults) y el valor medido. Falsificación medida: sin la
  comprobación, el tramo de 1,09 s invoca el local y el test cae.
- **Estado:** `LOCAL_FINAL_DEFAULTS.enabled` apagado en este paso. Paso 3
  (adaptador del sidecar por `TranscriptorTramoPort`, timeout 8 s por ventana,
  Chrome si no hay sidecar) ejecutado en §5-octies y encendido en §5-nonies.

### 5-octies. Implementación paso 3 de 3 — adaptador del sidecar (HECHO 2026-11-14)

VoBo: «adaptador del sidecar por `TranscriptorTramoPort`: servicio local
faster-whisper, misma puerta, misma fila, mismo commit; enabled solo con sidecar
disponible; si no, Chrome».

- **Dueño nuevo (declarado en `OWNERS.md`):** `src/voice/lib/asr/sidecarTranscriber.ts`
  — `crearSidecarTranscripcion` (cliente del servicio: sonda y transporte) y
  `pcmFloat32ABase64` (único codificador del cable). Consumidor único:
  `crearTranscriptorSidecarProducto` en `adapters.ts`; el producto lo cablea en
  `producto.ts`. El dueño anterior (`crearTranscriptorWhisperProducto`, Whisper
  WASM por tramo) muere en este mismo cambio como ruta del producto; el motor
  WASM (`whisperWasmTranscriber.js`) NO se toca: sigue siendo dueño de la
  escucha viva y del laboratorio.
- **Contrato del cable (lo implementa el servicio):**
  - `GET {url}/salud` → 2xx = disponible. Cualquier otro estado, error de red o
    sonda agotada = NO disponible; la fila se queda con Chrome.
  - `POST {url}/transcribir` con JSON
    `{ muestras: <base64 float32 LE>, sampleRate, idioma, formato: 'f32le' }`
    → `{ texto: string }`.
  - UNA ventana por petición, SECUENCIALES (nada de VAD por lotes ni streaming).
    Sin overlap ni dedupe nuevo.
  - El tope por ventana se impone en el transporte con `AbortController`; la
    promesa SIEMPRE resuelve (texto o motivo `timeout`/`fallo`): un sidecar
    colgado no congela el cierre.
- **Config (fuente única):** `timeoutMs = 8000`, `sidecarProbeMs = 1500`,
  `minAudioSegundos = 3` y `enabled = true` (§5-nonies) viven en
  `LOCAL_FINAL_DEFAULTS`;
  `sidecarUrl` (por defecto `http://127.0.0.1:8765`) vive SOLO en
  `fluConfig.js` — la auditoría de hardcodes exige URLs en config y el cliente
  no lleva endpoint. Todo se proyecta por el lector único
  `getLocalFallbackRuntimeConfig`.
- **Puerta y fila:** el adaptador remuestrea al rate del ASR (`downsample`) y
  pasa el texto por `classifyLocalResult` (dueño anti-alucinación); el módulo
  espera el resultado ANTES de construir la fila: misma puerta, misma fila,
  mismo commit. `respaldarConLocal` no cambia.
- **Disponibilidad:** `localFinal.enabled` es la compuerta del producto y la
  aplica el módulo; el adaptador exige ADEMÁS el sidecar. `preload()` sondea una
  vez por apertura solo si `enabled`; `transcribir()` espera la MISMA promesa
  memoizada (una sola sonda, nunca una por tramo) y sin servicio devuelve
  `deshabilitado` sin pagar la petición de transcripción.
- **Pruebas:** `tests/transcriptorSidecar.test.ts` (15): vector de bytes float32
  LE (`1.0` → `00 00 80 3F`), `salud` 2xx/no-2xx/excepción/URL vacía, cuerpo
  POST completo, HTTP no-ok y JSON inválido → `fallo`, abort → `timeout`, sin
  servicio → `deshabilitado` con CERO transcripciones, con `enabled` encendido
  el preload sondea y la sonda se reusa (apagándolo en memoria no sondea), una
  sola sonda por apertura, remuestreo y tope de 8 s de config, texto aceptado,
  `sin-voz`, timeout/fallo, y guardas de cableado (el producto usa el sidecar,
  `adapters.ts` no importa el WASM, la URL no está en el cliente).
  `voiceLocalFallbackDefaults.test.ts` fija la proyección (`timeoutMs 8000`,
  `sidecarProbeMs 1500`, `enabled true`, `sidecarUrl` local).
- **Falsificaciones medidas (rojo y restaurado):** saltar la compuerta de
  disponibilidad → falla «sin sidecar → cero transcripciones»; codificar
  big-endian → falla el vector LE; sondear en `preload` con `enabled=false` →
  falla su test; mapear abort a `fallo` → falla «abort → timeout».
- **Barreras:** los 6 literales nuevos repetidos que introdujo el lote ASR se
  unificaron en el código (los comentarios nombran al dueño sin repetir el
  literal citado; `adapters.ts` usa `respaldo.local.fallo` y `cierre.ts`
  conserva `conversacion.respaldo.local.fallo`). Queda UNA entrada vieja en
  `scripts/literales-allowlist.json` (`selectVisiblePhrase`, que el refactor de
  UI en curso dejó de repetir) cuyo recorte toca al dueño (guard/allowlist
  reservados); queda reportada, no tapada.
- **Estado:** `LOCAL_FINAL_DEFAULTS.enabled` quedó en `false` hasta §5-nonies,
  donde el sidecar real pasó la validación y se encendió. Playback sigue **no
  validado en vivo** (VoiceMeeter).

### 5-nonies. Cierre — sidecar real implementado y ENCENDIDO (HECHO 2026-11-14)

Encargo del dueño: «Implementa el sidecar real de Python/faster-whisper usando
el venv y el código del spike: `/salud` y `/transcribir`, f32le base64, 12 s,
small CPU int8, 8 hilos, beam 1, secuencial, timeout 8 s, modelo cargado una
vez. Incluye el launcher y la documentación mínima. Valida el camino completo
con el audio real b6d82bca en ventanas de 12 s: texto, latencia, puerta, fila y
commit. Si el texto es el medido y la fila aparece, enciende
`localFinal.enabled: true`.»

- **Servicio:** `asr-sidecar/sidecar.py` (HTTP/1.1 en un solo hilo, modelo
  cargado UNA vez antes de abrir el puerto, guard de instancia única),
  `start-sidecar.cmd` (usa `.agent_tmp/venv` o `FLU_ASR_PYTHON`) y `README.md`.
  Dependencias: `faster-whisper==1.2.1` y numpy.
- **Contrato del cable:** exactamente §5-octies (`/salud`, `/transcribir`
  f32le base64, una ventana de 12 s por petición, secuencial, timeout del
  cliente 8 s).
- **Barreras nacidas de la operación:** (1) cada respuesta cierra su conexión
  (`close_connection = True`): con HTTP/1.1 keep-alive y un solo hilo, la
  siguiente sonda `/salud` caducaba a los 1500 ms (medido); (2) guard de
  instancia única antes de cargar el modelo, porque en Windows
  `SO_REUSEADDR` no falla al repetir el puerto. El `python.exe` del venv es un
  redirector y lanza el intérprete base como hijo: 2 PID con la misma hora de
  creación son UNA instancia (medido).
- **Recorte del PCM del tramo (`cierre.ts`):** el búfer retenido incluye el
  silencio que dispara el cierre. En la ventana parcial de 11,57 s llegaban
  241 130 muestras (15,07 s) y el sidecar respondía 400 por el tope de
  ventana, perdiendo la fila local. `respaldarConLocal` recorta a
  `round(audioSegundos * sampleRate)` ANTES de medir voz y transcribir: el
  sidecar recibió 185 130 muestras y la fila fue local.
- **Medición real (audio b6d82bca, 6 ventanas de producto):** fila =
  respuesta del sidecar (carácter a carácter), `origen: 'local'`, un solo
  `row.committed`, `descarte: null`, cierre 4,7–6,3 s (< `timeoutMs` 8000).
  Palabras 40/44/45 (`c7013264`) y 38/51/50 (`2ea145a2`); la cola de 1,09 s
  la omite el disparador. Comparación informativa con la corrida previa del
  spike: 41/46/43 y 36/54/55.
- **Límite medido (no es un defecto del camino):** el texto NO es
  bit-reproducible entre arranques. El MISMO `spike-windows.py` sin tocar
  produjo las dos variantes en momentos distintos, con el mismo audio (sha256
  `a8ff47ad…`) y los mismos parámetros; dentro de una ejecución es estable.
  Por eso la prueba de integridad es `fila === respuesta del sidecar` para la
  misma ventana, más puerta/origen/commit, no la igualdad contra una cadena
  fija.
- **Estado:** `LOCAL_FINAL_DEFAULTS.enabled = true`. Playback sigue **no
  validado en vivo** (VoiceMeeter); la validación de voz es con audio real.
- **Pruebas:** `tests/transcriptorSidecar.test.ts` (con `enabled` encendido el
  preload sondea y la sonda se reusa; apagándolo en memoria no sondea),
  `tests/voiceLocalFallbackDefaults.test.ts` (fija `enabled: true`) y el
  arnés temporal de camino completo (6/6 ventanas verdes), que NO se commitea.

---

## 6. Puerta anti-alucinación (dueño: gate existente)

Reutilizar `classifyLocalResult`/`getLocalFallbackRuntimeConfig` y añadir, en el mismo dueño, verificación de:

1. Voz real: `vozMs >= minVozMs`; sin voz no se transcribe.
2. Silencio/no-speech: umbral de `no_speech`/energía.
3. Confianza: `avg_logprob`/compresión dentro de rango.
4. Duración plausible: palabras/segundo dentro de un máximo; un texto enorme para 1 s se rechaza.
5. Repetición/bucle: filtros existentes de `speechMerge`/`transcriptQuality`.
6. Idioma: no aceptar texto de otro idioma configurado si el tramo no lo justifica.
7. Si el tramo cae en un hueco sin voz (p. ej. 67–95 s del audio `b6d82bca`), **se rechaza** (“Back to the cojo” no debe entrar).

El gate de **comandos** sigue siendo el estricto actual; el gate de **transcripción** solo decide si el texto local puede pintarse/guardarse, nunca si puede ejecutar.

---

## 7. Reconciliación

- El texto local que pasa la puerta se entrega como **final del mismo tramo** antes del cierre.
- La caja en vivo sigue mostrando los parciales de Chrome mientras se espera el local; no se bloquea la UI.
- Si local tarda más que `timeoutMs` o falla, se cierra con Chrome (o `sinTexto`).
- No se crea fila nueva, no se reescribe una fila final. Una fila, un texto final.
- Si Chrome no emitió nada y local pasa, la fila es de origen local y se marca como `provisional`/`source:'local'` para la UI; no es accionable.

---

## 8. Comandos y TTS

- `source:'local'` se ignora en la compuerta de comandos. Solo Chrome final + wake puede ejecutar.
- En modo asistente se mantiene el TTS y la suspensión actual.
- En un futuro modo transcripción, TTS/commands se apagan; no forma parte de este contrato.

---

## 9. Pruebas y aceptación (barrera real)

**Audio de referencia:** `C:\Users\luis_\AppData\Local\Temp\flu-recordings\b6d82bca-1e60-41d9-bd72-936d31b370b9\audio.pcm` + `turns.ndjson`.

1. **Caso medido:** reproducir `b6d82bca` con Playback. Las filas `c7013264` y `2ea145a2` deben incluir el texto que Whisper local oye (la mujer habla mucho más que 10/9 palabras), sin duplicar fila.
2. **Hueco 67–95 s:** el gate debe rechazar el texto alucinado en silencio; no debe aparecer “Back to the cojo”.
3. **Chrome sano:** un tramo con final plausible **no** debe ejecutar local (sin coste extra).
4. **Comandos:** ninguna frase de origen local debe disparar agenda/juego/acción.
5. **Sin voz:** tramo sin voz no genera texto local.
6. **Timeout:** local lento no bloquea el cierre; se usa Chrome/`sinTexto`.
7. **Una fila por tramo:** comparar `turns.ndjson` antes/después; sin duplicados.

Ejecutar solo `test:file` de los archivos tocados + `typecheck` + `lint:eslint` + Playback. **Prohibida la suite completa.**

---

## 10. Protocolo de ejecución para Claude

1. Leer este contrato y `docs/OWNERS.md` antes de escribir.
2. Declarar el dueño y el archivo exacto antes de cada cambio.
3. Un cambio a la vez: disparador → gate → espera/commit → reconciliación → comandos.
4. Tras cada cambio: `test:file` del área + el Playback cuando aplique; pegar salida real.
5. Si un test falla, corregir la causa; no ajustar el test para tapar.
6. Si el cambio exige un dueño nuevo, **parar y preguntar**; no crear archivo sin fila en `OWNERS.md`.
7. No commit, no push, no suite completa, no refactors colaterales.
8. Al cerrar: `Cambios aplicados · Validado contra · No validado` y el diff real.

---

## 11. Riesgos y límites

- **Alucinación local:** la puerta y el disparador por bajo rendimiento la reducen, no la eliminan. En audio lejano, preferir `base`/`small` o un motor local nativo.
- **Latencia:** el final local puede tardar; el `timeoutMs` protege el cierre. La caja sigue mostrando Chrome.
- **CPU/batería:** local solo en tramos fallidos; no en todos.
- **Modelo:** tiny alucina más que base; el modelo final debe ser configurable.
- **Bucle de eco:** si FLU habla, sigue la suspensión actual; en transcripción pura, TTS off.
- **Duplicado:** se evita esperando el local antes del commit; si se commitea antes, el contrato se incumple.

---

## 12. Punto de partida

- Respaldo: `D:\D-Proyectos\D-3-FLU-OS4-BACKUPS\2026-11-13\seq-1` + `FLU-OS4-FULL-2026-11-13-S1.bundle`.
- Trabajar sobre una rama `feature/*`; no commit sin pedido.
- La grabación `b6d82bca` es la referencia; no se toca.
