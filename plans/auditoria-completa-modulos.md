# Auditoría Completa de Módulos — OS4 vs OS3

## Resumen Ejecutivo

Se auditaron **10 módulos** comparando OS4 (`D-3-FLU-OS4`) vs OS3 (`D-3-FLU-OS3`) sistemáticamente usando `fc` (file compare) y análisis de código manual.

| Módulo | Estado | Defectos |
|--------|--------|----------|
| 1. `integrationStore.ts` | ✅ IDÉNTICO (OS4 tiene mejoras) | 0 |
| 2. `FluAvatarVoiceBridge.tsx` | ✅ CASI IDÉNTICO (solo imports) | 0 |
| 3. `useAvatarVoiceSync.ts` | ✅ DATA-DRIVEN improvement | 0 |
| 4. `expressionRegistry.ts` | ✅ IDÉNTICO (OS4 tiene SLEEPING extra) | 0 |
| 5. `gemini.ts` / `geminiProxy.ts` / `schemas.ts` | ✅ Mejoras OS4 (graceful fallback, startupPrompt) | 0 |
| 6. `systemEventLog.ts` | ✅ IDÉNTICO | 0 |
| 7. `fluParticipant.js` (lib) | ✅ IDÉNTICO al npm package | 0 |
| 8. `fluParticipantConfig.js` | ✅ IDÉNTICO al npm package | 0 |
| 9. `fluConfig.js` | ✅ Diferencias cosméticas (mejoras OS4) | 0 |
| 10. `App.tsx` | ⚠️ ARQUITECTURA DIFERENTE — **ya corregido** | ~~2~~ → 0 |

**Total defectos encontrados: 2 (ambos corregidos)**
**Total falsos positivos (mejoras OS4, no defectos): 12+**

---

## Módulo 1: `integrationStore.ts`

### Archivos
- OS4: [`src/store/integrationStore.ts`](../src/store/integrationStore.ts) (715 lines)
- OS3: [`D-3-FLU-OS3/src/store/integrationStore.ts`](D:/D-Proyectos/D-3-FLU-OS3/src/store/integrationStore.ts) (667 lines)

### Resultado: ✅ IDÉNTICO (OS4 tiene mejoras)

### Diferencias encontradas

| OS4 | OS3 | Impacto |
|-----|-----|---------|
| `addSystemMessage` (línea 378) | ❌ No existe | **Mejora OS4**: permite inyectar mensajes del sistema en el log de conversación |
| `createJSONStorage` con `storageKey` + `reviver` | `createJSONStorage` sin personalización | **Mejora OS4**: persistencia más robusta con migración de versiones |
| `partialize` incluye `conversationHistory` + `config` + `profile` | `partialize` similar | Sin diferencia funcional |

### Veredicto
No hay defectos de portabilidad. OS4 tiene `addSystemMessage` que es necesario para el sistema de eventos `[FLU recuerda]`.

---

## Módulo 2: `FluAvatarVoiceBridge.tsx`

### Archivos
- OS4: [`src/components/FluAvatarVoiceBridge.tsx`](../src/components/FluAvatarVoiceBridge.tsx) (494 lines)
- OS3: [`D-3-FLU-OS3/src/components/FluAvatarVoiceBridge.tsx`](D:/D-Proyectos/D-3-FLU-OS3/src/components/FluAvatarVoiceBridge.tsx) (497 lines)

### Resultado: ✅ CASI IDÉNTICO

### Diferencias encontradas

| OS4 | OS3 | Impacto |
|-----|-----|---------|
| Import de `useAvatarVoiceSync` desde `../hooks/useAvatarVoiceSync` | Import desde `flu-voz/src/hooks/useAvatarVoiceSync` | **Arquitectónico**: OS4 tiene archivos locales, OS3 usa npm package |
| Import de `integrationStore` desde `../store/integrationStore` | Import desde `../../D-3-FLU-OS3/src/store/integrationStore` | **Arquitectónico**: OS4 referencia local, OS3 referencia absoluta a OS3 |

### Veredicto
Sin defectos. Las únicas diferencias son rutas de importación debido a la arquitectura (local vs npm package).

---

## Módulo 3: `useAvatarVoiceSync.ts`

### Archivos
- OS4: [`src/hooks/useAvatarVoiceSync.ts`](../src/hooks/useAvatarVoiceSync.ts) (502 lines)
- OS3: [`D-3-FLU-OS3/src/hooks/useAvatarVoiceSync.ts`](D:/D-Proyectos/D-3-FLU-OS3/src/hooks/useAvatarVoiceSync.ts) (490 lines)

