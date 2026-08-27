# Todo List: Optimización de Latencia - Prioridad Alta

## Objetivo
Implementar las tres mejoras de prioridad alta de manera autónoma y coordinada para reducir la latencia percibida por el usuario.

## Estado General: ✅ COMPLETADO (1 de 4 subitems pendiente por restricción de tests)

- ✅ **Optimización 1 - System Prompt:** 1.1, 1.2 y 1.4 implementados. 1.3 (capacidades resumidas) **PENDIENTE**.
- ✅ **Optimización 2 - Timers de Settle:** 2.1 y 2.2 implementados.
- ✅ **Optimización 3 - Indicador Visual:** 3.1 a 3.6 implementados.
- ✅ **Validación:** `tsc -b` OK · `npm test` → 56 archivos / 1230 tests en verde.

---

## 1. Optimización del System Prompt

### 1.1 Condensar bloque IDIOMA en gemini.js ✅ COMPLETADO
**Archivo:** `src/voice/lib/gemini.js`
**Líneas:** 377-378
**Cambio:** Reducir de ~1200 caracteres a ~200 caracteres manteniendo la semántica
**Nuevo contenido:**
```javascript
isEnglish
  ? 'LANGUAGE — Respond in the configured language. If the user asks for another language, answer ENTIRELY in that language without announcing it. For translations, translate previous content into the requested language. Never mix languages.'
  : 'IDIOMA — Responde en el idioma configurado. Si el usuario pide otro idioma, responde ENTERAMENTE en ese idioma sin anunciarlo. Para traducciones, traduce el contenido previo al idioma pedido. Nunca mezcles idiomas.'
```

### 1.2 Configuración bajo demanda ✅ COMPLETADO
**Archivo:** `src/voice/lib/gemini.js`
**Función:** `buildSystemPrompt` y `buildUserPrompt`
**Cambio:** Mover `configPrompt` a condicional basado en `intent.comando` y palabras clave
**Implementación:**
1. Crear función `shouldIncludeConfigPrompt(transcript, intent)` que retorne `true` si:
   - `intent.comando` es de configuración (ej: "set_config", "set_branding")
   - `transcript` contiene palabras clave: "configura", "ajusta", "cambia", "set", "pon"
2. En `buildSystemPrompt`, envolver `...configPrompt` en condicional
3. En `buildUserPrompt`, mover `configPrompt` a user message cuando sea necesario

### 1.3 Capacidades resumidas ⏸️ PENDIENTE (compromiso por tests)
**Archivo:** `src/services/capabilities.ts`
**Función:** `buildCapabilitiesPrompt`
**Cambio:** Reducir tamaño eliminando playlist completa y manteniendo solo reglas críticas
**Nuevo contenido (resumen):**
- Mantener cabecera y lista de capacidades
- Eliminar playlist completa (mantener solo referencia)
- Mantener reglas de música obligatoria y honestidad
- Reducir ~600 caracteres a ~300 caracteres

> **Motivo de la pausa:** `tests/musicCapabilities.test.ts` (L316-339) exige que
> `buildCapabilitiesPrompt(es/en)` liste el playlist completo. Compactarlo rompería
> 2 tests. Si se decide aplicar, habría que actualizar también dichos tests.

### 1.4 Prefijo estable para caching ✅ COMPLETADO
**Archivo:** `src/voice/lib/gemini.js`
**Cambio:** Mover variables dinámicas (`recentMemory`, `agendaText`, `startupPrompt`) de system prompt a user message
**Beneficio:** System prompt byte-idéntico entre turnos → mejor caching en OpenRouter/OpenAI

## 2. Reducción de Timers de Settle

### 2.1 Modificar valores en fluConfig.js ✅ COMPLETADO
**Archivo:** `src/voice/lib/fluConfig.js`
**Sección:** `timing` (líneas 245-269)
**Cambios aplicados:**
- `transcriptSettleMaxMs`: 500 → 300 (40% reducción)
- `conversationSettleStableMs`: 120 → 80 (33% reducción)
- `scheduleAutoProcessDelayMs`: 450 → 250 (44% reducción)
**Total reducción:** ~440ms (de ~1070ms a ~630ms)

### 2.2 Validar tests ✅ COMPLETADO
**Acción:** Ejecutar tests para verificar que no se rompe funcionalidad.
**Resultado:** Suite completa en verde (1230 tests). Sin regresiones en timers/settle.

## 3. Indicador Visual de Procesamiento

### 3.1 Añadir campo `isThinking` a UIState ✅ COMPLETADO
**Archivo:** `src/store/integrationStore.ts`
**Cambio:** Añadido `isThinking: boolean` a `UIState`, con `initialState.uiState.isThinking: false`.
**Nota:** `partialize` ya excluye `uiState` → campo efímero (no se persiste).

### 3.2 Añadir acción `setThinking` ✅ COMPLETADO
**Archivo:** `src/store/integrationStore.ts`
**Cambio:** Añadida `setThinking: (isThinking: boolean) => void` a `IntegrationActions` e implementada en el store creator.
**Extra (safety net):** `setConversationState` apaga `isThinking` al salir de `THINKING`, evitando que el overlay quede "pegado".

