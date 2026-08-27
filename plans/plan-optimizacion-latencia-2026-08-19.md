# Plan de Optimización de Latencia - FLU OS4

## Análisis de Puntos Críticos

Basado en el análisis anterior, identificamos estos cuellos de botella:

### 1. **Timeout excesivo para interacciones normales**
- `AI_REQUEST_TIMEOUT_MS = 45_000` (45 segundos) es demasiado para conversaciones normales
- El usuario percibe "congelación" cuando la API tarda >5 segundos
- No hay diferenciación entre tipos de solicitudes

### 2. **Flujo secuencial bloqueante**
- `resolveSpeaker()` → `computeAudioSignature()` → API → TTS → resume
- Cada paso espera al anterior
- El audio signature podría calcularse en paralelo

### 3. **Doble llamada anti-eco para traducciones**
- `maxTranslationAttempts = 2` significa hasta 2× round-trip completo
- El segundo intento solo se necesita si hay eco detectado
- Podría ser más inteligente

### 4. **TTS no streaming**
- Espera toda la respuesta antes de empezar a hablar
- Chunks secuenciales en lugar de pipeline

### 5. **Prompt innecesariamente grande para solicitudes simples**
- Mismo schema completo para "hola" que para análisis complejo
- `jsonMode: true` siempre activo

### 6. **Cache limitado**
- Solo cachea `mode === 'contract'` con clave exacta
- No cachea traducciones ni respuestas similares

## Objetivos de Optimización

1. **Reducir latencia percibida** en 30-50% para interacciones normales
2. **Mantener funcionalidad completa** - no romper nada existente
3. **Mejorar experiencia de usuario** con respuestas más rápidas
4. **Preservar robustez** - mantener timeouts adecuados para casos complejos

## Estado de Implementación

**Estado global: 6 de 7 fases completas y validadas** — `tsc -b` exit 0 + 58 archivos / 1269 tests en verde, sin regresión funcional.

- ✅ **Fase 1** — Timeouts Adaptativos (bajo riesgo): `resolveRequestTimeout()` en `httpClient.ts` / `gemini.js` / `geminiProxy.ts`
- ✅ **Fase 2** — Paralelización `resolveSpeaker` (medio riesgo): `Promise.all` en `useFluVoiceAssistant.js`
- ✅ **Fase 3** — Optimización Anti-Eco (bajo riesgo): fail-fast + cache de ecos repetidos → `localTranslate()`
- ⏳ **Fase 4** — TTS Streaming (alto riesgo): **OPCIONAL / PENDIENTE**
- ✅ **Fase 5** — Prompt Optimization (medio riesgo): `buildMinimalContractSchema()` + `detectSimpleRequest()`
- ✅ **Fase 6** — Cache Mejorado (bajo riesgo): cache por hash compuesto en `geminiProxy.ts`
- ✅ **Fase 7** — UI/UX (bajo riesgo): `resumeAfterSpeechMs` dinámico en `useNavigationCommands.ts` + límites en `fluConfig.js`

## Plan de Implementación

### Fase 1: Timeouts Adaptativos (Bajo Riesgo) — ✅ COMPLETA

**Cambios:**
1. Crear `resolveRequestTimeout()` que devuelva timeout basado en:
   - `knowledgeMode` (minutes vs general)
   - `intent.comando` (si es navegación simple)
   - `translationTarget` o `repetitionTarget` presente
   - Tamaño del historial

2. Valores sugeridos:
   - Conversación normal: 15 segundos
   - Traducción/repetición: 20 segundos (permite 1 retry)
   - Análisis de documentos/imágenes: 45 segundos (actual)
   - Modo minutes: 10 segundos (cache local)

3. Modificar `fetchTextEngineResilient` para aceptar timeout dinámico

**Archivos a modificar:**
- `src/core/ai/httpClient.ts` - agregar función helper
- `src/voice/lib/gemini.js` - calcular timeout antes de llamar
- `src/server/geminiProxy.ts` - propagar timeout al handler

### Fase 2: Paralelización de `resolveSpeaker` (Medio Riesgo) — ✅ COMPLETA

**Cambios:**
1. En `processConversationFluQuery`, iniciar `resolveSpeaker` y la llamada API en paralelo:
   ```javascript
   const speakerPromise = resolveSpeaker(question, audioSnapshot, sampleRate, fallbackSpeaker);
   const apiPromise = requestFluContractForTranscript({...});
   
   const [speakerResult, contract] = await Promise.all([speakerPromise, apiPromise]);
   ```

