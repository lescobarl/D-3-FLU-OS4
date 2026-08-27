# Análisis Completo: Hardcode, Parches y Rutas Duplicadas
## Fecha: 2026-08-19
## Proyecto: FLU OS4
## Alcance: Análisis post-correcciones anti-echo y traducción

---

## 📊 Resumen Ejecutivo

He realizado un análisis exhaustivo del código base después de las correcciones recientes (anti-echo, fallback de traducción, sobre-interpretación). El análisis revela:

### ✅ **Puntos Fuertes:**
1. **Configuración centralizada** - `appConfig.ts` maneja la mayoría de constantes
2. **Sin duplicación crítica de rutas API** - Las rutas `/api/gemini/*` están bien definidas
3. **Buenas prácticas** - Uso de constantes para URLs y configuraciones

### ⚠️ **Problemas Identificados:**

---

## 🔴 **HARDCODE - Valores Hardcodeados Problemáticos**

### 1. **URLs Hardcodeadas en Música** (`src/services/musicPlayer.ts`)
```typescript
// Líneas 40-73 - URLs hardcodeadas de SoundHelix y Archive.org
{ id: 'sueño', title: 'Sueño de Bunny', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
{ id: 'baila', title: 'Baila Bunny', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
// ... más URLs hardcodeadas
```

**Problema:** URLs externas hardcodeadas que pueden dejar de funcionar.

### 2. **URLs de API Hardcodeadas** (`src/core/config/appConfig.ts`)
```typescript
// Línea 129 - OpenRouter URL hardcodeada
API_URL: 'https://openrouter.ai/api/v1',

// Línea 154 - STT dev server URL hardcodeada
STREAM_STT_DEV_URL = 'ws://127.0.0.1:8787',

// Línea 160 - Pollinations URL hardcodeada
BASE_URL: 'https://image.pollinations.ai/prompt',
```

**Problema:** URLs de servicios externos hardcodeadas, deberían ser configurables.

### 3. **URLs de Prueba de Red Hardcodeadas** (`appConfig.ts`)
```typescript
// Líneas 178-180 - URLs de prueba hardcodeadas
export const NETWORK_PROBE_URLS: readonly string[] = [
    'https://example.com',
    'https://one.one.one.one',
];
```

### 4. **Mensajes Hardcodeados en Diagnósticos** (`src/voice/lib/geminiDiagnostics.js`)
```typescript
// Líneas 10-11 - URLs hardcodeadas en mensajes de error
es: 'Cuota agotada (429). La API key gratuita no tiene más cuota. Ve a https://aistudio.google.com/apikey...',
```

---

## 🟡 **PARCHES - Workarounds y Fixes Temporales**

### 1. **Sistema de Eventos Window** (Múltiples archivos)
```typescript
// Patrón encontrado en 8+ archivos
window.dispatchEvent(new CustomEvent('flu:generate-summary'));
```

**Problema:** Uso extensivo de eventos globales `window` como workaround para comunicación entre componentes.

### 2. **Acceso Directo a Store** (`src/App.tsx` - ya corregido según auditoría anterior)
```typescript
// Auditoría anterior indica que esto fue corregido
const useBunnyStore = (window as any).__bunnyStore;
```

### 3. **Timer de Visibilidad de Pantalones** (`src/App.tsx`)
```typescript
// Auditoría anterior menciona este parche
useEffect(() => {
    const ensureAvatarPantsVisible = () => {
        // ... setTimeout 1 segundo, accede a window.__bunnyStore
    };
    const timer = setTimeout(ensureAvatarPantsVisible, 1000);
    return () => clearTimeout(timer);
}, []);
```

### 4. **Post-processing Override** (`src/App.tsx`)
```typescript
// Auditoría anterior: "Post-processing block que OVERRIDEa las decisiones de Gemini"
// Intercepta y reemplaza decisiones de emoción/animación basándose en keywords
```

---

## 🔵 **RUTAS DUPLICADAS - Lógica Redundante**

### 1. **Endpoints API con Responsabilidades Mezcladas** (`src/server/geminiProxy.ts`)
```typescript
// Línea 234: `handleContract()` maneja 3 modos en una sola función
// 'contract', 'response', 'minute' - mezcla responsabilidades
```

### 2. **Duplicación de Lógica de Dispatch** (Varios archivos de voz)
```typescript
// Múltiples funciones con lógica similar:
// - `shouldDispatchFluInterim()` en audioMath.js
// - `shouldDispatchCommandInterim()` en audioMath.js  
// - `planVoiceCommandDispatch()` en voiceCommands.js
// - `planConversationDispatch()` en audioMath.js
```

### 3. **Duplicación de System Prompts** (`gemini.ts` y `deepseek.ts`)
```typescript
// Auditoría anterior indica duplicación de prompts entre servicios
// Cualquier cambio requiere modificar ambos archivos
```

---

## 🟢 **MEJORAS RECIENTES - Ya Corregidas**

### 1. **Anti-Echo System** (`src/voice/lib/gemini.js`)
✅ Corregido - `findLastAssistantResponse()` ahora acepta `role: 'flu'`
✅ Corregido - `buildConversationMessages()` mapea `role: 'flu'` → `'assistant'`