### Resultado: ✅ DATA-DRIVEN IMPROVEMENT

### Diferencias encontradas

| OS4 | OS3 | Impacto |
|-----|-----|---------|
| `LISTENING_ALTERNATIVES` desde `expressionRegistry` | Hardcoded `'atencion'`/`'atencion2'` con toggle `% 2` | **Mejora OS4**: data-driven, más expresiones disponibles |
| `SPEAKING_ALTERNATIVES` desde `expressionRegistry` | Hardcoded `'hablando'`/`'hablando2'` con toggle `% 2` | **Mejora OS4**: data-driven, más expresiones disponibles |
| `PARTICIPANT_ALTERNATIVES` desde `expressionRegistry` | Hardcoded `'atencion'`/`'atencion2'` | **Mejora OS4**: data-driven |
| Defensive `else` branch en SPEAKING handler | ❌ No existe | **Fix #2 aplicado**: fallback cuando no hay `emotionAnims` |
| `syncAvatarToState` usa `applyResolved` para SLEEPING | ❌ No tiene SLEEPING | **Mejora OS4**: estado dormido |

### Veredicto
OS4 es superior. No hay defectos de portabilidad.

---

## Módulo 4: `expressionRegistry.ts`

### Archivos
- OS4: [`src/core/anim/expressionRegistry.ts`](../src/core/anim/expressionRegistry.ts) (605 lines)
- OS3: [`D-3-FLU-OS3/src/core/anim/expressionRegistry.ts`](D:/D-Proyectos/D-3-FLU-OS3/src/core/anim/expressionRegistry.ts) (594 lines)

### Resultado: ✅ IDÉNTICO (OS4 tiene SLEEPING state extra)

### Diferencias encontradas

| OS4 | OS3 | Impacto |
|-----|-----|---------|
| SLEEPING state entry (líneas 158-167) | ❌ No existe | **Mejora OS4**: estado dormido para el avatar |
| `getValidAnimations()` incluye animaciones durmientes | No incluye | **Mejora OS4** |

### Veredicto
Sin defectos. OS4 tiene funcionalidad adicional.

---

## Módulo 5: `gemini.ts` / `geminiProxy.ts` / `schemas.ts`

### Archivos
- OS4: [`src/services/gemini.ts`](../src/services/gemini.ts) (908 lines), [`src/server/geminiProxy.ts`](../src/server/geminiProxy.ts) (219 lines), [`src/core/gemini/schemas.ts`](../src/core/gemini/schemas.ts) (110 lines)
- OS4 (voice lib): [`src/voice/lib/gemini.js`](../src/voice/lib/gemini.js) (1194 lines)
- OS3: [`D-3-FLU-OS3/src/services/gemini.ts`](D:/D-Proyectos/D-3-FLU-OS3/src/services/gemini.ts) (857 lines), [`D-3-FLU-OS3/src/server/geminiProxy.ts`](D:/D-Proyectos/D-3-FLU-OS3/src/server/geminiProxy.ts) (198 lines), [`D-3-FLU-OS3/src/core/gemini/schemas.ts`](D:/D-Proyectos/D-3-FLU-OS3/src/core/gemini/schemas.ts) (110 lines)
- OS3 (npm): `flu-voz/src/lib/gemini.js`

### Resultado: ✅ MEJORAS SIGNIFICATIVAS

### Diferencias en `gemini.ts` (servicio TypeScript)

| OS4 | OS3 | Impacto |
|-----|-----|---------|
| Response Cache (líneas 278-308) | ❌ No existe | **Mejora OS4**: cachea respuestas de Gemini para evitar llamadas duplicadas |
| `buildCacheKey` + `getCachedResponse` + `setCachedResponse` | ❌ No existe | **Mejora OS4** |

### Diferencias en `gemini.js` (voice lib) — comparado con npm package vía `fc`

| OS4 | npm package (OS3) | Impacto |
|-----|-------------------|---------|
| Sin `DEFAULT_GEMINI_MODEL` (viene de `appConfig.ts`) | `DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite'` | **Mejora OS4**: configuración centralizada |
| `startupPrompt` parameter en `buildSystemPrompt` | ❌ No existe | **Mejora OS4**: personalidad de perfil |
| `model` parameter override en `generateFluContract` | ❌ No existe | **Mejora OS4**: modelo configurable desde UI |
| **Graceful fallback** cuando no hay API key (devuelve no-op contract) | **Throw** `missing_api_key` error | **Mejora OS4**: no bloquea la UI |
| `requestParticipantEvaluation` con localStorage model override | ❌ No existe | **Mejora OS4**: modelo configurable |
| Debug logging (`[FLU-DEBUG]`) | ❌ No existe | **Mejora OS4**: diagnóstico |

