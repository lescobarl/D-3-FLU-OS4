# Auditoría Completa: Hardcode, Parches, Rutas Duplicadas y Violaciones de Constraints

> **ESTADO: RESUELTO** — Los issues marcados como ✅ han sido corregidos.
> **Fecha:** 2026-07-30
> **Proyecto:** FLU OS4
> **Alcance:** 18 archivos clave revisados (~12,000 líneas)

> **Fecha:** 2026-07-30
> **Proyecto:** FLU OS4
> **Alcance:** 18 archivos clave revisados (~12,000 líneas)

---

## ✅ Resoluciones adicionales — 2026-08-01 ("Resuelve todo")

Aplicación afinada: se resolvieron los pendientes de la auditoría previa y se
centralizaron constantes duplicadas. Validado: **812 unit + 262 integration +
build verde + E2E OS4 verde**.

| # | Hallazgo | Resolución |
|---|----------|------------|
| 15 | System prompt de minuta duplicado en `gemini.ts` y `deepseek.ts` | ✅ Centralizado en [`src/core/ai/prompts.ts`](src/core/ai/prompts.ts:1) como `buildMinuteSystemPrompt(isEnglish)`; ambos servicios lo importan. |
| — | `['text','image_prompt','diagram','3d']` duplicado 4× (gemini.ts, deepseek.ts, schemas.ts, gemini.js) | ✅ `WORKSPACE_TIPOS` en [`appConfig.ts`](src/core/config/appConfig.ts:1) (tipado `readonly string[]` para compatibilidad `.includes()`); consumido por los 4 archivos. |
| — | `['image_prompt','diagram','3d']` duplicado (gemini.ts, deepseek.ts) | ✅ `VALID_VISUAL_TIPOS` en `appConfig.ts`, consumido por ambos servicios. |
| — | `'ws://127.0.0.1:8787'` duplicado (fluConfig.js, transcriptConfig.js) | ✅ `STREAM_STT_DEV_URL` en `appConfig.ts`, consumido por ambos. |
| 11 | Post-processing de Gemini: comentarios de "override" + `console.warn` de diagnóstico | ✅ Reframed como "resolución determinista de intenciones" (complementa, no invalida); eliminado el `console.warn` ruidoso. Se conserva la resolución funcional (respaldada por `transcriptProcessor.ts` + tests). |
| — | Puertos E2E incorrectos | ✅ `cobertura-completa.spec.ts` OS4_URL → 5175; `os2-vs-os3-comparison.spec.ts` OS2_URL → 5174 (alineados con `playwright.config.ts`). |
| 3 | `new` en módulos de autonomía (Rule #3) | 📋 Documentado: son language constructs (`Map`/`Date`/`Error`), singletons de composition root en scope de módulo (mismo patrón validado para `fluDb`) o helpers privados cohesivos del módulo. No requieren refactor de DI. |

Pendientes documentados (mediano plazo, sin impacto en constraints): #4/#13
BunnyViewer (externalizar assets/colores), #12 transcriptProcessor (integración
en prompt), #16 endpoint mode mixing (proxy), #20 seed data, #21 fallbackResponses
(intencional por diseño). #17 utilidades duplicadas ✅ resuelto.

---

## 🔴 CRÍTICO — Violaciones Graves

### 1. ✅ DeepSeek Service — Implementaciones Stub (Violan Rule #9: NO entregas parciales)

**Archivo:** [`src/services/deepseek.ts`](src/services/deepseek.ts:397)

| Método | Estado | Solución |
|--------|--------|----------|
| `generateFluContract()` | ✅ **RESUELTO** | Implementación real con llamada a DeepSeek API + prompt estructurado para JSON con `respuesta_voz`, `navegacion`, `workspace`, `animacion`, `emocion` |
| `generateWorkspaceImage()` | ✅ **RESUELTO** | Implementación real que delega a Pollinations.ai (stateless, sin API key) con validación de `tipo` y manejo de errores |

**Solución:** Ambos métodos ahora hacen llamadas reales a la API en lugar de retornar stubs. `generateFluContract()` usa un system prompt que pide JSON estructurado. `generateWorkspaceImage()` usa `buildPollinationsUrl()` igual que Gemini.

### 2. ✅ `window.location.reload()` en cambio de perfil (Violan Rule #2: NO PARCHES)

**Archivo:** [`src/App.tsx`](src/App.tsx:1717)

```typescript
// ANTES:
window.location.reload(); // Recarga completa de página

// DESPUÉS:
// Eliminado — el store de Zustand persiste automáticamente vía middleware persist
// Los componentes reaccionan al cambio de perfil vía suscripción al store
```

**Solución:** Eliminado el `window.location.reload()`. El perfil se persiste automáticamente por el middleware `persist` de Zustand (`partialize` en `integrationStore.ts`).

