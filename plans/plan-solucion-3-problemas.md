# Plan de solución — 3 problemas de FLU OS4 (diarización, capacidades+reproductor, emociones alineadas)

> **Estado:** IMPLEMENTADA — F1 ✅, F2 ✅, F3 ✅ (código + tests en verde).
> **Decisiones del usuario que rigen este plan:**
> 1. El sistema debe **identificar realmente a los hablantes** (diarización real), no solo suprimir eco.
> 2. Implementar **registro de capacidades (catálogo de acciones reales)** + **reproductor de música real**.
> 3. **Cuerpo y evento siempre sincronizados**: canción anunciada → baila (Dance); feliz sin evento → salta; triste → gesto triste.
>
> **Resumen de validación (al cierre de F3):**
> - `npx tsc -b` → **exit 0** (compila limpio).
> - Tests previos: **76 en verde** (localTts 20, turnSpeakerCommit 16, architecture 30, animationConsistency 10).
> - Test dedicado F3: **`tests/musicCapabilities.test.ts` → 18/18 en verde** (exit 0): integridad de `FLU_PLAYLIST`, `resolveTrack`, `playMusic/pause/stop/volume` (aislamiento de singleton vía `vi.resetModules()` + import dinámico) y catálogo honesto `buildCapabilitiesPrompt` es/en.

---

## Conclusión (resumen ejecutivo)

| Problema | Caso real observado | Causa raíz (evidencia) | Solución propuesta |
|---|---|---|---|
| **1. Diarización** | Todo el audio de sala se registra como `Hablante 1` (evento 212 en vivo: captura *"mujeres"* → `speaker:"Hablante 1"`). FLU tampoco se distingue. | El pipeline audio→hablante **existe completo**, pero el preview usa un **stub** [`resolveConversationSpeakerSync`](src/voice/hooks/useFluVoiceAssistant.js:1181) que nunca resuelve por audio en conversación; todo cae al *sticky fallback* `Hablante 1` ([`turnSpeakerCommit.js:170`](src/voice/lib/turnSpeakerCommit.js:170)). | Conectar el preview al preflight del worker, permitir creación de clusters nuevos en preflight, y escribir clusters al commit. El eco de FLU se maneja como **capa de soporte** (no como núcleo). |
| **2. Capacidades + reproductor** | FLU "promete" acciones (poner música, navegar, generar) que no siempre cumple; "voy a poner una canción" no reproduce nada. No existe reproductor. | No hay catálogo real de capacidades en el system prompt ([`gemini.js:318`](src/voice/lib/gemini.js:318) ni [`deepseek.ts:440`](src/services/deepseek.ts:440)); no existe `musicPlayer` (búsqueda `HTMLAudio|new Audio|playlist|musicPlayer` → 0 resultados). | Crear [`src/services/capabilities.ts`](src/services/capabilities.ts) (fuente de verdad) y [`src/services/musicPlayer.ts`](src/services/musicPlayer.ts) (reproductor real HTMLAudio, modelado sobre [`localTts.ts`](src/services/localTts.ts:1)); inyectar el catálogo en ambos prompts; ejecutar `play_music` desde `onContractResolved`. |
| **3. Emociones alineadas** | Anunciar canción no baila; "feliz sin evento" no salta; "triste" no hace gesto triste. | [`buildAnimPrompt`](src/core/anim/expressionRegistry.ts:543) está **definido pero nunca se inyecta** (búsqueda → solo su definición); el `animPrompt` duro de [`gemini.js:365`](src/voice/lib/gemini.js:365) es débil y no separa ACCIÓN vs ESTADO; precedencia errónea [`App.tsx:883`](src/App.tsx:883) (`emocion` pisa `animacion`); [`detectActionInTranscript`](src/lib/transcriptProcessor.ts:68) solo escanea el transcript del usuario, no la `respuesta_voz` de FLU. | Inyectar `buildAnimPrompt`; corregir precedencia; extender el post-proceso para escanear `respuesta_voz` (anuncio de canción → `canta`→Dance). |

---

## Alcance y decisiones clave (respuestas a las 3 preguntas del usuario)

