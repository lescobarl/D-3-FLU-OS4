# Root Cause Analysis: FLU Congelado (No Participa)

## Resumen Ejecutivo

El usuario reporta que después de recargar la página, FLU:
1. ✅ Transcribe correctamente (Hablante 1 y Hablante 2)
2. ❌ No reacciona a las participaciones de los humanos
3. ❌ No alza la mano (chip rojo no se prende)
4. ❌ No se prende el chip superior
5. ❌ En general, FLU está congelado

El proxy log muestra que Gemini respondió a "platicame de los aviones" con:
> "Me siento realmente molesto y triste porque levanté la mano, esperé un tiempo razonable y nadie me cedió la palabra..."

Esto indica que el sistema **SÍ** está inyectando el evento `[FLU recuerda]` en el contexto de Gemini, pero Gemini está respondiendo **a ese evento** en lugar de participar naturalmente.

---

## Análisis de la Arquitectura

### Flujo de Participación (useFluParticipant)

```
App.tsx (useFluParticipant)
  ↓ onEmotion callback
  ├── participantEmotionRef → FluAvatarVoiceBridge → triggerParticipantEmotion → syncAvatarToState
  └── injectDialogueEntry → inyecta "[FLU recuerda]" en dialogueHistoryRef

conversationStreamCommit.js
  ↓ fluParticipantRef.current?.onTurnCommitted?.()
  └── useFluParticipant.onTurnCommitted()
       ├── check cfg.enabled && cfg.evaluateOnTurnCommit
       ├── check conversationActiveRef?.current
       ├── shouldEvaluateParticipantOnTurn() → turnsSinceLastEval >= evaluateEveryNTurns (3)
       ├── advanceParticipantTurnCounter()
       └── runEvaluation()
            ├── canScheduleParticipantEvaluation()
            ├── requestParticipantEvaluation() → Gemini API
            ├── normalizeParticipantEvaluation()
            ├── applyParticipantEvaluation()
            └── if phase === 'raised' → onEmotion?.('raised')
```

---

## ROOT CAUSE #4 (CRÍTICO — RECIÉN DESCUBIERTO): `onTurnCommitted` se llama 2 VECES por turn commit

### El Problema

**`onTurnCommitted` se invoca DOS VECES por cada turn commit**, lo que duplica el contador `turnsSinceLastEval` y causa que la evaluación del participante se dispare en el turno equivocado (turno 2 en lugar de turno 3).

### Flujo de llamadas duplicadas

En [`conversationStreamCommit.js`](../src/voice/lib/conversationStreamCommit.js), el flujo de commit es:

```
Líneas 357-379 (ruta segmentada) o líneas 409-427 (ruta no segmentada):

1. emitConversationLog(capture, {...})         ← línea 358/410
   └── llama a onContractResolved(payload)
       └── App.tsx línea 460: fluParticipant.onTurnCommitted()  ← PRIMERA LLAMADA 🚨

2. commitTurnToSessionRows(capture, speaker)    ← línea 370/422

3. finalizeTurnCommit()                         ← línea 378/426

4. fluParticipantRef.current?.onTurnCommitted?.() ← línea 379/427 ← SEGUNDA LLAMADA 🚨
```

**Ambas llamadas invocan la MISMA función en la MISMA instancia** porque:
- `fluParticipant` en `App.tsx` línea 250 es la misma instancia que `fluParticipantRef.current` en `useFluVoiceAssistant` (línea 496-497, 505)
- `fluParticipantRef` se pasa a `conversationStreamCommit.js` como `fluParticipantRef` (línea 1609)

### Consecuencia: El contador se duplica

En [`useFluParticipant.js:280-304`](../src/voice/hooks/useFluParticipant.js:280):

```javascript
const onTurnCommitted = useCallback(() => {
    const cfg = getFluParticipantConfig()
    if (!cfg.enabled || cfg.evaluateOnTurnCommit === false) return
    if (!conversationActiveRef?.current) return

    if (!shouldEvaluateParticipantOnTurn(stateRef.current, cfg)) {
        stateRef.current = advanceParticipantTurnCounter(stateRef.current, cfg)
        return  // ← Solo incrementa, no evalúa
    }

    stateRef.current = advanceParticipantTurnCounter(stateRef.current, cfg)
    void runEvaluation()
}, [conversationActiveRef, runEvaluation])
```

Con `evaluateEveryNTurns = 3`:

| Turno | 1ra llamada | 2da llamada | turnsSinceLastEval |
|-------|-------------|-------------|-------------------|
| Turn 1 | `shouldEvaluate?` No (0+1 < 3) → incrementa a 1 | `shouldEvaluate?` No (1+1 < 3) → incrementa a 2 | 2 |
| Turn 2 | `shouldEvaluate?` No (2+1 = 3, nextCount >= 3) → **¡EVALÚA!** → resetea a 0 | `shouldEvaluate?` Sí (0+1 < 3) → incrementa a 1 | 1 |
| Turn 3 | `shouldEvaluate?` No (1+1 < 3) → incrementa a 2 | `shouldEvaluate?` No (2+1 = 3) → **¡EVALÚA!** → resetea a 0 | 0 |

**La evaluación se dispara en el Turno 2 (después de solo 2 turns humanos) en lugar del Turno 3.** Esto significa que Gemini recibe muy poco contexto de conversación para evaluar, y probablemente devuelve `shouldParticipate: false` porque "no hay suficiente conversación".

### Por qué no se detectó antes

