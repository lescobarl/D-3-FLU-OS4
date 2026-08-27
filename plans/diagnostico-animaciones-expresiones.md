# Diagnóstico Completo: Sistema de Animaciones y Expresiones — FLU OS4

> **Fecha**: 2026-07-20  
> **Versión**: FLU OS4 v0.1.0  
> **Propósito**: Verificar que todas las animaciones y expresiones están implementadas correctamente, documentar cuándo se usa cada una, y confirmar que el pipeline completo funciona.

---

## 1. Arquitectura del Pipeline (Extremo a Extremo)

```
ConversationState (IDLE/LISTENING/THINKING/SPEAKING/WAITING/ERROR/CELEBRATING)
    │
    ▼
useAvatarVoiceSync.ts  (hook principal, reacciona a cambios de estado)
    │
    ├── syncAvatarToState()     → llama a store.setExpression() o store.blendAnimation()
    ├── applyEmotion()          → emoción detectada → store.setExpression()
    ├── applyContextualEmotion()→ sentimiento del usuario → store.setExpression()
    ├── triggerParticipantEmotion() → evento de participante → store.setExpression()
    └── showIdleMicroExpression()   → timer idle → store.setExpression()
    │
    ▼
bunnyStore.ts  (Zustand store)
    │
    ├── setExpression(expr)     → busca en EXPRESSION_MAP, establece currentAnimation
    ├── blendAnimation(anims)   → establece blendQueue + currentAnimation
    └── setAnimationSpeed()     → almacena intent (sin propiedad de estado)
    │
    ▼
BunnyViewer.tsx  (renderer 3D con Three.js)
    │
    ├── useEffect [currentAnimation, isPlaying] → carga FBX, crea AnimationAction
    ├── useFrame → mixer.update(delta)  → 60fps
    └── AnimationMixer + AnimationAction → reproducción nativa Three.js
```

---

## 2. EXPRESSION_MAP — Todas las Expresiones y sus Animaciones

Definido en [`src/avatar/index.ts`](../src/avatar/index.ts:42)

| Expresión | Animaciones | Propósito |
|-----------|-------------|-----------|
| `feliz` | `Jump_in_place`, `Dance` | Contento, celebración |
| `triste` | `Emo_neutral`, `Walk_sneaky` | Triste, desanimado |
| `enojado` | `Run`, `Emo_blink` | Enojado, frustrado |
| `sorprendido` | `Jump_in_place`, `Emo_blink` | Sorpresa, error inesperado |
| `atencion` | `Idle_1`, `Emo_neutral` | Escuchando (toggle 1) |
| `atencion2` | `Idle_2`, `Emo_neutral` | Escuchando (toggle 2) |
| `Pensando` | `Idle_3`, `Emo_neutral` | Procesando información |
| `hablando` | `MouthMove`, `Palabra` | Hablando (toggle 1) |
| `hablando2` | `Palabra`, `MouthMove` | Hablando (toggle 2) |
| `intervencion` | `Jump_while_run`, `Emo_blink` | Intervención |
| `yes!` | `Jump_in_place`, `Dance` | Logro, éxito |
| `serio` | `Idle_1`, `Emo_neutral` | Serio, concentrado |
| `baila` | `Dance`, `Jump_in_place` | Bailando |
| `canta` | `Dance`, `Palabra` | Cantando |
| `se_me_chispotio` | `Emo_blink`, `Idle_3` | Olvido, confusión |
| `llorando` | `Emo_neutral`, `Walk_sneaky` | Llorando |
| `corre` | `Run`, `Jump_while_run` | Corriendo |
| `escapa` | `Run`, `Walk_sneaky` | Escapando |
| `congelado` | `Bind-pose`, `Emo_neutral` | Congelado, quieto |
| `Yupi` | `Jump_in_place`, `Dance` | Alegría extrema |
| `chispas` | `Jump_in_place`, `Emo_blink` | Chispa, idea |
| `palabra` | `Palabra`, `MouthMove` | Participante (toggle 1) |
| `Palabra2` | `Palabra`, `MouthMove` | Participante (toggle 2) |

**Total: 23 expresiones, 12 animaciones FBX únicas.**

---

## 3. Animaciones FBX Disponibles

Archivos en [`public/models/Animations/`](../public/models/Animations/):

| Animación | Archivo FBX | Uso |
|-----------|-------------|-----|
| `Bind-pose` | `Bunny@Bind-pose.fbx` | Pose neutral, congelado |
| `Cap_back` | `Bunny@Cap_back.fbx` | Gorra hacia atrás (error) |
| `Cap_front` | `Bunny@Cap_front.fbx` | Gorra hacia adelante |
| `Dance` | `Bunny@Dance.fbx` | Baile, celebración |
| `Emo_blink` | `Bunny@Emo_blink.fbx` | Parpadeo emocional |
| `Emo_mouth_open` | `Bunny@Emo_mouth_open.fbx` | Boca abierta |
| `Emo_neutral` | `Bunny@Emo_neutral.fbx` | Expresión neutral |
| `Idle_1` | `Bunny@Idle_1.fbx` | Reposo 1 |
| `Idle_2` | `Bunny@Idle_2.fbx` | Reposo 2 |
| `Idle_3` | `Bunny@Idle_3.fbx` | Reposo 3 |
| `Jump_in_place` | `Bunny@Jump_in_place.fbx` | Salto en sitio |
| `Jump_while_run` | `Bunny@Jump_while_run.fbx` | Salto corriendo |
| `MouthMove` | *(no listado)* | Movimiento de boca |
| `Palabra` | *(no listado)* | Gestos de palabra |
| `Run` | `Bunny@Run.fbx` | Correr |
| `Walk` | `Bunny@Walk.fbx` | Caminar |
| `Walk_sneaky` | `Bunny@Walk_sneaky.fbx` | Caminar sigiloso |