### 1) ¿Resuelve una conversación con MÚLTIPLES hablantes / MEZCLA?
- **SÍ para mezcla SECUENCIAL (turnos A/B/A)**: el motor es diarización estricta por firma ([`voiceId.worker.js:3`](src/voice/workers/voiceId.worker.js:3)) — cada turno embebe su ventana, compara coseno contra los clusters y crea `Hablante N` cuando la voz no coincide. Con el stub corregido y `allowNewCluster:true`, A/B/A alternados se identifican correctamente.
- **Límite honesto — SOLAPE simultáneo (dos voces a la vez en un mismo turno)**: el mic es un único stream mono y cada turno produce UNA firma ([`extractTurnAudioSnapshot`](src/voice/lib/turnSpeakerPreflight.js:148)); una ventana con 2 voces da una firma mezclada que no matchea bien ningún cluster. Mitigación disponible: reutilizar [`segmentAudio()`](src/voice/hooks/useFluVoiceAssistant.js:191) para dividir ventanas largas y embed por segmento (mejora F1.5). En la práctica el ASR del navegador solo devuelve una hipótesis por vez, así que el beneficio real queda cubierto con la identificación secuencial.

### 2) ¿FLU puede CANTAR con la voz que tenga configurada?
- **No con el TTS actual.** La voz configurada es Web Speech ([`localTts.ts`](src/services/localTts.ts:37)): solo expone `rate`/`pitch` ([`LocalTtsOptions`](src/services/localTts.ts:14)) — no hay control de melodía, ritmo ni notas. "Cantar" con Web Speech suena robótico, no es viable como producto.
- **Ideal (recomendado)**: FLU **anuncia** la canción con su voz configurada → **reproduce la canción real** (musicPlayer HTMLAudio) → **baila (Dance)** en sincronía. Ese es el "resultado esperado" ya confirmado (anuncio → baila). El canto literal queda descartado por calidad; opcional futuro: tarareo/entonación con `pitch` variable, nunca como núcleo.

### 3) Solución concreta
Es la de los Casos 1–3 de este documento (resumen ejecutivo arriba + detalle por caso + orden F1→F2→F3 abajo). No se modifica ningún archivo hasta la aprobación del usuario.

---

## Caso 1 — Identificar hablantes (diarización real)

### El caso
Durante una conversación de sala (mic con `conversationUsePassiveAudio:true`), cada final de turno se registra con `speaker:"Hablante 1"` independientemente de quién habló. Evidencia en vivo (Terminal 1, `/__flu_agent_trace`): evento 212 `ingress/final-commit-scheduled` con `capture:"mujeres"` → `speaker:"Hablante 1"`; lo mismo en 213–217. Resultado: el log de conversación no distingue a nadie.

### Causa raíz (evidencia con código)
1. **El stub**: [`resolveConversationSpeakerSync`](src/voice/hooks/useFluVoiceAssistant.js:1181) — con `audioSnapshot?.length` presente retorna `fallbackSpeaker || lastLoggedSpeakerRef.current || lastSpeakerRef.current || 'Hablante 1'`, nunca resuelve por audio. El propio comentario lo confirma: *"Embeddings async (worker): commit usa preflight; preview no diariza en conversación."*
2. **El pipeline real SÍ existe**:
   - [`createSpeakerAudioResolver`](src/voice/hooks/useFluVoiceAssistant.js:1216) envuelve [`createTurnSpeakerAudioResolver`](src/voice/lib/turnSpeakerPreflight.js:125) (audio → `speakerId`/`speakerName`/`signatureVector`/`workingClusters`).
   - En commit: [`conversationStreamCommit.js:255`](src/voice/lib/conversationStreamCommit.js:255) `finalizeTurnIdentityPipeline(turnId, () => createSpeakerAudioResolver({atTurnBoundary:true, allowNewCluster:true, utterance:phrase}))` → [`resolveTurnSpeakerAtCommit`](src/voice/lib/turnSpeakerCommit.js:56) rama **preflight-audio** (116–159) SÍ consume `preflight.speakerName`.
3. **Por qué colapsa a `Hablante 1`**:
   - El preflight corre con `allowNewCluster:false` ([`useFluVoiceAssistant.js:1257`](src/voice/hooks/useFluVoiceAssistant.js:1257)), así que un hablante desconocido no puede crear cluster → resultado débil.
   - Los resultados débiles (`reason:'no-audio'|'no-vector'` o sin firma) se descartan/ignoran ([`turnSpeakerPreflight.js:42`](src/voice/lib/turnSpeakerPreflight.js:42)) y se mantiene el `slot` previo; si nunca hubo un slot fuerte, `preflight.ready` queda en falso.
   - Con `preflight` no listo, [`resolveTurnSpeakerAtCommit`](src/voice/lib/turnSpeakerCommit.js:170) cae al sticky fallback `'Hablante 1'`.
   - En preview, [`applyConversationSpeaker`](src/voice/hooks/useFluVoiceAssistant.js:1298) pasa por el stub y fija `lastLoggedSpeakerRef.current = fallback = 'Hablante 1'`, alimentando el sticky del siguiente turno.
   - La escritura de clusters está diferida al commit (`deferClusterWritesUntilCommit`), por lo que los clusters rara vez se persisten para reutilizarse.

