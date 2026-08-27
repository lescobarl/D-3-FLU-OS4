# Auditoría Completa: OS4 vs OS3 — Hallazgos, Bugs y Diferencias

> **Fecha**: 2026-07-21
> **Propósito**: Auditoría exhaustiva de TODAS las diferencias, bugs y descuidos entre OS4 y OS3 antes de implementar cualquier corrección.
> **Método**: Análisis de código fuente, comparación contra expressionRegistry (fuente de verdad), revisión de tests existentes.

---

## 🔴 Hallazgo 1: EXPRESSION_MAP — 5 Expresiones con Animaciones Incorrectas

**Archivo**: [`src/avatar/index.ts:42-71`](src/avatar/index.ts:42)
**Severidad**: 🔴 CRÍTICO — Afecta LISTENING, THINKING y SPEAKING

El `EXPRESSION_MAP` en [`src/avatar/index.ts`](src/avatar/index.ts:42) tiene **5 entradas con animaciones incorrectas** comparado con el `expressionRegistry` que es la fuente de verdad.

| Expresión | Registry (correcto) | EXPRESSION_MAP (actual) | Efecto |
|-----------|-------------------|------------------------|--------|
| `atencion` | `['Idle_2']` | `['Idle_1', 'Emo_neutral']` ❌ | LISTENING muestra Idle_1 en vez de Idle_2 |
| `atencion2` | `['Idle_3']` | `['Idle_2', 'Emo_neutral']` ❌ | LISTENING alternancia muestra Idle_2 en vez de Idle_3 |
| `Pensando` | `['Idle_1']` | `['Idle_3', 'Emo_neutral']` ❌ | THINKING muestra Idle_3 en vez de Idle_1 |
| `hablando` | `['Idle_2', 'MouthMove']` | `['MouthMove', 'Palabra']` ❌ | SPEAKING sin Idle_2 de base |
| `hablando2` | `['Idle_3', 'MouthMove']` | `['Palabra', 'MouthMove']` ❌ | SPEAKING alternancia sin Idle_3 de base |

### Impacto
- **LISTENING**: Cuando `syncAvatarToState('LISTENING')` llama a `store.setExpression('atencion')`, el `bunnyStore.setExpression()` (línea 251) hace `EXPRESSION_MAP['atencion']` y obtiene `['Idle_1', 'Emo_neutral']`, seteando `currentAnimation = 'Idle_1'`. El usuario ve Idle_1 en vez de Idle_2.
- **THINKING**: Similar, `setExpression('Pensando')` setea `currentAnimation = 'Idle_3'` en vez de `'Idle_1'`.
- **SPEAKING**: `setExpression('hablando')` setea `currentAnimation = 'MouthMove'` en vez de `'Idle_2'`, perdiendo la animación base de speaking.

### Causa Raíz
El `EXPRESSION_MAP` fue copiado de OS3 pero nunca actualizado para coincidir con el `expressionRegistry` que es la fuente de verdad DATA-DRIVEN. Las animaciones están rotadas: `Idle_1` ↔ `Idle_2` ↔ `Idle_3` están en posiciones incorrectas.

### Tests que verifican el comportamiento esperado
- [`tests/integration.test.ts:1591-1601`](tests/integration.test.ts:1591): Test "LISTENING debe alternar entre atencion+Idle_2 y atencion2+Idle_3"
- [`tests/integration.test.ts:1603-1625`](tests/integration.test.ts:1603): Test "LISTENING alternativas deben tener expresiones y animaciones válidas"
- [`tests/integration.test.ts:2442-2450`](tests/integration.test.ts:2442): Tests EXPRESSION_MAP "hablando" → ["Idle_2", "MouthMove"] y "hablando2" → ["Idle_3", "MouthMove"] (estos tests leen de OS1, no de OS4)

---

## 🔴 Hallazgo 2: LISTENING_ALTERNATIVES Definido pero No Usado

**Archivo**: [`src/hooks/useAvatarVoiceSync.ts:49-53`](src/hooks/useAvatarVoiceSync.ts:49)
**Severidad**: 🟡 MEDIO — Código muerto, no causa bug funcional

El array `LISTENING_ALTERNATIVES` se define en las líneas 49-53 usando `getGroupExpressions('listening')` del registry, pero **nunca se usa**. La función `syncAvatarToState` (línea 166-176) usa strings hardcodeadas:

```typescript
// Líneas 49-53: Definido pero NO usado
const LISTENING_ALTERNATIVES = getGroupExpressions('listening').map((def) => ({
    expression: def.expression as AvatarExpression,
    anims: def.anims as BunnyAnimation[],
}));

// Líneas 166-176: Usa strings hardcodeadas
const expression = toggleIndex === 0 ? 'atencion' : 'atencion2';
store.setExpression(expression);
```

Lo mismo aplica para `SPEAKING_ALTERNATIVES` (líneas 59-63) y `PARTICIPANT_ALTERNATIVES` (líneas 69-73).

---

## 🟡 Hallazgo 3: Reporte de Validación Existente — Información Incorrecta

**Archivo**: [`plans/validacion-funcional-os3-vs-os4.md`](plans/validacion-funcional-os3-vs-os4.md)
**Severidad**: 🟡 MEDIO — Desinformación que puede llevar a decisiones incorrectas

El reporte existente dice en la línea 389:
> "Los archivos `MouthMove.fbx` y `Palabra.fbx` **NO EXISTEN** en `public/models/Animations/`"

**ESTO ES FALSO**. Los archivos SÍ existen:
- `public/models/Animations/Bunny@MouthMove.fbx` ✅
- `public/models/Animations/Bunny@Palabra.fbx` ✅

Ambos archivos están presentes en el directorio de animaciones. El reporte necesita ser corregido.

---

## 🟡 Hallazgo 4: FLU Initialization — Animación en Page Load

**Archivo**: [`src/avatar/store/bunnyStore.ts:57-70`](src/avatar/store/bunnyStore.ts:57)
**Severidad**: 🟡 MEDIO — FLU no muestra animación al cargar la página

El estado inicial del store tiene:
```typescript
currentAnimation: null,  // Sin animación al cargar
isPlaying: false,        // No reproduciendo
```

Esto significa que cuando la página carga, FLU aparece **estático** (sin animación idle). El `BunnyViewer` (línea 604-731) solo carga una animación cuando `currentAnimation` cambia a un valor no-null.

**Flujo actual**:
1. Página carga → `currentAnimation = null`, `isPlaying = false`
2. Usuario hace clic en "Abrir escucha" → `syncAvatarToState('LISTENING')` → `setExpression('atencion')` → `currentAnimation = 'Idle_1'` (por el bug del Hallazgo 1)

**Comportamiento esperado (OS3)**: FLU debería mostrar una animación idle (Idle_2) desde el momento en que la página carga, no solo cuando se activa la escucha.

El `getDefaultExpression()` en [`emotionEngine.ts:483-490`](src/core/anim/emotionEngine.ts:483) define el default como:
```typescript
{ expression: 'atencion', anims: ['Idle_2'], avatarState: 'IDLE', intensity: 0.3 }
```

Pero este default nunca se aplica al store inicial.

---

## 🟡 Hallazgo 5: Workspace/Pizarrón Look & Feel

**Archivo**: [`src/App.css:221-223`](src/App.css:221), [`src/App.css:1080-1144`](src/App.css:1080)
**Severidad**: 🟡 MEDIO — Diferencia visual con OS3

El workspace/pizarrón usa tema verde oscuro:
```css
.flu-tab-panel--workspace {
    background: #0a2e1a;  /* Verde oscuro */
}
```

Y los separadores usan verde:
```css
.frame-content--workspace > * + * {
    border-top: 1px solid rgba(0, 200, 100, 0.12);
}
```

**Para determinar si esto es diferente de OS3**, necesitaríamos ver OS3 corriendo. El usuario dijo "Me gusta mas como se ve el look&feel de OS3", lo que sugiere que OS3 usa un tema diferente (posiblemente el tema oscuro general `--bg-primary: #0f0f1a` en vez de verde).

**Posible causa**: OS3 podría no tener el override verde y usar el fondo oscuro estándar. El workspace de OS4 fue personalizado con tema verde pero el usuario prefiere el look estándar de OS3.

---

## 🟢 Hallazgo 6: Tests de EXPRESSION_MAP Apuntan a OS1

**Archivo**: [`tests/integration.test.ts:2417-2450`](tests/integration.test.ts:2417)
**Severidad**: 🟢 BAJO — Tests frágiles que dependen de otro proyecto

Los tests de validación de EXPRESSION_MAP leen archivos de OS1:
```typescript
const src = require('fs').readFileSync('../D-3-FLU-OS1/flu-os/src/store/bunnyStore.ts', 'utf-8');
expect(src).toContain("'hablando': ['Idle_2', 'MouthMove']");
```