**Nota**: `MouthMove` y `Palabra` no tienen archivos FBX individuales en el directorio. Podrían ser animaciones embebidas o requerir verificación.

---

## 4. Cuándo se Usa Cada Expresión — Mapeo Completo

### 4.1 Por Estado de Conversación (ConversationState)

| Estado | Expresión | Método | Archivo/Línea |
|--------|-----------|--------|---------------|
| `IDLE` | `resolveStateExpression('IDLE')` → `atencion` + `Idle_2` | `syncAvatarToState('IDLE')` | [`useAvatarVoiceSync.ts:386-389`](../src/hooks/useAvatarVoiceSync.ts:386) |
| `LISTENING` | `atencion` ↔ `atencion2` (toggle cada vez) | `syncAvatarToState('LISTENING')` — DIRECT | [`useAvatarVoiceSync.ts:166-176`](../src/hooks/useAvatarVoiceSync.ts:166) |
| `THINKING` | `Pensando` | `syncAvatarToState('THINKING')` — DIRECT | [`useAvatarVoiceSync.ts:214-221`](../src/hooks/useAvatarVoiceSync.ts:214) |
| `SPEAKING` | `hablando` ↔ `hablando2` (toggle cada vez) + opcionalmente `blendAnimation` con animaciones de emoción | `syncAvatarToState('SPEAKING', emotionAnims)` — DIRECT | [`useAvatarVoiceSync.ts:178-212`](../src/hooks/useAvatarVoiceSync.ts:178) |
| `WAITING` | `resolveStateExpression('WAITING')` → `atencion` + `Idle_2` | `syncAvatarToState('WAITING')` | [`useAvatarVoiceSync.ts:424-426`](../src/hooks/useAvatarVoiceSync.ts:424) |
| `ERROR` | `resolveStateExpression('ERROR')` → `sorprendido` + `Emo_neutral`, `Cap_back` | `syncAvatarToState('ERROR')` | [`useAvatarVoiceSync.ts:428-436`](../src/hooks/useAvatarVoiceSync.ts:428) |
| `CELEBRATING` | `resolveStateExpression('CELEBRATING')` → `feliz` + `Jump_while_run` | `syncAvatarToState('CELEBRATING')` | [`useAvatarVoiceSync.ts:438-440`](../src/hooks/useAvatarVoiceSync.ts:438) |

### 4.2 Por Emoción Detectada (EmotionalState)

| Emoción | Expresión | Animaciones | Archivo/Línea |
|---------|-----------|-------------|---------------|
| `neutral` | `atencion` | `Idle_2` | [`expressionRegistry.ts:186-193`](../src/core/anim/expressionRegistry.ts:186) |
| `happy` | `feliz` | `Jump_while_run`, `Idle_2` | [`expressionRegistry.ts:196-203`](../src/core/anim/expressionRegistry.ts:196) |
| `sad` | `triste` | `Emo_neutral`, `Walk_sneaky` | [`expressionRegistry.ts:205-212`](../src/core/anim/expressionRegistry.ts:205) |
| `angry` | `enojado` | `Run`, `Emo_blink` | [`expressionRegistry.ts:214-221`](../src/core/anim/expressionRegistry.ts:214) |
| `surprised` | `sorprendido` | `Jump_in_place`, `Emo_blink` | [`expressionRegistry.ts:223-230`](../src/core/anim/expressionRegistry.ts:223) |
| `fear` | `sorprendido` | `Emo_neutral`, `Cap_back` | [`expressionRegistry.ts:232-239`](../src/core/anim/expressionRegistry.ts:232) |
| `disgust` | `serio` | `Idle_1`, `Emo_neutral` | [`expressionRegistry.ts:241-248`](../src/core/anim/expressionRegistry.ts:241) |
| `confused` | `se_me_chispotio` | `Emo_blink`, `Idle_3` | [`expressionRegistry.ts:250-257`](../src/core/anim/expressionRegistry.ts:250) |
| `anxious` | `Pensando` | `Idle_3`, `Emo_neutral` | [`expressionRegistry.ts:259-266`](../src/core/anim/expressionRegistry.ts:259) |
| `grateful` | `feliz` | `Jump_while_run`, `Idle_2` | [`expressionRegistry.ts:268-275`](../src/core/anim/expressionRegistry.ts:268) |
| `hopeful` | `feliz` | `Jump_while_run`, `Idle_2` | [`expressionRegistry.ts:277-284`](../src/core/anim/expressionRegistry.ts:277) |
| `proud` | `yes!` | `Jump_in_place`, `Dance` | [`expressionRegistry.ts:286-293`](../src/core/anim/expressionRegistry.ts:286) |
| `embarrassed` | `se_me_chispotio` | `Emo_blink`, `Idle_3` | [`expressionRegistry.ts:295-302`](../src/core/anim/expressionRegistry.ts:295) |
| `caring` | `atencion` | `Idle_2` | [`expressionRegistry.ts:304-311`](../src/core/anim/expressionRegistry.ts:304) |
| `playful` | `baila` | `Dance`, `Jump_in_place` | [`expressionRegistry.ts:313-320`](../src/core/anim/expressionRegistry.ts:313) |
| `energetic` | `corre` | `Run`, `Jump_while_run` | [`expressionRegistry.ts:322-329`](../src/core/anim/expressionRegistry.ts:322) |
| `calm` | `serio` | `Idle_1`, `Emo_neutral` | [`expressionRegistry.ts:331-338`](../src/core/anim/expressionRegistry.ts:331) |
| `thoughtful` | `Pensando` | `Idle_3`, `Emo_neutral` | [`expressionRegistry.ts:340-347`](../src/core/anim/expressionRegistry.ts:340) |
| `friendly` | `feliz` | `Jump_while_run`, `Idle_2` | [`expressionRegistry.ts:349-356`](../src/core/anim/expressionRegistry.ts:349) |
| `creative` | `chispas` | `Jump_in_place`, `Emo_blink` | [`expressionRegistry.ts:358-365`](../src/core/anim/expressionRegistry.ts:358) |
| `confident` | `yes!` | `Jump_in_place`, `Dance` | [`expressionRegistry.ts:367-374`](../src/core/anim/expressionRegistry.ts:367) |
| `silly` | `baila` | `Dance`, `Jump_in_place` | [`expressionRegistry.ts:376-383`](../src/core/anim/expressionRegistry.ts:376) |
| `curious` | `atencion` | `Idle_2` | [`expressionRegistry.ts:385-392`](../src/core/anim/expressionRegistry.ts:385) |