### Solución (centrada en identificación real; el eco es solo apoyo)
1. **Conectar el preview al preflight** — reemplazar el cuerpo del stub [`resolveConversationSpeakerSync`](src/voice/hooks/useFluVoiceAssistant.js:1181) para que, cuando haya audio y `conversationAutoDiarize===true`, consulte el preflight del turno activo (`peekTurnSpeakerPreflight(activeTurnIdRef.current)` → si `ready && speakerName`, retornarlo). Fallback al comportamiento actual solo si no hay preflight listo.
2. **Alinear `allowNewCluster`** en [`scheduleIdentityPreflight`](src/voice/hooks/useFluVoiceAssistant.js:1257): pasar `allowNewCluster:true` (igual que el commit en [`conversationStreamCommit.js:258`](src/voice/lib/conversationStreamCommit.js:258)) para que el worker pueda crear `Hablante 2`, `Hablante 3` cuando la firma no matchea clusters existentes.
3. **Persistir clusters en el commit** — garantizar que `applyResolvedSpeakerToSessionRefs` ([`turnSpeakerCommit.js:187`](src/voice/lib/turnSpeakerCommit.js:187)) escriba `workingClusters` en `speakerClustersRef` (ya lo hace) y que `conversationStreamCommit.js` no los descarte; revisar `deferClusterWritesUntilCommit` en [`fluConfig.js`](src/voice/lib/fluConfig.js) (roomCapture) para que la escritura ocurra sí o sí tras un commit fuerte.
4. **Capa de soporte — eco de FLU (no núcleo)**: mientras FLU habla (`enterSpeakingState`/`isSpeechBusy` en [`fluSpeech.js`](src/voice/lib/fluSpeech.js:66) y `setConversationState('SPEAKING')`), no se debe diarizar/crear clusters con el audio que vuelve por la bocina (evita clusters fantasma de FLU). Reutilizar `ingressEchoStreakRef`/reglas de eco existentes como *soporte*, sin que esto sea la solución principal.

### Validación Caso 1
- Iniciar conversación con ≥2 personas reales; verificar en el log que cada entrada tenga `speakerName` distinto (no todo `Hablante 1`).
- Trace: [`speaker-new`/`speaker-sticky`](src/voice/hooks/useFluVoiceAssistant.js:1343) deben mostrar transiciones reales.
- Correr `tests/turnSpeakerCommit.test.ts` (y añadir caso "preflight listo → speakerName del preflight").

---

## Caso 2 — Registro de capacidades (catálogo real) + reproductor real

### El caso
FLU promete acciones que no siempre cumple porque el modelo no conoce el **catálogo real** de capacidades ejecutables: declara acciones que el sistema no ejecuta (o no declara las que sí ejecuta). Además, "voy a poner una canción" no reproduce nada: **no existe reproductor de música** (búsqueda `HTMLAudio|new Audio|playlist|musicPlayer|reproductor` → 0 resultados en `src/`).

### Causa raíz (evidencia)
- El system prompt [`buildSystemPrompt`](src/voice/lib/gemini.js:318) describe animaciones ([`animPrompt`](src/voice/lib/gemini.js:365)) y configuraciones ([`configPrompt`](src/voice/lib/gemini.js:384)), pero **no existe un catálogo explícito de capacidades ejecutables** del sistema.
- El contrato de DeepSeek ([`deepseek.ts:440`](src/services/deepseek.ts:440)) solo lista `navegacion`/`workspace`/`animacion`/`emocion`; tampoco hay catálogo.
- Solo existe TTS local ([`localTts.ts`](src/services/localTts.ts:1)); no hay reproductor de audio.

