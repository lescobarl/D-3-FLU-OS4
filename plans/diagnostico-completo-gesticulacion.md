# Diagnóstico Completo: Gesticulación (Movimiento de Boca) de FLU

## Resumen Ejecutivo

FLU no mueve la boca (no gesticula) cuando habla por **entrada de voz**. La entrada de texto (Push-to-Talk) funciona correctamente. La animación `MouthMove` nunca se carga en el visor 3D. El servidor proxy de Gemini funciona (contrato se genera), pero el callback `onContractResolved` en App.tsx — que activa `setConversationState('SPEAKING')` — **no ejecuta su código de diagnóstico** (el `relayLog` de App.tsx línea 912 nunca aparece en el servidor).

---

## 1. Síntomas

| Síntoma | Observación | Evidencia |
|---------|-------------|-----------|
| Boca no se mueve con voz | `MouthMove` NUNCA se carga | Server log solo muestra `FBX cargado exitosamente: Idle_3` |
| Boca "semiabierta" estática | `Idle_3` (pose con boca entreabierta) es la única animación cargada | BunnyViewer nunca carga `Idle_2` ni `MouthMove` |
| FLU "como en cámara lenta" | Posible doble procesamiento o contención de recursos | Ver sección 5 |
| FLU se congela después de hablar | Estado nunca transiciona de vuelta correctamente | No hay `setConversationState('IDLE')` desde `onContractResolved` |
| `[LOG][] undefined` cada ~10s | Código legacy llama `relayLog('LOG', '', undefined)` | Server handler imprime `undefined` para message vacío |
| Entrada de texto (Push-to-Talk) funciona | Gesticulación correcta | `FluAvatarVoiceBridge.handleSpeak` → `store.setConversationState('SPEAKING')` directo |
| E2E test pasa | Pipeline de animación íntegro | `validate-speaking-gesture.spec.ts` |

---

## 2. Pipeline de Animación (FUNCIONA)

```
setConversationState('SPEAKING')
  → useAvatarVoiceSync.ts syncAvatarToState()
    → SPEAKING case → alt.expression (ej: 'hablando')
      → integrationStore.setExpression('hablando')
        → bunnyStore.ts: currentExpression='hablando', blendQueue=['Idle_2','MouthMove']
          → BunnyViewer.tsx useEffect
            → FBXLoader carga Idle_2.fbx + MouthMove.fbx
              → AnimationMixer.play('MouthMove') → boca se mueve
```

**E2E test** y **text input** confirman que este pipeline funciona. El problema está en que **nunca se llama a `setConversationState('SPEAKING')`** cuando la entrada es por voz.

---

## 3. Flujo de Voz (NO FUNCIONA - diagnóstico)

### 3.1 Arquitectura

```
1. Usuario habla → micCapture → SpeechRecognition → texto
2. useFluVoiceAssistant.js: processCapture() o processConversationFluQuery()
3. → requestFluContractForTranscript() → fetch(/api/gemini/contract)
4. → geminiProxy.ts handleContract() → generateFluContract() → Gemini API
5. → parseGeminiApiResponse() → contrato con respuesta_voz, emocion, etc.
6. → onContractResolved?.(contract) → App.tsx callback
7. → App.tsx: speakFlu(respuestaVoz) → TTS + setConversationState('SPEAKING') → MOUTH MOVE!
```

### 3.2 Estado Actual

| Paso | Estado | Evidencia |
|------|--------|-----------|
| 1. Captura de voz | ✅ Micrófono captura audio | Usuario puede hablar |
| 2. processCapture() | ❓ No confirmado | No hay `relayLog` desde este código |
| 3. proxy fetch | ✅ Funciona | `[FLU-DEBUG-PROXY] handleContract success...` aparece |
| 4. Gemini genera contrato | ✅ Funciona | respuesta_voz tiene contenido |
| 5. parseGeminiApiResponse | ✅ Funciona | Contrato parseado correctamente |
| 6. onContractResolved?.() | ❌ **NO SE EJECUTA** o falla antes de línea 912 | relayLog de App.tsx NUNCA aparece |
| 7. setConversationState('SPEAKING') | ❌ Nunca se llama | MouthMove nunca se carga |

### 3.3 Punto de Falla

**El callback `onContractResolved` en App.tsx (línea 659-1092) no ejecuta su código**, específicamente no alcanza la línea 912:

```typescript
// Línea 912 - NUNCA aparece en server
relayLog('LOG', 'App', `onContractResolved: emocion="..."`);
```

Esto significa que UNA de estas opciones ocurre:

**A.** `onContractResolved` nunca es llamado por `useFluVoiceAssistant.js`
**B.** `onContractResolved` es llamado pero lanza una excepción ANTES de la línea 912
**C.** El contrato recibido no cumple las condiciones para llegar a la línea 912

---

## 4. Análisis de Causas Raíz

### 4.1 ✗ Hipótesis Descartada: Instancia Dual de useFluVoiceAssistant