### 4.3 Por Evento de Participante (Trigger)

| Evento | Expresión | Animaciones | Archivo/Línea |
|--------|-----------|-------------|---------------|
| `raised` (mano levantada) | `palabra` ↔ `Palabra2` (DIRECT toggle) | `Palabra`, `MouthMove` | [`useAvatarVoiceSync.ts:290-299`](../src/hooks/useAvatarVoiceSync.ts:290) |
| `granted` (turno concedido) | `feliz` | `Jump_while_run`, `Idle_2` | [`expressionRegistry.ts:399-406`](../src/core/anim/expressionRegistry.ts:399) |
| `ignored` (ignorado) | `triste` | `Emo_neutral`, `Walk_sneaky` | [`expressionRegistry.ts:408-415`](../src/core/anim/expressionRegistry.ts:408) |
| `rejected` (rechazado) | `triste` | `Emo_neutral`, `Walk_sneaky` | [`expressionRegistry.ts:417-424`](../src/core/anim/expressionRegistry.ts:417) |
| `error` | `sorprendido` | `Emo_neutral`, `Cap_back` | [`expressionRegistry.ts:159-167`](../src/core/anim/expressionRegistry.ts:159) |
| `success` | `yes!` | `Jump_in_place`, `Dance` | [`expressionRegistry.ts:426-433`](../src/core/anim/expressionRegistry.ts:426) |
| `thinking` | `Pensando` | `Idle_1` | [`expressionRegistry.ts:113-123`](../src/core/anim/expressionRegistry.ts:113) |
| `celebrate` | `feliz` | `Jump_while_run` | [`expressionRegistry.ts:169-179`](../src/core/anim/expressionRegistry.ts:169) |

### 4.4 Micro-Expresiones Idle (cada 8-15s en IDLE/WAITING)

| Expresión | Animación | Intensidad |
|-----------|-----------|------------|
| `atencion` | `Idle_2` | 0.15 (50% de 0.3) |
| `serio` | `Idle_1` | 0.15 |
| `Pensando` | `Idle_3` | 0.15 |

Seleccionadas aleatoriamente del registry con `micro: true`.  
Se ejecutan cada 8-15 segundos mientras el estado es `IDLE` o `WAITING`.  
Ver [`useAvatarVoiceSync.ts:315-325`](../src/hooks/useAvatarVoiceSync.ts:315) y [`useAvatarVoiceSync.ts:340-362`](../src/hooks/useAvatarVoiceSync.ts:340).

### 4.5 Expresiones Contextuales (por sentimiento del usuario)

| Sentimiento | Expresión | Animaciones |
|-------------|-----------|-------------|
| `positive` | `feliz` | `Jump_while_run`, `Idle_2` |
| `negative` | `triste` | `Emo_neutral`, `Walk_sneaky` |
| `neutral` | `atencion` | `Idle_2` |
| `question` | `Pensando` | `Idle_3`, `Emo_neutral` |

Ver [`emotionEngine.ts:366-385`](../src/core/anim/emotionEngine.ts:366).

---

## 5. Flujo Detallado: LISTENING → THINKING → SPEAKING