2. Ajustar lógica para usar `speakerResult` cuando esté disponible

3. Mantener fallback si `resolveSpeaker` falla (usar fallbackSpeaker)

**Archivos a modificar:**
- `src/voice/hooks/useFluVoiceAssistant.js` - líneas 2747-2770
- Asegurar que `resolveSpeaker` no tenga efectos secundarios críticos

### Fase 3: Optimización Anti-Eco (Bajo Riesgo) — ✅ COMPLETA

**Cambios:**
1. Modificar lógica de `maxTranslationAttempts`:
   - Primera llamada con timeout reducido (8 segundos)
   - Si hay eco Y timeout no se alcanzó, hacer segunda llamada
   - Si primera llamada timeout, no hacer segunda (fallar rápido)

2. Agregar cache de traducciones fallidas por eco:
   - Si una frase `source` + `targetLanguage` generó eco 2 veces
   - Usar `localTranslate()` inmediatamente en futuras solicitudes

3. Reducir `temperature = 0` para traducciones (ya está)

**Archivos a modificar:**
- `src/voice/lib/gemini.js` - líneas 1543-1610
- Agregar cache simple en memoria

### Fase 4: TTS Streaming (Alto Riesgo - Opcional) — ⏳ OPCIONAL / PENDIENTE

**Cambios:**
1. Modificar `speakResponse` para:
   - Empezar a hablar el primer chunk inmediatamente
   - Preparar chunks siguientes mientras se habla el primero
   - Usar `SpeechSynthesisUtterance` con callbacks de finalización

2. Modificar `onContractResolved` para no esperar `speakPromise` completo:
   - Iniciar speech y luego schedule resume listening
   - Manejar interrupciones si llega nueva solicitud

**Archivos a modificar:**
- `src/voice/lib/fluSpeech.js` - función `speakResponse`
- `src/App.tsx` - `onContractResolved` líneas 984-1023

**Decisión (2026-08-19) — DIFERIDA POR RIESGO, sub-items ya cubiertos:**
- ✅ `speakResponse` ya empieza el primer chunk de inmediato: `splitSpeechChunks()` pre-computa todos los chunks ANTES del bucle, y solo 2 pasos async rápidos (`enterSpeakingState()` + `refreshVoiceConfigCache()`) preceden al primer `speakSingleChunk()`.
- ✅ `speakSingleChunk()` YA usa `SpeechSynthesisUtterance` con callbacks `onend`/`onerror` (líneas 199-206 de `fluSpeech.js`).
- ❌ NO se implementa el punto 2 (`onContractResolved` sin esperar `speakPromise`): hacer `SPEAKING → LISTENING` (reabrir el micrófono) mientras FLU aún habla reintroduce el eco/feedback que el proyecto corrigió (anti-echo) y arriesga la máquina de estados del avatar (SPEAKING/MouthMove, historial de WebGL context loss). Además, la respuesta completa llega en UN contrato (sin token-streaming de la API), por lo que el TTS no puede empezar antes de que exista el texto; la latencia dominante (round-trip de la API) ya la resuelven las Fases 1/3/5/6.
- **Prioridad del usuario respetada**: "optimiza sin afectar" → se descarta un cambio de alto riesgo con beneficio marginal.

### Fase 5: Prompt Optimization (Medio Riesgo) — ✅ COMPLETA

**Cambios:**
1. Crear `buildMinimalContractSchema()` para solicitudes simples:
   - Si `intent.comando === null` y no hay `workspace`/`musica`/`configuracion`
   - Usar schema reducido: solo `respuesta_voz` y `navegacion` básico

2. Detectar solicitudes "simples":
   - Preguntas cortas (< 20 palabras)
   - Sin referencias a workspace, documentos, imágenes
   - Sin comandos de navegación complejos

3. Modificar `generateFluContract` para usar schema apropiado

**Archivos a modificar:**
- `src/voice/lib/gemini.js` - agregar detección de complejidad
- `src/voice/lib/gemini.js` - modificar `FLU_CONTRACT_SCHEMA` condicional

### Fase 6: Cache Mejorado (Bajo Riesgo) — ✅ COMPLETA

**Cambios:**
1. Extender `CONTRACT_CACHE` para:
   - Cachear por `(transcript_hash, history_hash, language, mode)`
   - Incluir modo 'response' para respuestas similares
   - Cachear traducciones por `(source_hash, targetLanguage)`