Esto significa que:
1. Estos tests **no validan OS4** — validan OS1
2. Si OS1 no existe en el sistema de archivos, los tests fallan
3. No hay tests que validen que `EXPRESSION_MAP` en [`src/avatar/index.ts`](src/avatar/index.ts:42) tenga los valores correctos

---

## 🟢 Hallazgo 7: SLEEPING State No Transicionado

**Archivo**: [`src/types/bridge.ts:14`](src/types/bridge.ts:14), [`src/hooks/useAvatarVoiceSync.ts:385-451`](src/hooks/useAvatarVoiceSync.ts:385)
**Severidad**: 🟢 BAJO — Estado existe en tipos pero nunca se usa

- `ConversationState` type: 7 estados (sin SLEEPING)
- `AvatarState` type: 9 estados (incluye SLEEPING y COMPUTING)
- `STATE_TO_AVATAR_STATE` en emotionEngine.ts: mapea SLEEPING → 'SLEEPING'
- Switch en syncAvatarToState: No tiene `case 'SLEEPING'`

El estado SLEEPING está definido en el tipo AvatarState y en el mapeo, pero:
1. No está en `ConversationState` (el type del orquestador)
2. No hay case en el switch de syncAvatarToState
3. Nunca se transiciona desde ningún lado

---

## 🟢 Hallazgo 8: Pitch y Volume Hardcodeados en TTS

**Archivo**: [`src/voice/lib/fluSpeech.js`](src/voice/lib/fluSpeech.js)
**Severidad**: 🟢 BAJO — Ya documentado en reporte existente

`utterance.pitch = 1` y `utterance.volume = 1` están hardcodeados, no expuestos en UI ni configuración.

---

## Resumen de Hallazgos

| # | Hallazgo | Severidad | Archivo | ¿Nuevo? |
|---|----------|-----------|---------|---------|
| 1 | EXPRESSION_MAP: 5 animaciones incorrectas | 🔴 CRÍTICO | `src/avatar/index.ts:42` | ✅ Nuevo |
| 2 | LISTENING_ALTERNATIVES definido pero no usado | 🟡 MEDIO | `src/hooks/useAvatarVoiceSync.ts:49` | ✅ Nuevo |
| 3 | Reporte validación dice MouthMove/Palabra no existen (FALSO) | 🟡 MEDIO | `plans/validacion-funcional-os3-vs-os4.md:389` | ✅ Nuevo |
| 4 | FLU sin animación idle al cargar página | 🟡 MEDIO | `src/avatar/store/bunnyStore.ts:59` | ✅ Nuevo |
| 5 | Workspace/pizarrón look & feel diferente de OS3 | 🟡 MEDIO | `src/App.css:221` | ✅ Nuevo |
| 6 | Tests EXPRESSION_MAP apuntan a OS1, no OS4 | 🟢 BAJO | `tests/integration.test.ts:2417` | ✅ Nuevo |
| 7 | SLEEPING state no transicionado | 🟢 BAJO | `src/types/bridge.ts:14` | Ya documentado |
| 8 | Pitch/Volume hardcodeados en TTS | 🟢 BAJO | `src/voice/lib/fluSpeech.js` | Ya documentado |

---

## Acciones Requeridas (SOLO después de aprobación)

### 🔴 Críticas
1. **Corregir EXPRESSION_MAP** en [`src/avatar/index.ts`](src/avatar/index.ts:42):
   - `atencion`: `['Idle_1', 'Emo_neutral']` → `['Idle_2']`
   - `atencion2`: `['Idle_2', 'Emo_neutral']` → `['Idle_3']`
   - `Pensando`: `['Idle_3', 'Emo_neutral']` → `['Idle_1']`
   - `hablando`: `['MouthMove', 'Palabra']` → `['Idle_2', 'MouthMove']`
   - `hablando2`: `['Palabra', 'MouthMove']` → `['Idle_3', 'MouthMove']`

### 🟡 Medias
2. **Usar LISTENING_ALTERNATIVES** en `syncAvatarToState` en vez de strings hardcodeadas
3. **Corregir reporte** `validacion-funcional-os3-vs-os4.md` — MouthMove.fbx y Palabra.fbx SÍ existen
4. **Agregar animación idle inicial** — Llamar `setExpression('atencion')` o `getDefaultExpression()` al montar BunnyViewer
5. **Ajustar workspace/pizarrón** look & feel si el usuario confirma que OS3 usa tema diferente

### 🟢 Bajas
6. **Agregar tests** que validen EXPRESSION_MAP contra expressionRegistry directamente
7. **Agregar SLEEPING** al ConversationState type y al switch en syncAvatarToState
8. **Exponer pitch/volume** en configuración de voz