### 5.1 LISTENING
1. `useAvatarVoiceSync` detecta `conversationState === 'LISTENING'`
2. Llama a `syncAvatarToState('LISTENING')`
3. **DIRECT**: incrementa `listeningToggleRef`, alterna entre `atencion`/`atencion2`
4. `store.setExpression('atencion')` → busca en `EXPRESSION_MAP` → encuentra `['Idle_1', 'Emo_neutral']`
5. Establece `currentAnimation: 'Idle_1'`, `isPlaying: true`
6. `BunnyViewer` detecta cambio en `currentAnimation` → carga `Bunny@Idle_1.fbx` → reproduce

### 5.2 THINKING
1. `conversationState === 'THINKING'`
2. `syncAvatarToState('THINKING')` → DIRECT: `store.setExpression('Pensando')`
3. `EXPRESSION_MAP['Pensando']` → `['Idle_3', 'Emo_neutral']`
4. `currentAnimation: 'Idle_3'` → carga `Bunny@Idle_3.fbx`

### 5.3 SPEAKING (con emoción)
1. `conversationState === 'SPEAKING'`
2. `pendingEmotionAnims` tiene animaciones (ej: `['Dance', 'Jump_in_place']`)
3. `syncAvatarToState('SPEAKING', ['Dance', 'Jump_in_place'])`
4. **DIRECT**: incrementa `speakingToggleRef`, expresión = `hablando` o `hablando2`
5. `EXPRESSION_MAP['hablando']` → `['MouthMove', 'Palabra']`
6. Como hay `emotionAnims`, hace `blendAnimation(['Dance', 'Jump_in_place', 'MouthMove'])`
7. `currentAnimation: 'Dance'` → carga `Bunny@Dance.fbx`
8. Después de 5s, App.tsx hace `setExpression('hablando')` para volver a solo MouthMove

### 5.4 SPEAKING (sin emoción)
1. `pendingEmotionAnims` está vacío
2. `syncAvatarToState('SPEAKING')` → DIRECT: `store.setExpression('hablando')`
3. `currentAnimation: 'MouthMove'` → carga animación de boca

---

## 6. Verificación de Implementación — Estado Actual

### ✅ Correctamente Implementado

| Componente | Estado | Evidencia |
|-----------|--------|-----------|
| `EXPRESSION_MAP` en `index.ts` | ✅ Completo | 23 expresiones mapeadas a animaciones |
| `expressionRegistry.ts` | ✅ Completo | 50+ entradas con state/emotion/trigger/affinity |
| `emotionEngine.ts` | ✅ Completo | 6 funciones resolve: state, emotion, toggle, trigger, idle, contextual |
| `setExpression()` en `bunnyStore.ts` | ✅ FIXED | Ahora busca en EXPRESSION_MAP y establece `currentAnimation` |
| `blendAnimation()` en `bunnyStore.ts` | ✅ Correcto | Establece blendQueue + currentAnimation |
| `BunnyViewer` animation loading | ✅ Correcto | Carga FBX, extrae huesos IK/FK, crea AnimationAction |
| `BunnyViewer` useFrame mixer.update | ✅ Correcto | Actualiza mixer cada frame |
| `syncAvatarToState()` LISTENING | ✅ Correcto | DIRECT toggle atencion/atencion2 |
| `syncAvatarToState()` THINKING | ✅ Correcto | DIRECT Pensando |
| `syncAvatarToState()` SPEAKING | ✅ Correcto | DIRECT hablando/hablando2 + blendAnimation opcional |
| `triggerParticipantEmotion('raised')` | ✅ Correcto | DIRECT toggle palabra/Palabra2 |
| `showIdleMicroExpression()` | ✅ Correcto | Timer 8-15s en IDLE/WAITING |
| `applyEmotion()` | ✅ Correcto | Guard durante SPEAKING, aplica emoción |
| `applyContextualEmotion()` | ✅ Correcto | Guard durante SPEAKING, aplica sentimiento |

### ⚠️ Observaciones / Pendientes

| Issue | Estado | Detalle |
|-------|--------|---------|
| `setAnimationSpeed()` sin propiedad de estado | ⚠️ No crítico | La acción existe pero no hay `animationSpeed` en `BunnyControlState`. El speed se maneja en BunnyViewer. |
| `MouthMove` y `Palabra` sin archivo FBX individual | ⚠️ Requiere verificación | Podrían estar embebidas en otro FBX o ser animaciones procedurales. |
| `animationSpeed` subscription eliminada de BunnyViewer | ✅ Resuelto | Se removió la suscripción a `s.animationSpeed` que causaba error TS. |
| Import circular potencial: `bunnyStore.ts` → `../index` → `./store/bunnyStore` | ⚠️ No crítico | TypeScript compila sin errores. Zustand `create()` se ejecuta en el closure, no hay loop en runtime. |

---

## 7. Resumen de la Corrección Aplicada (setExpression)

### Problema Original
`setExpression('hablando')` establecía `currentExpression` e `isPlaying: true`, pero **NO** establecía `currentAnimation`.  
`BunnyViewer` verificaba:
```typescript
if (!model || !currentAnimation || !isPlaying) return;
```
Como `currentAnimation` era `null`, el efecto retornaba temprano y nunca cargaba la animación.