- En OS3, `useFluParticipant` se instancia DENTRO de `useFluVoiceAssistant` (no en `App.tsx`)
- OS3 NO tiene la llamada duplicada en `onContractResolved`
- OS4 movió `useFluParticipant` a `App.tsx` (para compartir la instancia con la UI) y agregó la llamada `fluParticipant.onTurnCommitted()` en `onContractResolved` (línea 460) como "OS2 parity"
- Pero `conversationStreamCommit.js` YA llama a `fluParticipantRef.current?.onTurnCommitted?.()` después de `finalizeTurnCommit()`

### La Solución

**Eliminar la llamada duplicada** en [`App.tsx:460`](../src/App.tsx:460):

```typescript
// ELIMINAR:
fluParticipant.onTurnCommitted();
```

La única llamada debe ser la que está en `conversationStreamCommit.js` (líneas 379 y 427), que ocurre DESPUÉS de que `commitTurnToSessionRows` haya actualizado `logRowsTextRef`/`logRowSpeakersRef`.

---

## ROOT CAUSE #2: `[FLU recuerda]` inyectado como `setRecentMemory` contamina el prompt de Gemini

### El Problema

En [`App.tsx:284`](../src/App.tsx:284), cuando ocurre `onEmotion('ignored')`:

```typescript
setRecentMemoryRef.current?.(entry.text || '');
```

Esto llama a `setRecentMemory(text)` que se expone desde `useFluVoiceAssistant`. El texto `[FLU recuerda] Me enojé porque levanté la mano...` se inyecta en el system prompt de Gemini en el próximo `requestFluContract`.

### Por qué esto causa comportamiento incorrecto

1. El evento `participant_ignored` se dispara cuando el timeout de mano alzada expira
2. `setRecentMemory` inyecta el texto en el prompt de Gemini
3. Gemini interpreta esto como "FLU está molesto porque lo ignoraron"
4. En la siguiente interacción, Gemini responde **como si FLU estuviera procesando esa emoción**
5. En lugar de participar en la conversación actual, Gemini habla de "sentirse ignorado"

### Estado de la corrección

✅ **YA CORREGIDO** — Cambiado de `setRecentMemory` a `injectDialogueEntry` en `App.tsx:275-285`.

---

## ROOT CAUSE #3: `useFluParticipant` en `App.tsx` usa `session` con `theme: ''`

### El Problema

En [`App.tsx:254`](../src/App.tsx:254):

```typescript
const fluParticipant = useFluParticipant({
    apiKey,
    language,
    conversationActiveRef,
    session: { role: sessionRole, theme: '' },
    getLogSnapshot,
    onEmotion: (event) => { ... },
});
```

El `session.theme` se pasa como `''` (vacío). En `runEvaluation` (useFluParticipant.js línea 219):

```javascript
theme: session.theme || FLU_CONFIG.sessionDefaults.theme,
```

Si `FLU_CONFIG.sessionDefaults.theme` también está vacío, Gemini recibe un tema vacío para la evaluación del participante, lo que puede resultar en evaluaciones inconsistentes.

---

## ROOT CAUSE #5: La evaluación de Gemini puede devolver `shouldParticipate: false` consistentemente

### El Problema

En [`useFluParticipant.js:229-240`](../src/voice/hooks/useFluParticipant.js:229):

```javascript
const normalized = normalizeParticipantEvaluation(result.evaluation, cfg)
stateRef.current = applyParticipantEvaluation(stateRef.current, normalized, cfg)
if (stateRef.current.phase === 'raised') {
    scheduleHandTimeout()
    onEmotion?.('raised')
}
```

Si Gemini consistentemente devuelve `shouldParticipate: false` (o confianza baja), el estado nunca llega a `'raised'` y FLU nunca alza la mano.

### Por qué podría pasar

- El `[FLU recuerda]` en el prompt de Gemini (vía `setRecentMemory`) hace que Gemini piense que FLU está emocionalmente afectado
- Gemini decide que FLU "no debe participar" porque está "molesto"
- Esto crea un ciclo: FLU es ignorado → se inyecta `[FLU recuerda]` → Gemini decide no participar → FLU es ignorado otra vez

---

## Resumen de Correcciones Aplicadas

| # | Fix | Archivo | Estado |
|---|-----|---------|--------|
| 1 | `onEmotion` callback + `ignoredFiredRef` en `useFluParticipant.js` | `src/voice/hooks/useFluParticipant.js` | ✅ Aplicado |
| 2 | Defensive `else` branch en SPEAKING handler | `src/hooks/useAvatarVoiceSync.ts` | ✅ Aplicado |
| 3 | `[FLU recuerda]` de `setRecentMemory` a `injectDialogueEntry` | `src/App.tsx:275-285` | ✅ Aplicado |
| 4 | **Eliminar `fluParticipant.onTurnCommitted()` duplicado** | `src/App.tsx:460` | ✅ Aplicado |

## Próximos Pasos Recomendados

1. **Probar en runtime** — Recargar la página y verificar que FLU ahora:
   - Alza la mano después de 3 turns humanos
   - El chip rojo se prende
   - FLU responde cuando se le concede la palabra
2. **Verificar que `[FLU recuerda]` ya no contamina** — El mensaje debe aparecer en el log de conversación pero NO debe hacer que Gemini responda sobre "sentirse ignorado"
3. **Monitorear la evaluación de Gemini** — Verificar que `shouldParticipate: true` se devuelva con suficiente confianza