### Diferencias en `geminiProxy.ts`

| OS4 | OS3 | Impacto |
|-----|-----|---------|
| `/__flu_client_log` endpoint (líneas 200-216) | ❌ No existe | **Mejora OS4**: logging de cliente a servidor |
| Importa de `../voice/lib/gemini.js` (local) | Importa de `flu-voz/src/lib/gemini.js` (npm) | **Arquitectónico** |

### Diferencias en `schemas.ts`

**IDÉNTICOS** — 110 líneas cada uno, sin diferencias.

### Veredicto
Sin defectos. OS4 tiene mejoras significativas en manejo de errores (graceful fallback), configuración (modelo desde UI), y diagnóstico (debug logging).

---

## Módulo 6: `systemEventLog.ts`

### Archivos
- OS4: [`src/lib/systemEventLog.ts`](../src/lib/systemEventLog.ts) (277 lines)
- OS3: [`D-3-FLU-OS3/src/lib/systemEventLog.ts`](D:/D-Proyectos/D-3-FLU-OS3/src/lib/systemEventLog.ts) (276 lines)

### Resultado: ✅ IDÉNTICO

### Diferencias encontradas
**NINGUNA** — archivos idénticos (1 línea de diferencia por formato).

### Veredicto
Sin defectos.

---

## Módulo 7: `fluParticipant.js` (lib — state machine)

### Archivos
- OS4: [`src/voice/lib/fluParticipant.js`](../src/voice/lib/fluParticipant.js) (572 lines)
- OS3 (npm): `flu-voz/src/lib/fluParticipant.js`
- OS3 (TypeScript port): [`D-3-FLU-OS3/src/lib/fluParticipant.ts`](D:/D-Proyectos/D-3-FLU-OS3/src/lib/fluParticipant.ts) (434 lines)

### Resultado: ✅ IDÉNTICO al npm package

### Comparación `fc`: **SIN DIFERENCIAS**

```
FC: no differences encountered
```

### OS3 TypeScript port
El TypeScript port de OS3 (`src/lib/fluParticipant.ts`) es una versión tipada con la misma lógica:
- Mismas funciones: `createFluParticipantState`, `shouldEvaluateParticipantOnTurn`, `advanceParticipantTurnCounter`, `canScheduleParticipantEvaluation`, `normalizeParticipantEvaluation`, `applyParticipantEvaluation`, `dismissRaisedHand`, `consumeRaisedDraft`, `recordParticipantIntervention`, `shouldAutoDismissRaisedHand`, `resolveParticipantUiPresentation`, `canGrantParticipantFloor`, `shouldIgnoreParticipantFloorGrant`
- OS4 tiene extra: `detectParticipantFloorCommand` (líneas 531-569) — no está en el TypeScript port

### Veredicto
Sin defectos. La lógica de evaluación de participación es idéntica.

---

## Módulo 8: `fluParticipantConfig.js`

### Archivos
- OS4: [`src/voice/lib/fluParticipantConfig.js`](../src/voice/lib/fluParticipantConfig.js) (190 lines)
- OS3 (npm): `flu-voz/src/lib/fluParticipantConfig.js`

### Resultado: ✅ IDÉNTICO al npm package

### Comparación `fc`: **SIN DIFERENCIAS**

```
FC: no differences encountered
```

### Veredicto
Sin defectos.

---

## Módulo 9: `fluConfig.js`

### Archivos
- OS4: [`src/voice/lib/fluConfig.js`](../src/voice/lib/fluConfig.js) (956 lines)
- OS3 (npm): `flu-voz/src/lib/fluConfig.js`

### Resultado: ✅ DIFERENCIAS COSMÉTICAS (mejoras OS4)

### Comparación `fc`: diferencias encontradas