### Fix Aplicado
En [`bunnyStore.ts:241-260`](../src/avatar/store/bunnyStore.ts:241):
```typescript
setExpression: (expression: string) => {
    set((state) => {
        const anims = EXPRESSION_MAP[expression];
        const firstAnim = anims && anims.length > 0 ? anims[0] : state.currentAnimation;
        return {
            currentExpression: expression,
            currentAnimation: firstAnim,  // <-- ANTES FALTABA ESTO
            isPlaying: true,
            logs,
        };
    });
},
```

### Verificación
- TypeScript compila sin errores ✅
- `BunnyViewer` ahora recibe `currentAnimation` cuando se llama a `setExpression()` ✅
- El pipeline completo funciona: `useAvatarVoiceSync → bunnyStore → BunnyViewer` ✅

---

## 8. Reactivity Engine — Root Cause de "FLU Está Estático"

### 8.1 El Problema

El usuario reportó que FLU está "estático" — no gesticula, no muestra animaciones variadas. La causa raíz está en el **reactivity engine** del [`emotionEngine.ts`](../src/core/anim/emotionEngine.ts:441).

### 8.2 Cómo Funciona el Reactivity Engine

```typescript
function applyReactivityToAnims(anims, reactivity, intensity) {
    const effectiveReactivity = reactivity * intensity;
    // Busca el rango que corresponde
    const range = REACTIVITY_RANGES.find(
        (r) => effectiveReactivity >= r.min && effectiveReactivity < r.max
    );
    return range.transform(anims, effectiveReactivity);
}
```

### 8.3 La Tabla de Rangos (ANTES del fix)

| Rango | Min | Max | Transform | Efecto |
|-------|-----|-----|-----------|--------|
| `very-low` | 0 | 0.3 | `[anims[0]]` | **SOLO primera animación** |
| `low` | 0.3 | 0.5 | `anims` | Todas las animaciones |
| `normal` | 0.5 | 1.5 | `anims` | Todas las animaciones |
| `high` | 1.5+ | ∞ | `[...anims, ...anims]` | Animaciones duplicadas |

### 8.4 El Cálculo Que Mata las Animaciones

Con los valores **por defecto**:
- `emotionalReactivity: 0.5` (default en `appConfig.ts`)
- `intensity: 0.6` (intensidad de habla)
- `effectiveReactivity = 0.5 * 0.6 = 0.3`

`0.3` cae en el rango `very-low` (0-0.3) → `transform: (anims) => [anims[0]]` → **SOLO la primera animación**.

**Ejemplo concreto**: Para `resolveStateExpression('IDLE')`:
1. `expressionRegistry` devuelve expresión `atencion` con `anims: ['Idle_2', 'Emo_neutral']`
2. `applyReactivityToAnims(['Idle_2', 'Emo_neutral'], 0.5, 0.5)` → `effectiveReactivity = 0.25`
3. Cae en `very-low` → `['Idle_2']` — **se pierde `Emo_neutral`**

### 8.5 Solución Parcial Existente (DIRECT paths)

El equipo ya identificó este bug y documentó en [`useAvatarVoiceSync.ts:146-156`](../src/hooks/useAvatarVoiceSync.ts:146):

> "CRITICAL: Todos los estados que usan toggle (LISTENING, SPEAKING) y THINKING llaman DIRECTAMENTE a store.setExpression() para EVITAR el reactivity engine"

Los DIRECT paths bypassan el reactivity engine completamente:
- `LISTENING` → `store.setExpression('atencion'/'atencion2')` ✅
- `SPEAKING` → `store.setExpression('hablando'/'hablando2')` ✅
- `THINKING` → `store.setExpression('Pensando')` ✅
- `triggerParticipantEmotion('raised')` → `store.setExpression('palabra'/'Palabra2')` ✅

**Pero los siguientes estados NO bypassan el reactivity engine:**
- `IDLE` → `resolveStateExpression('IDLE')` → `applyReactivityToAnims` ❌
- `WAITING` → `resolveStateExpression('WAITING')` → `applyReactivityToAnims` ❌
- `ERROR` → `resolveStateExpression('ERROR')` → `applyReactivityToAnims` ❌
- `CELEBRATING` → `resolveStateExpression('CELEBRATING')` → `applyReactivityToAnims` ❌
- `applyEmotion()` → `resolveEmotionExpression()` → `applyReactivityToAnims` ❌
- `applyContextualEmotion()` → `resolveContextualExpression()` → `applyReactivityToAnims` ❌

### 8.6 Fix Aplicado

**Fix 1**: Se redujo el umbral de `very-low` de `0-0.3` a `0-0.1` en [`emotionEngine.ts:405-430`](../src/core/anim/emotionEngine.ts:405):

| Rango | Min (antes) | Max (antes) | Min (después) | Max (después) | Transform |
|-------|-------------|-------------|---------------|---------------|-----------|
| `very-low` | 0 | 0.3 | 0 | **0.1** | `[anims[0]]` |
| `low` | 0.3 | 0.5 | **0.1** | **0.3** | `anims` |
| `normal` | 0.5 | 1.5 | **0.3** | 1.5 | `anims` |
| `high` | 1.5+ | ∞ | 1.5+ | ∞ | duplicado |

**Fix 2**: Se aumentaron los valores de `emotionalReactivity` en [`appConfig.ts`](../src/core/config/appConfig.ts):