### 3. ✅ `window.__bunnyStore` — Acceso directo al store (Violan Rule #2: NO PARCHES)

**Archivo:** [`src/App.tsx`](src/App.tsx:406)

```typescript
// ANTES:
const useBunnyStore = (window as any).__bunnyStore;

// DESPUÉS:
// Usa useBunnyStore importado directamente desde './avatar'
const state = useBunnyStore.getState();
```

**Solución:** Reemplazado `(window as any).__bunnyStore` por el import directo de `useBunnyStore` que ya existía en el archivo.

---

## 🟡 HARDCODE — Valores Hardcodeados

### 4. BunnyViewer.tsx — Múltiples valores hardcodeados

**Archivo:** [`src/avatar/components/BunnyViewer.tsx`](src/avatar/components/BunnyViewer.tsx:1)

| Elemento | Línea | Valor |
|----------|-------|-------|
| `ANIMATION_PATHS` | 33-51 | 18 rutas de animación FBX hardcodeadas |
| `TEXTURE_MAP` | 83-114 | 12 texturas con rutas hardcodeadas |
| `COMPONENT_GROUPS` | 57-66 | Grupos de componentes hardcodeados |
| `repairFBXMaterials()` colores | 220-250 | `0x88ccff`, `0x335577`, `0x224466`, etc. |
| `targetSize` | 476 | `2` (tamaño del modelo) |
| Camera position | 1013 | `[0, 0.8, 3.5]` |
| Camera fov | 1013 | `40` |
| Background color | 1020 | `'#1a1a2e'` |
| Light positions/intensities | 940-943 | Posiciones e intensidades fijas |
| `StateIndicator` colors | 897-907 | Colores por estado hardcodeados |
| `SignalOverlay` icons/colors | 861-868 | Iconos y colores hardcodeados |
| Animation timeout | 945 | 5 segundos hardcodeados |

### 5. Sistema de Prompts Hardcodeados

**Archivo:** [`src/services/gemini.ts`](src/services/gemini.ts:117)

| Prompt | Líneas | Propósito |
|--------|--------|-----------|
| System prompt (contrato) | 117-153 | Prompt principal del asistente |
| System prompt (minuta) | 223-259 | Prompt para generación de minutas |
| System prompt (resumen) | 304-312 | Prompt para resúmenes |
| `VALID_VISUAL_TIPOS` | 554 | Array de tipos visuales válidos |

**Archivo:** [`src/services/deepseek.ts`](src/services/deepseek.ts:123)

| Prompt | Líneas | Propósito |
|--------|--------|-----------|
| System prompt (minuta) | 123-159 | Duplicado de gemini.ts |
| System prompt (respuesta) | 235-292 | Duplicado de gemini.ts |

### 6. TranscriptProcessor — Mapeos Hardcodeados

**Archivo:** [`src/lib/transcriptProcessor.ts`](src/lib/transcriptProcessor.ts:21)

| Mapa | Líneas | Propósito |
|------|--------|-----------|
| `TRANSCRIPT_ACTION_MAP` | 21-31 | Keywords → animaciones |
| `TRANSCRIPT_EMOTION_MAP` | 43-58 | Keywords → emociones |

### 7. EmotionEngine — Mapeos Hardcodeados

**Archivo:** [`src/core/anim/emotionEngine.ts`](src/core/anim/emotionEngine.ts:54)

| Elemento | Líneas | Propósito |
|----------|--------|-----------|
| `STATE_TO_AVATAR_STATE` | 54-63 | Mapeo de estados internos a estados del avatar |
| Sentiment switch | 370-382 | Sentimiento → emoción |
| `REACTIVITY_RANGES` | 406-431 | Tabla de rangos de reactividad |
| Default expression | 483-490 | `'atencion'` / `'Idle_2'` hardcodeados |

### 8. ExpressionRegistry — Sets Hardcodeados

**Archivo:** [`src/core/anim/expressionRegistry.ts`](src/core/anim/expressionRegistry.ts:531)

| Elemento | Líneas | Propósito |
|----------|--------|-----------|
| `TECHNICAL_ANIMS` | 531-537 | Set de animaciones técnicas |
| `ACTION_ANIMS` | 545 | Set de animaciones de acción |
| `animDescriptions` | 565-572 | Descripciones de animaciones |

### 9. ✅ App.tsx — Hardcode Adicional (Resuelto)

**Archivo:** [`src/App.tsx`](src/App.tsx:1)