### Solución
1. **Nuevo [`src/services/capabilities.ts`](src/services/capabilities.ts)** — catálogo de capacidades reales (fuente de verdad):
   - `id`, `nombre`, `descripcion` (ES/EN), `contrato` (qué campo activa), `ejecutar(...)`.
   - Entradas mínimas: `play_music` (nuevo reproductor), `navegar` (navegacion), `generar_workspace` (workspace), `set_config`/`set_branding` (configuracion), `animar` (animacion). Solo capacidades que el sistema realmente ejecuta (honestidad: no prometer lo que no existe).
2. **Nuevo [`src/services/musicPlayer.ts`](src/services/musicPlayer.ts)** — reproductor real, modelado sobre [`localTts.ts`](src/services/localTts.ts:1) (API pura, sin endpoints hardcodeados, sin excepciones):
   - `playMusic(uri: string, opts?)`, `stopMusic()`, `pauseMusic()`, `resumeMusic()`, `getPlaylist()`, `isMusicPlaying()`.
   - Implementación: `HTMLAudioElement` (assets locales `/public` o URLs) con control de estado; playlist para encadenar canciones.
   - Se registra en `capabilities.ts` como `play_music`.
3. **Inyectar el catálogo en los prompts**:
   - En [`buildSystemPrompt`](src/voice/lib/gemini.js:318), junto a `configPrompt` (línea 448): lista `CAPACIDADES DISPONIBLES` generada por `capabilities.ts` (nombre + descripción + cuándo usarla) + guard de honestidad: *"Solo usa una capacidad si está en esta lista; si el usuario pide algo fuera del catálogo, dilo con honestidad en respuesta_voz y no lo prometas."*
   - En el contrato de DeepSeek ([`deepseek.ts:440`](src/services/deepseek.ts:440)): misma lista + regla de honestidad.
4. **Ejecución desde el contrato** — en [`onContractResolved`](src/App.tsx:647): cuando el contrato indique `play_music` (campo nuevo opcional `musica: { accion:'play'|'stop', uri?, nombre? }` añadido al esquema [`FLU_CONTRACT_SCHEMA`](src/voice/lib/gemini.js:139), a `generateFluContract`, a [`schemas.ts`](src/core/gemini/schemas.ts) y a [`services/gemini.ts`](src/services/gemini.ts)), llamar `playMusic(uri)` y forzar `animacion='Dance'` (enlaza con Caso 3: canción → baila).
   - La caché del system prompt ([`geminiProxy.ts:51`](src/server/geminiProxy.ts:51), TTL 5 min) no se invalida: el catálogo es estático.

### Validación Caso 2
- "FLU pon música" → se reproduce audio real y el avatar baila (Dance) mientras suena.
- "FLU para la música" → se detiene.
- El catálogo en el prompt no enumera acciones que no se ejecutan (guard de honestidad).

---

## Caso 3 — Emociones alineadas a eventos (cuerpo y evento sincronizados)

### El caso (comportamiento esperado confirmado)
- FLU **anuncia una canción** → debe **bailar (Dance)**.
- **Feliz sin evento** → debe **saltar (Jump_in_place)**.
- **Triste** → debe hacer **gesto triste**.
- El cuerpo y el evento siempre sincronizados (la animación ocurre cuando ocurre el evento, no desfasada).

### Causa raíz (evidencia)
1. [`buildAnimPrompt`](src/core/anim/expressionRegistry.ts:543) está **definido pero NUNCA se inyecta** en ningún prompt (la búsqueda solo encuentra su definición). Contiene la regla clave: *"Usa 'animacion' para ACCIONES FÍSICAS (baila→Dance…); usa 'emocion' solo para ESTADOS EMOCIONALES; si el usuario dice 'baila', asigna animacion y emocion ''"* (líneas 601–604). Sin esto, el modelo pone `baila`→`emocion:"Yupi"` en vez de `animacion:"Dance"`.
2. El `animPrompt` que SÍ recibe el modelo ([`gemini.js:365`](src/voice/lib/gemini.js:365)) es **débil**: lista animaciones pero no separa ACCIÓN FÍSICA de ESTADO EMOCIONAL, ni da la regla "baila → animacion Dance, emocion ''".
3. Precedencia errónea en [`App.tsx:883`](src/App.tsx:883): `const emotionLabel = geminiEmocion || geminiAnimacion || ''` — el `emocion` genérico **pisa** la `animacion` específica.
4. El post-proceso [`detectActionInTranscript`](src/lib/transcriptProcessor.ts:68) (que ya mapea `canta`→Dance en línea 28, `baila`→Dance en 25, `salta`→Jump_in_place en 29) **solo escanea el transcript del usuario** ([`App.tsx:857`](src/App.tsx:857)), no la `respuesta_voz` de FLU. Cuando FLU dice *"voy a poner una canción"*, nada fuerza Dance.