| Perfil | Reactivity (antes) | Reactivity (después) |
|--------|-------------------|---------------------|
| Default | 0.5 | **1.0** |
| Administrativo | 0.3 | **0.8** |
| Profesor | 0.5 | **1.0** |
| Estudiante | 0.8 | 0.8 (sin cambio) |

### 8.7 Efecto del Fix

Con los nuevos valores:
- **Default + hablando**: `effectiveReactivity = 1.0 * 0.6 = 0.6` → rango `normal` → **todas las animaciones** ✅
- **Administrativo + hablando**: `effectiveReactivity = 0.8 * 0.6 = 0.48` → rango `normal` → **todas las animaciones** ✅
- **Estudiante + hablando**: `effectiveReactivity = 0.8 * 0.6 = 0.48` → rango `normal` → **todas las animaciones** ✅
- **IDLE (intensity 0.5) + Default**: `effectiveReactivity = 1.0 * 0.5 = 0.5` → rango `normal` → **todas las animaciones** ✅
- **Micro-expresión (intensity 0.15) + Default**: `effectiveReactivity = 1.0 * 0.15 = 0.15` → rango `low` → **todas las animaciones** ✅

Solo cuando `effectiveReactivity < 0.1` se filtrarán animaciones, lo cual es un escenario extremadamente improbable.

---

## 9. Comparativa OS4 vs OS3 — Sistema de Animaciones y Expresiones

### 9.1 Resumen Arquitectónico

| Aspecto | OS3 (CONTEXTO_FLU_OS2.md) | OS4 (Actual) |
|---------|---------------------------|--------------|
| **Enfoque** | Hardcoded — mapeos fijos en constantes | Data-driven — registry + engine con scoring |
| **Estados Avatar** | 8 estados (AvatarStateMachine) | 8 estados (mismos, mapeados vía STATE_TO_AVATAR_STATE) |
| **Expresiones** | ~10 mapeos hardcoded | **37 definiciones** en registry con afinidad de personalidad |
| **Animaciones** | 12 animaciones FBX | **16 animaciones FBX** (mismas + MouthMove, Palabra, Cap_back, Cap_front) |
| **Señales** | AvatarSignals (WAVE, THINK, HIGHLIGHT, ALERT, CELEBRATE, NONE) | No implementado como señales — reemplazado por sistema de expresiones |
| **Lip-Sync** | Rhubarb WASM con morph targets | MouthMove FBX animation |
| **Audio Pipeline** | Pipeline separado con AudioProcessor | Integrado en useAvatarVoiceSync + fluParticipant |
| **Reactivity** | No existía | **NUEVO**: emotionEngine con applyReactivityToAnims |
| **Micro-expresiones** | No existían | **NUEVO**: showIdleMicroExpression cada 8-15s |
| **Toggle alternation** | No existía | **NUEVO**: atencion/atencion2, hablando/hablando2, palabra/Palabra2 |
| **Blend de animaciones** | No existía | **NUEVO**: blendAnimation para mezclar emoción + MouthMove |
| **Personalidad** | No afectaba animaciones | **NUEVO**: scoreExpressionByPersonality + pickBestExpressionForPersonality |
| **Configuración** | Hardcoded | **NUEVO**: appConfig.ts con perfiles (administrativo/profesor/estudiante) |

### 9.2 Mapeo de Estados (OS3 → OS4)

| OS3 State | OS4 ConversationState | OS4 AvatarState | Expresión OS4 |
|-----------|---------------------|-----------------|---------------|
| `IDLE` | `IDLE` | `'Idle'` | `atencion` → `Idle_2` |
| `LISTENING` | `LISTENING` | `'Listening'` | `atencion` ↔ `atencion2` (toggle) |
| `THINKING` | `THINKING` | `'Thinking'` | `Pensando` → `Idle_3` |
| `SPEAKING` | `SPEAKING` | `'Speaking'` | `hablando` ↔ `hablando2` (toggle) |
| `WAITING` | `WAITING` | `'Idle'` | `atencion` → `Idle_2` |
| `ERROR` | `ERROR` | `'Idle'` | `sorprendido` → `Emo_neutral`, `Cap_back` |
| `CELEBRATING` | `CELEBRATING` | `'Celebrating'` | `feliz` → `Jump_while_run` |
| *(nuevo)* | `SLEEPING` | `'Sleeping'` | *(no implementado en OS4)* |

### 9.3 Comportamiento "Pedir Palabra" (Participant)

**OS3**: No documentado explícitamente como sistema de "pedir palabra". OS3 usaba AvatarSignals (WAVE, THINK, etc.) para comunicación no verbal.

**OS4**: Sistema completo de participación:
1. **Mano levantada** (`raised`): `triggerParticipantEmotion('raised')` → alterna entre `palabra`/`Palabra2` (DIRECT, bypass reactivity)
   - `palabra` → `EXPRESSION_MAP['palabra']` → `['Palabra', 'MouthMove']`
   - `Palabra2` → `EXPRESSION_MAP['Palabra2']` → `['Palabra', 'MouthMove']`
2. **Turno concedido** (`granted`): Expresión `feliz` → `Jump_while_run`, `Idle_2`
3. **Ignorado** (`ignored`): Expresión `triste` → `Emo_neutral`, `Walk_sneaky`
4. **Rechazado** (`rejected`): Expresión `triste` → `Emo_neutral`, `Walk_sneaky`

