# Validación Integral del Flujo de Participación FLU (OS4 vs OS3)

## Resumen

Este documento registra la validación exhaustiva del flujo completo de participación de FLU en OS4, comparado contra OS3, después de aplicar todas las correcciones identificadas.

---

## Punto #1: `onEmotion` callback — PRESENTE Y CORRECTO

**Archivo**: [`src/voice/hooks/useFluParticipant.js`](../src/voice/hooks/useFluParticipant.js:60)

- ✅ `onEmotion` está en la firma de la función (línea 60)
- ✅ `ignoredFiredRef` existe y se inicializa en `false` (línea 79)
- ✅ `scheduleHandTimeout` llama `onEmotion?.('ignored')` con guardia `ignoredFiredRef` (líneas 130-133)
- ✅ `runEvaluation` llama `onEmotion?.('raised')` cuando la mano se levanta (línea 238)
- ✅ `consumeRaisedDraftPublic` llama `onEmotion?.('granted')` (línea 358)
- ✅ `resetParticipant` resetea `ignoredFiredRef.current = false` (línea 320)
- ✅ `dismissRaisedHandPublic` resetea `ignoredFiredRef.current = false` (línea 334)
- ✅ `consumeRaisedDraftPublic` resetea `ignoredFiredRef.current = false` (línea 352)

**Estado**: ✅ CORRECTO

---

## Punto #2: `onEmotion` wiring en App.tsx — PRESENTE Y CORRECTO

**Archivo**: [`src/App.tsx`](../src/App.tsx:256)

- ✅ `useFluParticipant` recibe `onEmotion` callback (línea 256)
- ✅ El callback llama `participantEmotionRef.current?.(event)` (línea 257)
- ✅ Para evento `'ignored'`, construye `SystemEvent`, hace dedup, y llama `injectDialogueEntry` (líneas 258-286)
- ✅ `participantEmotionRef` se pasa a `FluAvatarVoiceBridge` como `onParticipantEmotionRef` (línea 1327)
- ✅ `FluAvatarVoiceBridge` expone `triggerParticipantEmotion` vía ref (líneas 229-238)

**Estado**: ✅ CORRECTO

---

## Punto #3: `triggerParticipantEmotion` en useAvatarVoiceSync — PRESENTE Y CORRECTO

**Archivo**: [`src/hooks/useAvatarVoiceSync.ts`](../src/hooks/useAvatarVoiceSync.ts:288)

- ✅ Maneja evento `'raised'` con DATA-DRIVEN `PARTICIPANT_ALTERNATIVES` (líneas 292-301)
- ✅ Maneja otros eventos (`'granted'`, `'ignored'`, `'rejected'`) con `resolveTriggerExpression` (líneas 304-311)
- ✅ `applyResolved` aplica la expresión y animación al avatar

**Estado**: ✅ CORRECTO

---

## Punto #4: `onTurnCommitted` — LLAMADO UNA SOLA VEZ POR TURN COMMIT

**Archivo**: [`src/voice/lib/conversationStreamCommit.js`](../src/voice/lib/conversationStreamCommit.js:379)

- ✅ Llamado en línea 379 (flujo segmentado) después de `finalizeTurnCommit()`
- ✅ Llamado en línea 427 (flujo no-segmentado) después de `finalizeTurnCommit()`
- ✅ **NO** llamado desde `App.tsx` (comentarios en líneas 459-466 y 621-627 explican por qué)

**Estado**: ✅ CORRECTO — Se eliminaron las llamadas duplicadas de `App.tsx:460` y `App.tsx:622`

---

## Punto #5: `[FLU recuerda]` — INYECTADO COMO DIALOGUE ENTRY, NO COMO SYSTEM PROMPT

**Archivo**: [`src/App.tsx`](../src/App.tsx:275)

- ✅ Se usa `injectDialogueEntry(entry)` en lugar de `setRecentMemory` (línea 285)
- ✅ `injectDialogueEntry` agrega a `dialogueHistoryRef` como entrada de conversación regular
- ✅ Esto evita que Gemini responda sobre "ser ignorado" en lugar de participar naturalmente
- ✅ `setRecentMemoryRef` se mantiene para otros usos pero ya no se usa para `[FLU recuerda]`

**Estado**: ✅ CORRECTO

---

## Punto #6: `syncAvatarToState` SPEAKING handler — DEFENSIVO

**Archivo**: [`src/hooks/useAvatarVoiceSync.ts`](../src/hooks/useAvatarVoiceSync.ts:411)

- ✅ El handler SPEAKING tiene branch `if (alt)` con DATA-DRIVEN expressions
- ✅ Tiene branch `else` con fallback a `setExpression('hablando'/'hablando2')`
- ✅ Esto evita que el avatar se quede sin expresión si no hay `alt` disponible

**Estado**: ✅ CORRECTO

---

## Punto #7: `expressionRegistry` — PARTICIPANT_ALTERNATIVES CORRECTAS

**Archivo**: [`src/core/anim/expressionRegistry.ts`](../src/core/anim/expressionRegistry.ts)