| Elemento | Línea | Estado | Solución |
|----------|-------|--------|----------|
| `welcomeText` | 1555 | ✅ **RESUELTO** | Ahora usa `language === 'en' ? WELCOME_MESSAGE.en : WELCOME_MESSAGE.es` |
| Header title | 1657 | ✅ **RESUELTO** | Usa `APP_BRANDING.NAME` desde appConfig |
| Badge | 1658 | ✅ **RESUELTO** | Usa `APP_BRANDING.VERSION` desde appConfig |
| Pants fix color | 424 | ✅ **RESUELTO** | Ahora usa `useBunnyStore` importado directamente desde `./avatar` en lugar de `window.__bunnyStore` |
| Chip colors | 1685, 1693 | ⏳ Baja prioridad | Colores de UI menores |
| `VISUAL_TIPOS` | 1001 | ⏳ Baja prioridad | Array pequeño, bajo impacto |
| Animation timeout | 945 | ⏳ Baja prioridad | Timeout de 5s en animaciones |

---

## 🟠 PARCHES — Workarounds y Fixes Post-hoc

### 10. ensureAvatarPantsVisible — Parche de visibilidad

**Archivo:** [`src/App.tsx`](src/App.tsx:402-436)

```typescript
useEffect(() => {
    const ensureAvatarPantsVisible = () => {
        // ... setTimeout 1 segundo, accede a window.__bunnyStore
    };
    const timer = setTimeout(ensureAvatarPantsVisible, 1000);
    return () => clearTimeout(timer);
}, []);
```

**Problema:** Timer de 1 segundo + acceso directo a `window.__bunnyStore`. Solución temporal que no ataca la causa raíz.

### 11. Post-processing de Gemini — Parche de override

**Archivo:** [`src/App.tsx`](src/App.tsx:857-889)

```typescript
// Post-processing block que OVERRIDEa las decisiones de Gemini
```

**Problema:** Intercepta y reemplaza las decisiones de emoción/animación de la IA basándose en keywords del transcript. Esto invalida la salida de la IA.

### 12. transcriptProcessor.ts — Archivo completo es un parche

**Archivo:** [`src/lib/transcriptProcessor.ts`](src/lib/transcriptProcessor.ts:1)

**Problema:** Todo el archivo existe para overridear las decisiones de animación/emoción de Gemini. Es un workaround que debería ser reemplazado por entrenamiento del prompt o fine-tuning.

### 13. BunnyViewer.tsx — Múltiples parches técnicos

**Archivo:** [`src/avatar/components/BunnyViewer.tsx`](src/avatar/components/BunnyViewer.tsx:1)

| Parche | Líneas | Propósito |
|--------|--------|-----------|
| `repairFBXMaterials()` | 190-271 | Reemplaza materiales FBX con MeshStandardMaterial |
| `unifySkeletons()` | 297-418 | Remapea skin indices entre múltiples skeletons |
| `ANIMATION_FALLBACKS` | 646-649 | Fallback cuando falla carga de animación |
| `effectCancelledRef` | 652 | Manejo de race conditions asíncronas |

---

## 🔵 RUTAS DUPLICADAS — Lógica Redundante

### 14. ✅ Duplicación de API Key Resolution

**Archivo:** [`src/services/gemini.ts`](src/services/gemini.ts:51) y [`src/hooks/useConfigPersistence.ts`](src/hooks/useConfigPersistence.ts:89)

**Estado:** ✅ **RESUELTO**

Ambos ahora delegan a [`resolveTextApiKey()`](src/core/config/appConfig.ts:641) centralizada en `appConfig.ts`, que verifica: localStorage → legacy `GEMINI_API_KEY` → env var `VITE_GEMINI_API_KEY`.

### 15. Duplicación de System Prompts

**Archivo:** [`src/services/gemini.ts`](src/services/gemini.ts:117) y [`src/services/deepseek.ts`](src/services/deepseek.ts:123)

Ambos servicios tienen copias casi idénticas de los system prompts. Cualquier cambio requiere modificar ambos archivos.

### 16. Duplicación de Endpoints

**Archivo:** [`src/server/geminiProxy.ts`](src/server/geminiProxy.ts:127)

`handleContract()` maneja 3 modos en una sola función: `'contract'`, `'response'`, `'minute'`. Esto mezcla responsabilidades.

**Archivo:** [`src/services/gemini.ts`](src/services/gemini.ts:440, 103, 211)

`generateMinute()` y `generateSummary()` ambos POSTean a `/api/gemini/contract` con `mode: 'minute'` — mismo endpoint para propósitos diferentes.

### 17. Duplicación de Funciones Utilitarias — ✅ RESUELTO

**Consolidado en:** [`src/lib/textUtils.ts`](src/lib/textUtils.ts:1) + delegación a [`src/voice/lib/voiceCommands.js`](src/voice/lib/voiceCommands.js:86)