### 3.3 Integrar en flujo IA ✅ COMPLETADO (diseño: puntos de entrada cliente)
**Archivo:** `src/voice/hooks/useFluVoiceAssistant.js` (flujo principal de voz)
**Cambio:** En `requestFluContractForTranscript`: `setThinking(true)` tras `setConversationState('THINKING')` y `try/finally` con `setThinking(false)`.
**Archivo:** `src/components/FluAvatarVoiceBridge.tsx` (texto tecleado)
**Cambio:** `store.setThinking(true)` en `handleSpeak` + `finally { store.setThinking(false); }` en `processText`.
> **Decisión de diseño:** NO se integró en `generateFluContract` (lib pura) para no acoplar el store a funciones libres y no romper los tests que la invocan directamente. Las consultas locales de minutos (early return) no encienden el overlay.

### 3.4 Crear hook `useThinkingIndicator` ✅ COMPLETADO
**Archivo:** `src/hooks/useThinkingIndicator.ts` (nuevo)
**Contenido:** Hook que observa `uiState.isThinking` vía `useIntegrationStore` y expone `{ isThinking }`.
**Regla de determinismo:** gated SOLO por `isThinking` (no se combina con `conversationState`).

### 3.5 Crear componente visual ✅ COMPLETADO
**Archivo:** `src/components/ThinkingIndicator.tsx` (nuevo)
**Contenido:** Pill no bloqueante (fixed, bottom-center, `pointer-events: none`, z-index 9999) con spinner + "FLU está pensando...".
**UX:** retraso de entrada de 150ms (evita parpadeo en respuestas rápidas), desmontaje inmediato, `role="status"` + `aria-live="polite"`, keyframes self-contained.

### 3.6 Integrar en App.tsx ✅ COMPLETADO
**Archivo:** `src/App.tsx`
**Cambio:** Import de `ThinkingIndicator` y renderizado `<ThinkingIndicator />` justo antes de `</main>`.

## Orden de Ejecución Recomendado

1. **Optimización system prompt** (más fácil, impacto inmediato)
   - 1.1 Condensar bloque IDIOMA ✅
   - 1.3 Capacidades resumidas ⏸️ (pendiente)
   - 1.2 Configuración bajo demanda ✅
   - 1.4 Prefijo estable ✅

2. **Reducción timers** (simple, bajo riesgo)
   - 2.1 Modificar valores en fluConfig.js ✅
   - 2.2 Validar tests ✅

3. **Indicador visual** (requiere cambios en store y UI)
   - 3.1 Añadir campo `isThinking` ✅
   - 3.2 Añadir acción `setThinking` ✅
   - 3.3 Integrar en flujo IA ✅
   - 3.4 Crear hook `useThinkingIndicator` ✅
   - 3.5 Crear componente `ThinkingIndicator` ✅
   - 3.6 Integrar en App.tsx ✅

## Métricas de Éxito Esperadas

1. **Reducción tokens system prompt**: 50% menos (de ~3000 a ~1500 tokens) — aplicada parcialmente (sin 1.3).
2. **Reducción latencia artificial**: 400ms menos (de ~1070ms a ~670ms) — aplicada (timers 300/80/250).
3. **Feedback visual**: Tiempo entre usuario habla y spinner < 200ms — aplicada (setThinking inmediato + 150ms de entrada).
4. **Caching mejorado**: System prompt byte-idéntico entre turnos para mejor caching — aplicada (1.4).

## Archivos Modificados

1. `src/voice/lib/gemini.js` (optimización prompt) ✅
2. `src/services/capabilities.ts` (capacidades resumidas) ⏸️ pendiente
3. `src/core/config/voiceConfigCatalog.ts` (config prompt condicional) ✅
4. `src/voice/lib/fluConfig.js` (timers reducidos) ✅
5. `src/store/integrationStore.ts` (campo `isThinking` y acción) ✅
6. `src/hooks/useThinkingIndicator.ts` (nuevo hook) ✅
7. `src/components/ThinkingIndicator.tsx` (nuevo componente) ✅
8. `src/App.tsx` (integración componente) ✅

## Validación

1. ✅ Ejecutar tests existentes: `npm test` → 56 archivos / 1230 tests en verde
2. ⏸️ Ejecutar tests E2E: `npm run test:e2e` (opcional, requiere entorno con Playwright + servidor)
3. ⏸️ Probar flujo completo manualmente
4. ⏸️ Medir latencia antes/después con console.time (no medido automáticamente)

## Notas Importantes

- **Modo actual:** Code (necesario para editar archivos .js/.ts/.tsx)
- **Modo requerido:** Architect (solo puede editar archivos .md)
- **Coordinación:** Las optimizaciones se implementaron en el orden especificado
- **Riesgos:** Reducir timers demasiado podría causar procesamiento prematuro → monitorear tests
- **Pendiente único:** 1.3 (capacidades resumidas) — requiere actualizar `tests/musicCapabilities.test.ts`