- ✅ `PARTICIPANT_ALTERNATIVES` contiene entradas `{ expression: 'palabra', anims: [...] }` y `{ expression: 'Palabra2', anims: [...] }`
- ✅ `LISTENING_ALTERNATIVES` y `SPEAKING_ALTERNATIVES` también están correctas

**Estado**: ✅ CORRECTO (verificado en diagnóstico anterior)

---

## Punto #8: `getLogSnapshot` — LEE DE `integrationStore.conversationHistory`

**Archivo**: [`src/App.tsx`](../src/App.tsx:226)

- ✅ Lee `integrationStore.conversationHistory` (línea 227)
- ✅ Retorna `{ texts, speakers }` mapeado del historial (líneas 229-230)
- ✅ Dependencia: `[integrationStore.conversationHistory]` (línea 232)
- ✅ `integrationStore.addConversationEntry` es síncrono (Zustand `set`), por lo que la lectura es consistente

**Estado**: ✅ CORRECTO

---

## Punto #9: `canScheduleParticipantEvaluation` — CONDICIONES CORRECTAS

**Archivo**: [`src/voice/lib/fluParticipant.js`](../src/voice/lib/fluParticipant.js:195)

- ✅ Verifica `cfg.enabled` (línea 197)
- ✅ Verifica `conversationActive` (línea 200)
- ✅ Verifica `evaluateOnTurnCommit` (línea 203)
- ✅ Verifica `evaluateEveryNTurns` (línea 206)
- ✅ Verifica `state.phase` no es 'evaluating' (línea 209)
- ✅ Verifica `cooldownUntil` (línea 212)
- ✅ Verifica `maxInterventionsPerSession` (línea 215)
- ✅ Verifica `maxInterventionsPerHour` (línea 218)
- ✅ Verifica `turnCount >= minTurnsBeforeEvaluation` (línea 221)

**Estado**: ✅ CORRECTO

---

## Punto #10: Flujo completo de participación — VERIFICADO

### Secuencia correcta:

1. **Usuario habla** → `conversationStreamCommit.js` procesa el turno
2. **`finalizeTurnCommit()`** → actualiza `logRowsTextRef`/`logRowSpeakersRef`
3. **`fluParticipantRef.current?.onTurnCommitted?.()`** → UNA SOLA VEZ
4. **`onTurnCommitted`** en `useFluParticipant.js`:
   - Verifica `cfg.enabled`, `evaluateOnTurnCommit`, `conversationActiveRef`
   - Llama `shouldEvaluateParticipantOnTurn` (verifica `turnsSinceLastEval + 1 >= evaluateEveryNTurns`)
   - Si no toca evaluar: `advanceParticipantTurnCounter` (incrementa `turnsSinceLastEval`)
   - Si toca evaluar: `advanceParticipantTurnCounter` + `runEvaluation()`
5. **`runEvaluation`**:
   - Verifica `canScheduleParticipantEvaluation` (múltiples condiciones)
   - Construye `buildParticipantLogWindow` con últimas N entradas
   - Llama `requestParticipantEvaluation` (Gemini)
   - `normalizeParticipantEvaluation` → `applyParticipantEvaluation`
   - Si fase = 'raised': `scheduleHandTimeout()` + `onEmotion?.('raised')`
6. **`onEmotion('raised')`** → `participantEmotionRef.current` → `triggerParticipantEmotion('raised')`
7. **`triggerParticipantEmotion('raised')`** → DATA-DRIVEN `PARTICIPANT_ALTERNATIVES` → avatar muestra chip rojo
8. **Timeout de mano levantada** (si no se concede):
   - `scheduleHandTimeout` → `shouldAutoDismissRaisedHand` → `dismissRaisedHand`
   - `onEmotion?.('ignored')` → `buildSystemConversationEntry` → `injectDialogueEntry`
9. **Concesión de palabra** (`FLU_ADELANTE`):
   - `consumeRaisedDraftPublic` → `onEmotion?.('granted')`
   - `triggerParticipantEmotion('granted')` → avatar muestra expresión de concesión

**Estado**: ✅ FLUJO COMPLETO VERIFICADO

---

## Resumen de Correcciones Aplicadas

| # | Corrección | Archivo | Líneas | Estado |
|---|-----------|---------|--------|--------|
| 1 | `onEmotion` callback + `ignoredFiredRef` | `useFluParticipant.js` | 60, 79, 130-133, 238, 320, 334, 352, 358 | ✅ |
| 2 | `else` branch defensivo en SPEAKING | `useAvatarVoiceSync.ts` | ~424 | ✅ |
| 3 | `[FLU recuerda]` de `setRecentMemory` → `injectDialogueEntry` | `App.tsx` | 275-285 | ✅ |
| 4 | Eliminar `onTurnCommitted()` duplicado en rawOnly | `App.tsx` | 459-466 (comentario) | ✅ |
| 5 | Eliminar `onTurnCommitted()` duplicado en respuestaVoz | `App.tsx` | 621-627 (comentario) | ✅ |

## TypeScript Compila Sin Errores

✅ `npx tsc --noEmit` — 0 errores

---

*Documento generado el 2026-07-22 como parte de la validación integral del flujo de participación FLU.*