2. Reducir TTL para cache dinámico:
   - 30 segundos para conversación normal
   - 60 segundos para traducciones (menos variable)

3. Agregar invalidación por cambio de configuración:
   - Si cambia `personality`, `creativity`, invalidar cache

**Archivos a modificar:**
- `src/server/geminiProxy.ts` - función `buildContractCacheKey`
- `src/server/geminiProxy.ts` - manejo de cache por modo

### Fase 7: Optimizaciones de UI/UX (Bajo Riesgo) — ✅ COMPLETA

**Cambios:**
1. Feedback visual mejorado:
   - Mostrar "pensando..." inmediatamente al detectar wake
   - Indicador progresivo para solicitudes largas
   - Preview de texto mientras se genera TTS

2. `resumeAfterSpeechMs` ajustado dinámicamente:
   - Basado en longitud del texto de respuesta
   - Mínimo 50ms, máximo 500ms

3. Wake word optimizado:
   - `FLU_WAKE` podría solo mostrar feedback visual sin audio completo

**Archivos a modificar:**
- `src/hooks/useNavigationCommands.ts` - `FLU_WAKE` handler
- `src/voice/lib/fluConfig.js` - timing ajustable

## Priorización

**Inmediato (1-2 días):**
1. Timeouts adaptativos - mayor impacto, bajo riesgo
2. Cache mejorado - bajo riesgo, buen ROI
3. Optimización anti-eco - específico para traducciones

**Corto Plazo (3-5 días):**
4. Paralelización resolveSpeaker - requiere testing
5. Prompt optimization - mejora costo API

**Largo Plazo (1-2 semanas):**
6. TTS streaming - mayor complejidad
7. UI/UX optimizations - refinamiento

## Métricas de Éxito

1. **Latencia reducida:**
   - Wake → primera palabra hablada: < 3 segundos (actual ~5-8s)
   - Traducciones: < 10 segundos (actual ~15-20s)
   - Preguntas simples: < 5 segundos (actual ~8-12s)

2. **Caché hit rate:**
   - > 30% para conversaciones repetitivas
   - > 50% para traducciones comunes

3. **Timeout rate:**
   - < 5% de solicitudes timeout (actual desconocido)
   - Fallos por timeout reducidos 50%

4. **Experiencia de usuario:**
   - Menos "congelaciones" percibidas
   - Feedback más inmediato

## Riesgos y Mitigaciones

**Riesgo 1:** Timeouts muy cortos rompen funcionalidad compleja
- **Mitigación:** Mantener timeout largo para análisis de documentos/imágenes
- **Mitigación:** Loggear cuando se alcanza timeout para ajustar valores

**Riesgo 2:** Paralelización causa race conditions
- **Mitigación:** Testing exhaustivo con diferentes escenarios
- **Mitigación:** Mantener fallback secuencial si hay errores

**Riesgo 3:** Cache causa respuestas stale
- **Mitigación:** TTL corto + invalidación por configuración
- **Mitigación:** Opción de deshabilitar cache en dev

**Riesgo 4:** TTS streaming causa solapamiento de audio
- **Mitigación:** Detener speech anterior si llega nueva solicitud
- **Mitigación:** Buffer pequeño entre chunks

## Plan de Testing

1. **Tests unitarios existentes:** Asegurar que pasen todos
2. **Tests de integración:** Verificar flujos completos
3. **Tests de performance:**
   - Medir latencia antes/después
   - Simular carga concurrente
4. **Tests de usuario:**
   - Traducciones repetidas
   - Conversaciones largas
   - Solicitudes complejas vs simples

## Archivos Clave para Revisión

1. `src/core/ai/httpClient.ts` - timeout base
2. `src/voice/lib/gemini.js` - lógica de generación
3. `src/voice/hooks/useFluVoiceAssistant.js` - flujo principal
4. `src/server/geminiProxy.ts` - cache server-side
5. `src/App.tsx` - manejo de respuestas
6. `src/voice/lib/fluSpeech.js` - TTS

## Próximos Pasos

1. **Aprobación del plan** - revisar con equipo
2. **Implementar Fase 1** (timeouts adaptativos)
3. **Medir impacto** con métricas reales
4. **Iterar** basado en resultados
5. **Continuar** con fases siguientes

---

*Este plan busca optimizar sin romper funcionalidad existente, priorizando cambios de bajo riesgo con alto impacto en la experiencia de usuario.*