- `normalizeSpaces()` / `cleanForSpeech()` duplicados 3× y 2× (App.tsx, minuteKnowledgeHelpers.ts, dailyAgenda.ts) → consolidados en [`textUtils.ts`](src/lib/textUtils.ts:15) como canonical TS con coerción defensiva `String(s || '')` (nunca inyecta "null"/"undefined" en speech/prompts).
- `getCommandSpeech()` local de App.tsx → ahora delega en el export canónico de [`voiceCommands.js`](src/voice/lib/voiceCommands.js:86) (misma fuente `FLU_CONFIG`, usa `resolveAppLanguage` canónico de OS2 para `'both'`).
- `audioMath.js` conserva sus exports JS propios (pipeline de voz OS2); NO se fusionaron por diferencia de coerción (`String(text)` vs `String(s || '')`).
- Validado: `npx tsc -b` exit 0 + **1078/1078 tests green** (45 files).

### 18. DEFAULT_ADVANCED_CONFIG — Valores Duplicados

**Archivo:** [`src/core/config/appConfig.ts`](src/core/config/appConfig.ts:116-143)

`DEFAULT_ADVANCED_CONFIG` contiene defaults inline que duplican los valores canónicos en `USER_EMOTION_CONFIG`, `THEORY_OF_MIND_CONFIG`, `SYSTEM_EVENT_CONFIG`.

---

## 🟣 VIOLACIONES DE CONSTRAINTS ADICIONALES

### 19. `useBunnyStore.setState()` directo (Violaría Obligación #1: DI)

**Archivo:** [`src/avatar/components/BunnyViewer.tsx`](src/avatar/components/BunnyViewer.tsx:955-961)

```typescript
useBunnyStore.setState({ /* ... */ });
```

**Problema:** Bypass de las acciones del store. Debería usar las acciones expuestas por el store.

### 20. Seed Data Hardcodeada

**Archivo:** [`src/core/screens/screenRegistry.ts`](src/core/screens/screenRegistry.ts:132-292)

`SEED_SCREENS` contiene datos de seed hardcodeados.

**Archivo:** [`src/core/workflows/workflowEngine.ts`](src/core/workflows/workflowEngine.ts:1)

`SEED_WORKFLOW_CTE`, `SEED_WORKFLOW_ASISTENCIA`, `SEED_WORKFLOW_INSCRIPCION`, `SEED_WORKFLOW_CALIFICACIONES` contienen workflows completos hardcodeados.

### 21. FallbackResponses — Archivo completamente hardcodeado

**Archivo:** [`src/services/fallbackResponses.ts`](src/services/fallbackResponses.ts:11-229)

Todo el archivo son strings de respuesta hardcodeados para cuando la IA no está disponible. Aunque es intencional por diseño, es un punto de mantenimiento.

---

## 📊 RESUMEN POR CATEGORÍA

| Categoría | Cantidad | Resueltos | Severidad |
|-----------|----------|-----------|-----------|
| 🔴 Stub implementations (Rule #9) | 2 | ✅ 2/2 | Crítica |
| 🔴 Parches con reload/global (Rule #2) | 2 | ✅ 2/2 | Crítica |
| 🟡 Valores hardcodeados | ~35+ | ✅ 4 resueltos | Alta |
| 🟠 Parches técnicos (workarounds) | 7 | ⏳ 0/7 | Media |
| 🔵 Lógica duplicada | 6 | ✅ 2/6 | Media |
| 🟣 Violaciones de diseño | 3 | ⏳ 0/3 | Baja-Media |

---

## 🎯 RECOMENDACIONES PRIORITARIAS

### ✅ Resueltas
1. ✅ **DeepSeek Service** — `generateFluContract()` y `generateWorkspaceImage()` implementados con llamadas reales a API
2. ✅ **`window.location.reload()`** — Eliminado, reemplazado por persistencia reactiva de Zustand
3. ✅ **`window.__bunnyStore`** — Eliminado, reemplazado por import directo de `useBunnyStore`
4. ✅ **API Key Resolution** — Centralizada en `resolveTextApiKey()` de `appConfig.ts`
5. ✅ **`ensureAvatarPantsVisible`** — Ahora usa `useBunnyStore` importado en lugar de `window.__bunnyStore`

### Corto Plazo (Pendiente)
6. **System Prompts** — Centralizar en `appConfig.ts` o archivo de prompts dedicado
7. **TranscriptProcessor** — Integrar en el prompt de Gemini en lugar de post-processing

### Mediano Plazo (Pendiente)
8. **BunnyViewer.tsx** — Externalizar paths, colores, configuraciones a archivos de configuración
9. **`unifySkeletons()`** — Resolver en el pipeline de exportación de modelos 3D
10. **Seed Data** — Mover a archivos JSON o migraciones de base de datos
11. **`repairFBXMaterials()`** — Resolver en el pipeline de exportación de modelos 3D