### Solución
1. **Inyectar [`buildAnimPrompt`](src/core/anim/expressionRegistry.ts:543) en [`buildSystemPrompt`](src/voice/lib/gemini.js:318)**: importar `buildAnimPrompt` desde `expressionRegistry` y añadirlo al arreglo de retorno (junto a `animPrompt` en línea 447). Reemplaza al `animPrompt` duro (365–381) para que el modelo sepa la regla animacion-vs-emocion.
2. **Corregir la precedencia** en [`App.tsx:883`](src/App.tsx:883): para acciones físicas la `animacion` explícita debe ganar → `const emotionLabel = geminiAnimacion || geminiEmocion || ''` (y ajustar `resolveEmotionAnims` para que `'Dance'` resuelva a los anims de baile; ya hay soporte en [`transcriptProcessor.ts:110`](src/lib/transcriptProcessor.ts:110)).
3. **Extender el post-proceso a `respuesta_voz`**: en [`onContractResolved`](src/App.tsx:855), además del transcript del usuario, ejecutar `detectActionInTranscript(respuestaVoz)` — si FLU anuncia canción/canta/baila en su propia respuesta, forzar `geminiAnimacion='Dance'` y `geminiEmocion=undefined`. Esto sincroniza el anuncio con el baile.
4. **Comportamientos esperados resultantes**:
   - Anuncio de canción → `canta`→`Dance` (post-proceso de respuesta_voz) y/o `musica.play` → Dance (Caso 2).
   - Feliz sin evento → `emocion:"feliz"` → `resolveEmotionAnims` → Jump (según `EXPRESSION_MAP`); si el usuario dice "salta" → `Jump_in_place` directo.
   - Triste → `emocion:"triste"` → anims de gesto triste.
   - Sincronización cuerpo/evento: mantener el flujo único SPEAKING ([`App.tsx:932-951`](src/App.tsx:932)) con `pendingEmotionAnims` aplicado durante SPEAKING (894–908), sin doble recarga de BunnyViewer.

### Validación Caso 3
- `tests/e2e/validate-cuerpo-en-movimiento.spec.ts` (cuerpo se mueve durante SPEAKING con emoción).
- `tests/e2e/validate-emocion-durante-habla.spec.ts` (emoción durante habla).
- `tests/animationConsistency.test.ts`.
- Añadir caso: contrato con `respuesta_voz` que anuncie canción → verificar `animacion='Dance'` (patrón de `validate-cuerpo-en-movimiento.spec.ts:199`).

---

## Orden de ejecución propuesto (una vez aprobado)

| Fase | Alcance | Archivos | Depende de |
|---|---|---|---|
| **F1** | Caso 1 — diarización real | [`useFluVoiceAssistant.js`](src/voice/hooks/useFluVoiceAssistant.js), [`turnSpeakerPreflight.js`](src/voice/lib/turnSpeakerPreflight.js), [`fluConfig.js`](src/voice/lib/fluConfig.js), [`conversationStreamCommit.js`](src/voice/lib/conversationStreamCommit.js) | — |
| **F2** | Caso 3 — emociones alineadas | [`gemini.js`](src/voice/lib/gemini.js), [`expressionRegistry.ts`](src/core/anim/expressionRegistry.ts) (import), [`App.tsx`](src/App.tsx), [`transcriptProcessor.ts`](src/lib/transcriptProcessor.ts) | F1 (independiente) |
| **F3** | Caso 2 — catálogo + reproductor | nuevos [`capabilities.ts`](src/services/capabilities.ts) y [`musicPlayer.ts`](src/services/musicPlayer.ts); [`gemini.js`](src/voice/lib/gemini.js), [`deepseek.ts`](src/services/deepseek.ts), [`gemini.ts`](src/services/gemini.ts), [`schemas.ts`](src/core/gemini/schemas.ts), [`geminiProxy.ts`](src/server/geminiProxy.ts), [`App.tsx`](src/App.tsx) | F2 (para Dance al anunciar) |

Cada fase cierra con su validación (arriba) antes de pasar a la siguiente. No se modifica ningún archivo hasta la aprobación del usuario.