**DESCARTADA.** FluShell.jsx [NUNCA se renderiza](src/App.tsx:1766) — App.tsx solo importa [`FluShellTabs`](src/voice/components/FluShellTabs.jsx), no `FluShell`. Las referencias a FluShell en App.tsx son solo comentarios de "OS2 parity". Solo hay UNA instancia de `useFluVoiceAssistant`.

### 4.2 ✓ Hipótesis Principal: `conversationActiveRef` Previene Ejecución

En [`processConversationFluQuery`](src/voice/hooks/useFluVoiceAssistant.js:2664):

```javascript
if (!conversationActiveRef?.current || !question) return
```

Si `conversationActiveRef.current` es `false`, la función retorna inmediatamente SIN llamar `onContractResolved`.

En [`processCapture`](src/voice/hooks/useFluVoiceAssistant.js:2889-2894):

```javascript
if (conversationActiveRef?.current && snapshot) {
    if (await awaitConversationAction(snapshot, { interim: false, source: 'capture' })) {
        return
    }
    return  // ← SIEMPRE retorna aquí cuando conversationActiveRef.current = true
}
```

Y cuando `conversationActiveRef.current = false` (línea 2896+), el flujo requiere **wake word** ("OK FLU") para continuar. Sin wake word, el flujo retorna en línea 2986 sin llamar `onContractResolved`.

**Conclusión:** Si el usuario no está en modo conversación Y no dice "OK FLU", el audio se captura pero se descarta. `onContractResolved` nunca se llama.

**Pero:** Si el usuario SÍ dice "OK FLU" (wake word), el flujo DEBERÍA continuar y llamar `onContractResolved`.

### 4.3 ✓ Hipótesis: Excepción Silenciosa Antes de Línea 912

En [`onContractResolved`](src/App.tsx:659), entre la entrada (línea 659) y el relayLog (línea 912), hay varias operaciones que podrían lanzar:

| Línea | Operación | Riesgo |
|-------|-----------|--------|
| 780 | `selectMinuteForLookup()` | Podría retornar objeto inválido |
| 788 | `setSelectedMinuteId(minuteSelection.matched.id)` | **CRASH si `matched` es undefined** |
| 803 | `workspaceImage.clear()` | Podría lanzar si workspaceImage no está inicializado |
| 829-881 | Post-procesamiento de emociones | String operations, bajo riesgo |

Si `selectMinuteForLookup` retorna un objeto donde `matched` es undefined, la línea 788 lanza: `Cannot read properties of undefined (reading 'id')`. Esto ocurriría **ANTES** de la línea 912, por lo que el relayLog nunca se ejecutaría.

Sin embargo, el catch en `processConversationFluQuery` (línea 2761) DEBERÍA capturar este error y llamar `onContractResolved` con un mensaje de error, lo que también pasaría por la línea 912... A MENOS que el error sea tan severo que colapse la promesa antes de que el catch se active.

### 4.4 ✓ Hipótesis: Diferencia Entre Entrada de Voz y Texto

La entrada de texto ([`FluAvatarVoiceBridge.handleSpeak`](src/components/FluAvatarVoiceBridge.tsx:317)) funciona porque **BYPassA** completamente `onContractResolved`. Llama directamente:

```typescript
store.setConversationState('THINKING');
// ... obtiene contrato ...
store.setConversationState('SPEAKING');
```

Este flujo no depende del callback `onContractResolved`. La entrada de voz en cambio SÍ depende de él. Son dos flujos completamente diferentes.

### 4.5 ✓ Hipótesis: `speakFlu` Después del Callback (Closure)

[`speakFlu`](src/App.tsx:1112) se declara DESPUÉS de [`onContractResolved`](src/App.tsx:659) en el componente:

```
Línea 659: onContractResolved = useCallback(async (resolved) => {
    // ... usa speakFlu en línea 916 ...
}, [])
Línea 1112: const { speakFlu } = useNavigationCommands(...)
```

Aunque JavaScript closures capturan el BINDING de la variable (no el valor), el uso de `useCallback` con dependencia vacía `[]` captura el closure del PRIMER render. En el primer render, `speakFlu` es inicializado correctamente por `useNavigationCommands`. **Esto NO debería causar un crash**, pero es un antipatrón que merece corrección.

---

## 5. Análisis de "Cámara Lenta"

El síntoma de "como en cámara lenta" tiene posibles causas:

1. **Doble inicialización de reconocimiento de voz**: Si `startListening` se llama múltiples veces, hay múltiples instancias de SpeechRecognition compitiendo. El `[LOG][] undefined` periódico (~10s) podría ser un keepalive o fallo de reconocimiento.

2. **Renderizado excesivo**: El callback `onContractResolved` (cuando se ejecuta) hace múltiples llamadas a Zustand store (`setConversationState`, `setFluSpeaking`, `setLastResponse`, `addFluMessage`, etc.), cada una disparando re-renders.