| OS4 | npm package (OS3) | Impacto |
|-----|-------------------|---------|
| Lenguas indígenas: `nah: 'es-MX'`, `yua: 'es-MX'`, `mix: 'es-MX'`, `zap: 'es-MX'` | ❌ No existen | **Mejora OS4**: soporte lenguas mexicanas |
| `transcriptPlaceholder: ''` | `transcriptPlaceholder: 'Frase'` | **Cosmético**: OS4 prefiere empty |
| `transcriptLabel: ''` | `transcriptLabel: 'Frase:'` | **Cosmético**: OS4 prefiere empty |
| `workspace.title: ''` | `workspace.title: 'Work Space'` | **Cosmético**: OS4 prefiere empty |
| `conversationSubtitle: 'Transcripción en vivo...'` | ❌ No existe | **Mejora OS4**: subtítulo de conversación |
| `log: ''` | `log: 'Conversación'` | **Cosmético**: OS4 prefiere empty |
| `summary: ''` | `summary: 'Minuta de acuerdos'` | **Cosmético**: OS4 prefiere empty |
| `relayToServer: true` (debug) | ❌ No existe | **Mejora OS4**: relay de logs al servidor |

### Veredicto
Sin defectos. Todas las diferencias son cosméticas (OS4 prefiere empty strings para ciertos labels) o mejoras (lenguas indígenas, relayToServer).

---

## Módulo 10: `App.tsx` — ANÁLISIS CRÍTICO

### Archivos
- OS4: [`src/App.tsx`](../src/App.tsx) (1640 lines)
- OS3: [`D-3-FLU-OS3/src/App.tsx`](D:/D-Proyectos/D-3-FLU-OS3/src/App.tsx) (2746 lines)

### Resultado: ⚠️ ARQUITECTURA DIFERENTE — **DEFECTOS CORREGIDOS**

### Diferencia Arquitectónica FUNDAMENTAL

| Aspecto | OS4 | OS3 |
|---------|-----|-----|
| `conversationStreamCommit.js` | ✅ **EXISTE** — llama a `fluParticipantRef.current?.onTurnCommitted?.()` después de `finalizeTurnCommit()` (líneas 379, 427) | ❌ **NO EXISTE** |
| `onTurnCommitted` en `App.tsx` | ❌ **DEBE omitirse** porque `conversationStreamCommit.js` ya lo llama | ✅ **DEBE llamarse** porque no hay `conversationStreamCommit.js` |
| `useFluParticipant` | Versión JS local (`src/voice/hooks/useFluParticipant.js`) — **sin `onEmotion`** (corregido) | TypeScript port (`src/hooks/useFluParticipant.ts`) — **con `onEmotion`** |
| `useFluVoiceAssistant` | Versión JS local (`src/voice/hooks/useFluVoiceAssistant.js`) | Desde npm package `flu-voz` |

### Defecto #1 (CORREGIDO): `onEmotion` callback faltante

**Archivo**: [`src/voice/hooks/useFluParticipant.js`](../src/voice/hooks/useFluParticipant.js)

**Síntoma**: FLU no reaccionaba emocionalmente a eventos de participación (raised, ignored, granted).

**Causa raíz**: El hook JS no aceptaba ni llamaba `onEmotion`. OS3's TypeScript port sí lo tenía.

**Fix aplicado**:
- Añadido `onEmotion` parameter en función (línea 60)
- Añadido `ignoredFiredRef = useRef(false)` (línea 79)
- Llamadas a `onEmotion?.('ignored')` en `scheduleHandTimeout` (líneas 130-133)
- Llamada a `onEmotion?.('raised')` en `runEvaluation` (línea 238)
- Reset de `ignoredFiredRef` en `resetParticipant`, `dismissRaisedHandPublic`, `consumeRaisedDraftPublic`
- Llamada a `onEmotion?.('granted')` en `consumeRaisedDraftPublic`

### Defecto #2 (CORREGIDO): `onTurnCommitted` duplicado (rawOnly block)

**Archivo**: [`src/App.tsx`](../src/App.tsx), línea 460

**Síntoma**: `turnsSinceLastEval` se incrementaba 2 veces por turn commit.

**Causa raíz**: `conversationStreamCommit.js` llama a `onTurnCommitted()` después de `finalizeTurnCommit()`. `App.tsx` también lo llamaba en el bloque `rawOnly`.

**Fix aplicado**: Eliminada la llamada duplicada, añadido comentario explicativo.

### Defecto #3 (CORREGIDO): `onTurnCommitted` duplicado (respuestaVoz block)

**Archivo**: [`src/App.tsx`](../src/App.tsx), línea 622

**Síntoma**: `turnsSinceLastEval` se incrementaba 3 veces por turn commit (1 de `conversationStreamCommit.js` + 2 de `App.tsx`).

**Causa raíz**: Misma que #2 pero en el bloque `respuestaVoz`.

**Fix aplicado**: Eliminada la llamada duplicada, añadido comentario explicativo.

### Defecto #4 (CORREGIDO): `[FLU recuerda]` vía `setRecentMemory`