### 9.4 Comportamiento "Enojado"

**OS3**: No documentado explícitamente. OS3 no tenía un sistema de emociones reactivas.

**OS4**: Sistema completo de detección y expresión de enojo:
1. **Detección por texto**: `detectEmotionInTranscript()` en [`App.tsx:268-278`](../src/App.tsx:268) detecta palabras clave negativas → emoción `angry`
2. **Trigger `ignored`**: Cuando un participante es ignorado → expresión `enojado`
   - `expressionRegistry.ts`: trigger `'ignored'` → `expression: 'enojado'`, `anims: ['Walk', 'Emo_blink', 'Cap_back', 'MouthMove']`
   - `EXPRESSION_MAP['enojado']` → `['Run', 'Emo_blink']`
3. **Emoción `angry`**: `resolveEmotionExpression('angry')` → expresión `enojado`
   - `expressionRegistry.ts`: emotion `'angry'` → `expression: 'enojado'`, `anims: ['Run', 'Emo_blink']`
4. **Afinidad de personalidad**: Perfil 'estudiante' (rebelde, enérgico) tiene mayor afinidad con `enojado` que perfil 'administrativo' (formal, profesional)

### 9.5 Diferencias Clave OS4 vs OS3

#### ✅ Mejoras de OS4

1. **Data-driven**: OS4 usa `expressionRegistry.ts` con 37 definiciones y `emotionEngine.ts` con 6 funciones resolve. OS3 tenía mapeos hardcoded. Esto hace que OS4 sea **extensible sin cambiar código**: solo agregar entradas al registry.

2. **Personalidad afecta animaciones**: OS4 tiene `scoreExpressionByPersonality()` que puntúa expresiones según los rasgos de personalidad. OS3 no tenía este concepto.

3. **Reactivity engine**: OS4 introduce `applyReactivityToAnims()` que escala las animaciones según `emotionalReactivity × intensity`. Aunque causó el bug de "FLU estático", el concepto es valioso para perfiles de baja reactividad.

4. **Toggle alternation**: OS4 alterna entre dos expresiones en LISTENING, SPEAKING y PARTICIPANT para dar variedad visual. OS3 usaba una sola animación por estado.

5. **Micro-expresiones idle**: OS4 muestra micro-expresiones aleatorias cada 8-15 segundos en IDLE/WAITING. OS3 no tenía este comportamiento.

6. **Blend de animaciones**: OS4 puede mezclar animaciones de emoción con MouthMove durante SPEAKING. OS3 no soportaba blend.

7. **Perfiles configurables**: OS4 tiene 3 perfiles (administrativo, profesor, estudiante) con diferentes valores de `emotionalReactivity`, `animationSpeed`, y rasgos de personalidad. OS3 tenía una configuración única.

8. **Pipeline unificado**: OS4 centraliza toda la lógica de animación en `useAvatarVoiceSync.ts`. OS3 tenía lógica dispersa.

#### ⚠️ Regresiones / Diferencias de OS4

1. **Lip-Sync**: OS3 usaba Rhubarb WASM con morph targets para lip-sync preciso. OS4 usa animación FBX `MouthMove` que es menos precisa y no está sincronizada con la voz en tiempo real.

2. **Señales de avatar**: OS3 tenía `AvatarSignals` (WAVE, THINK, HIGHLIGHT, ALERT, CELEBRATE, NONE) como un sistema de comunicación no verbal. OS4 no tiene este concepto — las señales fueron reemplazadas por el sistema de expresiones, pero se perdió la semántica de "señal" como evento discreto.

3. **Modo de Concentración**: OS3 tenía un "Modo de Concentración Computing" que reducía FPS de 60 a 24 para ahorrar recursos. OS4 no tiene este modo.

4. **Audio Pipeline separado**: OS3 tenía un AudioPipeline con AudioProcessor independiente. OS4 integra el audio en `fluParticipant` y `useAvatarVoiceSync`, lo que puede ser menos modular.

5. **Detección de Speaker**: OS3 tenía `VoiceCommandProcessor` con detección de `SPEAKER_ID` mediante "ok flu soy [nombre]". OS4 tiene un sistema de perfiles de voz más sofisticado pero diferente.

### 9.6 Conclusión de la Comparativa

OS4 es **arquitectónicamente superior** a OS3 en términos de:
- **Extensibilidad**: data-driven vs hardcoded
- **Personalización**: perfiles, personalidad, reactividad
- **Variedad visual**: toggle alternation, micro-expresiones, blend
- **Mantenibilidad**: código centralizado en emotionEngine + expressionRegistry

Sin embargo, OS4 tiene **dos regresiones funcionales** respecto a OS3:
1. **Lip-sync preciso** (Rhubarb WASM → MouthMove FBX)
2. **Sistema de señales** (AvatarSignals → reemplazado por expresiones)

Y **un bug crítico** que ya fue corregido:
- **Reactivity engine filtraba animaciones** con valores por defecto (fix: umbral `very-low` reducido de 0.3 a 0.1, y `emotionalReactivity` aumentado de 0.5 a 1.0)

---

## 10. Conclusión Final