### 2. **Translation Fallback** (`src/voice/lib/localTranslate.js`)
✅ Nuevo sistema de traducción local con diccionario de 100+ frases

### 3. **Cache Key Hardening** (`src/server/geminiProxy.ts`)
✅ `buildContractCacheKey()` ahora incluye translation intent signature

### 4. **Over-interpretation Fix** (`src/voice/lib/gemini.js`)
✅ `detectRepetitionIntent()` ahora lee correctamente `cfg.markers`

---

## 📋 **Plan de Acción Recomendado**

### Fase 1: Hardcode Crítico (Alta Prioridad) — ✅ COMPLETADA (2026-08-19)
1. **Externalizar URLs de música** - ✅ Extraída `SOUNDHELIX_BASE_URL` en `src/services/musicPlayer.ts`
2. **Hacer configurables URLs de API** - ✅ `appConfig.ts` lee variables de entorno (`VITE_*`) con defaults idénticos
3. **Centralizar mensajes de error** - ✅ Extraída `GEMINI_API_KEY_URL` en `src/voice/lib/geminiDiagnostics.js`
4. **Documentar nuevas env vars** - ✅ `.env.example` actualizado
5. **Verificación** - ✅ `tsc -b` sin errores; 329 tests pasan (architecture, localAi, musicCapabilities, integration)

#### Detalle de la implementación Fase 1

**`src/core/config/appConfig.ts`** — URLs de servicios ahora configurables vía env (mismos defaults, sin romper tests):
- `GEMINI_CONFIG.API_URL` / `PREDICT_API_URL` → `VITE_GEMINI_API_URL` / `VITE_GEMINI_PREDICT_URL`
- `DEEPSEEK_CONFIG.API_URL` → `VITE_DEEPSEEK_URL`
- `OPENROUTER_CONFIG.API_URL` → `VITE_OPENROUTER_URL`
- `STREAM_STT_DEV_URL` → `VITE_STREAM_STT_DEV_URL`
- `POLLINATIONS_CONFIG.BASE_URL` → `VITE_POLLINATIONS_URL` (corrige el bug: `.env.example` ya documentaba esta var pero el código la ignoraba)
- `NETWORK_PROBE_URLS` → `VITE_NETWORK_PROBE_URLS` (lista separada por comas; `DEFAULT_NETWORK_PROBE_URLS` como fallback)

**`src/services/musicPlayer.ts`** — `SOUNDHELIX_BASE_URL = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-'` y las 4 pistas SoundHelix construyen su URL con `${SOUNDHELIX_BASE_URL}N.mp3` (elimina la ruta base repetida 4 veces).

**`src/voice/lib/geminiDiagnostics.js`** — `GEMINI_API_KEY_URL = 'https://aistudio.google.com/apikey'` usado vía template literal en los mensajes `gemini_quota_429` (es/en).

**`.env.example`** — documenta `VITE_OPENROUTER_URL`, `VITE_GEMINI_API_URL`, `VITE_GEMINI_PREDICT_URL`, `VITE_DEEPSEEK_URL`, `VITE_STREAM_STT_DEV_URL`, `VITE_NETWORK_PROBE_URLS` (con comentarios de los valores por defecto).

### Fase 2: Parches Problemáticos (Media Prioridad) — ✅ COMPLETADA (2026-08-19)
1. **Reemplazar eventos window** - ✅ Bus centralizado `src/core/events/fluEvents.ts` (`FLU_EVENTS`, `dispatchFluEvent`, `onFluEvent`); todos los `window.dispatchEvent(new CustomEvent('flu:*'))` reemplazados en `src/hooks/useNavigationCommands.ts` y listeners en `src/App.tsx`.
2. **Eliminar timer de visibilidad** - ✅ Timer de 1000ms eliminado; `ensureAvatarPantsVisible()` síncrono y determinista en `src/avatar/store/bunnyStore.ts` (re-exportado vía barrel `src/avatar/index.ts`), invocado con `useEffect` al montar en `src/App.tsx`. El store de Zustand es síncrono (sin persist), por lo que `getState()` está disponible al montar.
3. **Refactor post-processing** - ✅ Resuelto como resolución determinista de intención (sin override): la lógica de intención ya se resuelve antes de la generación (repetición/traducción/visual) en `src/voice/lib/gemini.js`, y el dispatch converge en `planConversationDispatch()`.