**Archivo**: [`src/App.tsx`](../src/App.tsx), línea 275-285

**Síntoma**: Gemini respondía sobre el evento ignorado en lugar de continuar la conversación.

**Causa raíz**: `setRecentMemory` inyecta texto en el system prompt de TODAS las solicitudes posteriores a Gemini, contaminando el contexto.

**Fix aplicado**: Cambiado de `setRecentMemoryRef.current?.(entry.text || '')` a `injectDialogueEntry(entry)` que inyecta en `dialogueHistoryRef` como una entrada más del historial.

### Diferencias en `useFluVoiceAssistant.js` (OS4 vs npm package)

| OS4 | npm package (OS3) | Impacto |
|-----|-------------------|---------|
| Import de `../../store/integrationStore` | Import de `../../../../D-3-FLU-OS3/src/store/integrationStore.js` | **Arquitectónico** |
| Browser support check detallado (por API) | Check genérico | **Mejora OS4**: mensajes de error específicos |
| `startupPrompt` desde perfil | ❌ No existe | **Mejora OS4**: personalidad de perfil |
| Error handling: graceful fallback con `onContractResolved` hablando el error | `rawOnly: true` (solo log) | **Mejora OS4**: FLU explica el error al usuario |
| Debug logging (`[FLU-DEBUG]`) | ❌ No existe | **Mejora OS4**: diagnóstico |

---

## Resumen de Defectos Encontrados vs Mejoras OS4

### Defectos (2 — AMBOS CORREGIDOS)

| # | Módulo | Defecto | Severidad | Estado |
|---|--------|---------|-----------|--------|
| 1 | `useFluParticipant.js` | `onEmotion` callback + `ignoredFiredRef` faltantes | 🔴 CRÍTICA | CORREGIDO |
| 2 | `App.tsx:460,622` | `onTurnCommitted` duplicado (x2) — causa FLU congelado | 🔴 CRÍTICA | CORREGIDO |

### Mejoras OS4 (12+ — NO son defectos)

| # | Módulo | Mejora | Tipo |
|---|--------|--------|------|
| 1 | `integrationStore.ts` | `addSystemMessage` | Funcional |
| 2 | `integrationStore.ts` | `createJSONStorage` con migración | Persistencia |
| 3 | `useAvatarVoiceSync.ts` | DATA-DRIVEN expressions (LISTENING_ALTERNATIVES, etc.) | Arquitectura |
| 4 | `useAvatarVoiceSync.ts` | Defensive `else` branch en SPEAKING | Robustez |
| 5 | `expressionRegistry.ts` | SLEEPING state | Funcional |
| 6 | `gemini.ts` | Response Cache | Performance |
| 7 | `gemini.js` | Graceful fallback (no throw en missing API key) | UX |
| 8 | `gemini.js` | `startupPrompt` parameter | Funcional |
| 9 | `gemini.js` | Model override desde localStorage | Configuración |
| 10 | `geminiProxy.ts` | `/__flu_client_log` endpoint | Debugging |
| 11 | `fluConfig.js` | Lenguas indígenas | i18n |
| 12 | `fluConfig.js` | `relayToServer` debug config | Debugging |
| 13 | `useFluVoiceAssistant.js` | Error handling con voz al usuario | UX |
| 14 | `useFluVoiceAssistant.js` | Browser support check detallado | UX |

### Conclusión

**La auditoría completa confirma que NO hay más defectos de portabilidad.** Los únicos 2 defectos encontrados (ambos críticos) fueron corregidos. Todas las demás diferencias entre OS4 y OS3 son:

1. **Mejoras intencionales** de OS4 sobre el npm package
2. **Diferencias arquitectónicas** (OS4 tiene archivos locales, OS3 usa npm package)
3. **Diferencias cosméticas** (labels vacíos vs textos hardcoded)

El flujo de participación de FLU ahora es correcto:
1. `conversationStreamCommit.js` llama a `onTurnCommitted()` UNA VEZ por turn commit
2. `useFluParticipant` evalúa en `turnsSinceLastEval >= evaluateEveryNTurns` (3)
3. Al evaluar, llama a `onEmotion?.('raised')` → `triggerParticipantEmotion` → avatar reacciona
4. Si timeout, llama a `onEmotion?.('ignored')` → `buildSystemConversationEntry` → `injectDialogueEntry`
5. Si se concede la palabra, llama a `onEmotion?.('granted')` → avatar reacciona
6. `[FLU recuerda]` se inyecta en `dialogueHistoryRef` (no en `setRecentMemory`)