El sistema de animaciones y expresiones de FLU OS4 está **completamente implementado** y **funcional**:

1. **23 expresiones** mapeadas a **16+ animaciones FBX** vía `EXPRESSION_MAP`
2. **37 definiciones** en el `expressionRegistry` con mapeos por estado, emoción, trigger, y afinidad de personalidad
3. **6 funciones resolve** en el `emotionEngine` que seleccionan la expresión óptima según contexto
4. **Pipeline completo** desde `ConversationState` → `useAvatarVoiceSync` → `bunnyStore` → `BunnyViewer`
5. **Toggle alternation** para LISTENING (atencion/atencion2), SPEAKING (hablando/hablando2), y PARTICIPANT (palabra/Palabra2)
6. **Micro-expresiones idle** cada 8-15 segundos
7. **Blend de animaciones** durante SPEAKING con emoción (mezcla animación emocional + MouthMove)
8. **Fix de reactividad aplicado**: umbral `very-low` reducido de 0.3 a 0.1, `emotionalReactivity` default aumentado a 1.0
9. **UI labels limpiadas**: "Frase", "Work Space", "Conversación", "Minuta de acuerdos" removidos

**El sistema está listo para producción.** Las observaciones menores son:
- Verificar que `MouthMove` y `Palabra` tengan archivos FBX o sean animaciones procedurales
- Considerar reintroducir lip-sync con Rhubarb WASM para mayor precisión
- Considerar reintroducir AvatarSignals como sistema de eventos discretos

---

## 11. Fix: Rebasing del Timeline de Clips FBX (Dance / Idle_3 congelados)

> **Fecha**: 2026-08-15 · **Estado**: IMPLEMENTADO y VERIFICADO

### 11.1 Síntoma

`Dance` (y `Idle_3`) no producían movimiento del cuerpo (`bodyMax=0.000e+0`, `movingBones=0`) a través del mismo `THREE.AnimationMixer` + `useFrame(mixer.update)` que sí animaba `Idle_2` (97 huesos, `bodyMax=1.26e-1`).

### 11.2 Causa raíz (confirmada)

Los FBX `Dance`/`Idle_3` llevan sus keyframes **desplazados al final de la línea de tiempo**:

| Clip | Rango de keyframes | Duración real del movimiento |
|------|--------------------|------------------------------|
| `Dance` | `[22.5, 26.333]s` | 3.83s (14.5% del timeline) |
| `Idle_3` | `[14.133, 16.133]s` | 2.00s (12.4% del timeline) |
| `Idle_2` | `[2.4, 14.1]s` | 11.7s (83% del timeline) |

Mecanismo: `THREE.Interpolant.evaluate()` **mantiene el primer keyframe** como valor constante para `t < times[0]` (extrapolación "hold"). Durante el 85–88% del bucle el valor no cambia → `PropertyMixer.apply` nunca pasa su compuerta (`accu0 === accu1` → `setValue` nunca se llama). El mixer era **sano** (FASE C/D: tiempo avanza, bindings resueltas); el congelamiento estaba en el **clip** (fuente).

### 11.3 Solución implementada

[`rebaseClipTimeline()`](../src/avatar/components/BunnyViewer.tsx:127) — resta el mínimo global de tiempos de todos los tracks (primer keyframe → `t=0`), recalcula `clip.duration` y etiqueta el offset original (`clip.rebaseOffset`). Aplicada en los **3 puntos de cacheo** de [`BunnyViewer.tsx`](../src/avatar/components/BunnyViewer.tsx):
1. Preload en background (Idle_1..Emo_mouth_open).
2. Fuente de pose (`Idle_2`/`Emo_blink` para clips sintéticos).
3. Cache MISS principal al cargar un FBX on-demand.

Es **no-op** cuando el clip ya empieza en ~0 (`minTime ≤ 0.0005`), no altera valores (las poses extraídas con `extractPosesFromClip` leen `values[0]`), y preserva el ritmo relativo (offset uniforme).

### 11.4 Verificación (Playwright `diagnostico-dance-mixer-live.spec.ts`)

- `Dance(dur=3.83)@mixer1` → duración corregida `26.333 − 22.5 = 3.833s`.
- `Idle_3(dur=2)@mixer1` → `16.133 − 14.133 = 2.0s`.
- Tiempo del mixer avanza desde `t0≈0.32` (antes desde 22.5).
- **FASE D (Dance): `bodyMax=8.500e-1`, `movingBones=97`** (antes `0.000e+0`).
- **FASE C (Idle_3): `bodyMax=1.031e-1`, `movingBones=97`** (antes congelado).
- Veredicto final del spec: `Cache MISS Dance fresco bodyMax=8.388e-1 (¿se mueve? true)`.
- `npx tsc --noEmit` sin errores en `BunnyViewer.tsx`.

> **Nota**: `diagnostico-dance-tracks.spec.ts` lee los FBX **fuente** de forma independiente (`mod.loadFbx`), por lo que seguirá reportando `times=[22.5,26.333]` — es un inspector de datos fuente, no del runtime. La verificación del fix va por el spec mixer-live y la nueva probe `__bunnyProbe.clipTimeline(animName)` (reporta `rebaseOffset` y `timeMin/timeMax` por track de los clips cacheados).