3. **Contención de WebGL**: Si BunnyViewer está recargando animaciones constantemente (por ejemplo si `currentAnimation` o `blendQueue` cambian en un bucle), el pipeline de Three.js se satura.

4. **RelayLog flooding**: La función `flush()` envía logs en lote cada 200ms. Si hay muchos logs, esto podría causar contienda de red.

---

## 6. Línea de Tiempo de la Falla

```
Usuario habla
  → mic captura audio (OK)
  → SpeechRecognition produce texto (OK)
  → processCapture() se ejecuta (?) 
    → Si conversationActiveRef.current = true:
      → awaitConversationAction() → processConversationFluQuery()
        → requestFluContractForTranscript() → proxy (OK - [FLU-DEBUG-PROXY] aparece)
        → onContractResolved?.() → ???
          → relayLog línea 912: NO APARECE
          → speakFlu(): ??? (FLU habla? o no?)
          → setConversationState('SPEAKING'): NO EJECUTA
    → Si conversationActiveRef.current = false:
      → requireWake = true
      → extractFluVoiceCommand con wake word
        → Si wake word encontrada: procesa (¿llega a onContractResolved?)
        → Si NO wake word: descarta silenciosamente
```

El eslabón perdido es: **¿Qué pasa dentro de `processConversationFluQuery` entre la recepción del contrato (línea 2709) y la llamada a `onContractResolved` (línea 2748)?**

---

## 7. Plan de Corrección

### Fase 1: Diagnóstico en Tiempo Real (SIN MODIFICAR LÓGICA)

Agregar `relayLog` en puntos clave del flujo de voz para identificar EXACTAMENTE dónde falla:

1. **[`useFluVoiceAssistant.js:2664`](src/voice/hooks/useFluVoiceAssistant.js:2664)**: Log si `conversationActiveRef?.current` es false → explain why processConversationFluQuery exits early
2. **[`useFluVoiceAssistant.js:2709`](src/voice/hooks/useFluVoiceAssistant.js:2709)**: Log receipt of contract → confirm contract arrives
3. **[`useFluVoiceAssistant.js:2748`](src/voice/hooks/useFluVoiceAssistant.js:2748)**: Log BEFORE `onContractResolved?.()` → confirm it's called
4. **[`useFluVoiceAssistant.js:2761`](src/voice/hooks/useFluVoiceAssistant.js:2761)**: Log catch block → detect errors
5. **[`useFluVoiceAssistant.js:2889-2894`](src/voice/hooks/useFluVoiceAssistant.js:2889-2894)**: Log which path processCapture takes
6. **[`useFluVoiceAssistant.js:2960`](src/voice/hooks/useFluVoiceAssistant.js:2960)**: Log wake word validation result

### Fase 2: Corrección del Flujo de Voz

1. **Asegurar que `setConversationState('SPEAKING')` se llame SIEMPRE** que FLU va a hablar, independientemente del path.
2. **Mover `speakFlu` + `setConversationState`** a un helper separado que se llame desde todos los paths del callback.
3. **Corregir el orden de declaración** de `speakFlu` y `onContractResolved` para eliminar el antipatrón de closure.
4. **Agregar try/catch** alrededor de `selectMinuteForLookup` y `workspaceImage.clear()` para evitar que excepciones interrumpan el flujo principal.

### Fase 3: Validación Visual

1. Cargar portal
2. Probar entrada de voz: "OK FLU, cuéntame algo"
3. Verificar en server log:
   - `[CLIENT-LOG][LOG][useFluVoiceAssistant]` → confirma path
   - `[CLIENT-LOG][LOG][App] onContractResolved` → confirma callback
   - `[CLIENT-LOG][LOG][BunnyViewer] FBX cargado exitosamente: MouthMove` → confirma animación
4. Verificar visualmente que la boca se mueve

---

## 8. Conclusión

La causa raíz más probable es que **`onContractResolved` nunca se ejecuta** porque:

1. **`conversationActiveRef.current` es `false`** → `processConversationFluQuery` retorna en línea 2664
2. **Y el wake word no se detecta** → `processCapture` retorna en línea 2986 sin llamar `onContractResolved`

O alternativamente:

3. **`onContractResolved` se ejecuta pero lanza una excepción** (posiblemente en `selectMinuteForLookup` o `workspaceImage.clear()`) **ANTES de la línea 912**, y la excepción no se registra adecuadamente.

El plan de corrección agrega diagnóstico para identificar el punto exacto de falla, corrige la vulnerabilidad de excepciones tempranas, y asegura que `setConversationState('SPEAKING')` se llame en todos los paths.

**Dato crítico:** La entrada de texto (Push-to-Talk) funciona porque NO depende de `onContractResolved`. Llama directamente a `store.setConversationState('SPEAKING')`. La entrada de voz SÍ depende de `onContractResolved`. Son arquitecturas diferentes.