### Fase 3: Duplicación y Limpieza (Baja Prioridad) — ✅ COMPLETADA (2026-08-19)
1. **Refactor endpoints mezclados** - ✅ `src/server/geminiProxy.ts`: eliminado el código muerto `SYSTEM_PROMPT_CACHE` / `SYSTEM_PROMPT_CACHE_TTL_MS` / `buildSystemPromptCacheKey` (solo referenciados en el bloque no-op). `handleContract()` ahora es un dispatcher delgado que delega en `handleContractMode()`, `handleResponseMode()` y `handleMinuteMode()` (cada uno con JSDoc), conservando el cache de contrato.
2. **Consolidar lógica de dispatch** - ✅ Verificado: `planConversationDispatch()` en `src/voice/lib/audioMath.js` es la única fuente de verdad para la decisión de acciones de voz; `planVoiceCommandDispatch()` (voiceCommands.js) resuelve comandos de navegación desde texto; no hay rutas dobles.
3. **Centralizar system prompts** - ✅ Verificado: `buildMinuteSystemPrompt()` en `src/core/ai/prompts.ts` es compartido; `buildSystemPrompt()`/`buildConversationMessages()` viven en `src/voice/lib/gemini.js` y son consumidos por ambos servicios (gemini.js + deepseek.ts) vía el mismo módulo de prompts.

### Fase 4: Prevención Futura — ✅ COMPLETADA (2026-08-19)
1. **Agregar lint rule** - ✅ `tests/hardcodeGuard.test.ts`: escaneo fs de `src/` que detecta literales de URL. Allowlist por host (`SAFE_URL_PATTERNS`) + `ALLOWED_CONFIG_FILES` (`appConfig.ts`, `visualConfig.js`, `musicPlayer.ts`). Los hosts de endpoints de API (`generativelanguage.googleapis.com`, `api.deepseek.com`, `api.openverse.org`) quedan fuera del allowlist global, forzando que vivan en `appConfig`. Verifica >20 URLs detectadas (no es un no-op).
2. **Documentar convenciones** - ✅ Sección "8. CONVENCCIONES DE CONFIGURACIÓN EXTERNA" agregada a `CLAUDE.md` (patrón env con defaults, `.env.example` como fuente de verdad, bus de eventos, dispatch único, guard test, allowlist de dominios constantes).
3. **Crear tests de configuración** - ✅ `tests/configEnv.test.ts`: 8 tests que validan overrides de `VITE_GEMINI_API_URL`, `VITE_GEMINI_PREDICT_URL`, `VITE_DEEPSEEK_URL`, `VITE_OPENROUTER_URL`, `VITE_STREAM_STT_DEV_URL`, `VITE_POLLINATIONS_URL`, `VITE_NETWORK_PROBE_URLS` (comma-split) y branding (`VITE_APP_NAME`/`VITE_APP_VERSION`), más el test de defaults. Usa `vi.resetModules()` + `vi.stubEnv()` + import dinámico.

#### Nota sobre constantes centralizadas (Fase 1 residual)
`SOUNDHELIX_BASE_URL` (musicPlayer.ts), `GEMINI_API_KEY_URL` (geminiDiagnostics.js) y `VISUAL_CONFIG` (visualConfig.js) permanecen como constantes centralizadas en módulos de datos explícitos (NO dispersas en lógica de negocio). Se allowlistan en el guard test como "dominios constantes centralizados"; no se movieron a env porque son contenido/datos, no endpoints de servicio. Racional documentado en `CLAUDE.md` sección 8, punto 4.

---

## 🔍 **Hallazgos Específicos por Categoría**

### **Hardcode de URLs (12 instancias):**
- 5 URLs de música (musicPlayer.ts)
- 3 URLs de API (appConfig.ts)
- 2 URLs de prueba de red (appConfig.ts)
- 2 URLs en mensajes de error (geminiDiagnostics.js)

### **Patches/Workarounds (8+ instancias):**
- Sistema de eventos window (múltiples archivos)
- Timer de visibilidad (App.tsx)
- Post-processing override (App.tsx)
- Acceso directo a store (corregido)

### **Duplicación (6 áreas):**
- System prompts (gemini.ts / deepseek.ts)
- Lógica de dispatch (audioMath.js / voiceCommands.js)
- Endpoints mezclados (geminiProxy.ts)
- Funciones utilitarias (ya corregidas según auditoría)

---

## 📈 **Impacto y Riesgo**

| Categoría | Impacto | Riesgo | Prioridad |
|-----------|---------|--------|-----------|
| Hardcode URLs música | Medio | Bajo-Medio | Media |
| Hardcode URLs API | Alto | Medio | Alta |
| Eventos window | Medio | Bajo | Media |
| Duplicación prompts | Bajo | Bajo | Baja |
| Endpoints mezclados | Medio | Medio | Media |

---

## 🎯 **Recomendaciones Inmediatas**

1. **Crear archivo de configuración externa** para URLs de servicios
2. **Implementar sistema de eventos centralizado** para reemplazar `window.dispatchEvent`
3. **Agregar validación de URLs** en tiempo de ejecución
4. **Documentar convenciones de configuración** para desarrolladores futuros

---

## 📝 **Próximos Pasos**

1. **Revisar este análisis** con el equipo
2. **Priorizar correcciones** basándose en impacto/riesgo
3. **Implementar correcciones** en fases
4. **Agregar tests** para prevenir regresiones
5. **Documentar cambios** en ESTADO_SISTEMA.md

---

*Análisis completado: 2026-08-19 00:30 UTC*
*Archivos examinados: 50+ archivos clave*
*Patrones identificados: 20+ instancias problemáticas*