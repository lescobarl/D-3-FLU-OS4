# Plan de Implementación — Punto 1 (Autoconocimiento de FLU) y Punto 3 (Búsqueda web de imágenes/vídeo en vez de Pollinations)

> Documento de ejecución derivado de [`plans/propuesta-autoconocimiento-flu-y-conectividad.md`](propuesta-autoconocimiento-flu-y-conectividad.md).
> Todo paso está anclado a archivos reales del repo (sin "dummies"). Reglas que no se negocian:
> **NO HARDCODE** (labels/valores desde `FLU_CONFIG` con `|| '...'`), **config-driven**, **sin pantallas nuevas ni rutas nuevas**,
> **audit log**, **DI** (los hooks reciben callbacks), **§9 protocolo de iteración rápida** (validar cada fase antes de seguir),
> **la suite debe seguir verde** (~130 archivos / 2618 vitest + Playwright e2e).
>
> **Alcance:** Punto 1 (Autoconocimiento de FLU) + Punto 3 (reemplazar Pollinations por búsqueda web de imágenes/vídeo).
> El Punto 2 (conectividad: chat grupal/videollamada/juegos en línea) queda en
> [`plans/plan-implementacion-autoconocimiento-y-conectividad.md`](plan-implementacion-autoconocimiento-y-conectividad.md) y **no** se ejecuta en este plan.

---

## §0 Resumen ejecutivo

| Fase | Entregable | Esfuerzo | Riesgo | Valida con |
|---|---|---|---|---|
| **P1-A** | Registro de capacidades compilado `selfKnowledge.ts` | S (1–2 días) | Bajo | `npx tsc --noEmit`, `tests/selfKnowledge.test.ts` |
| **P1-B** | `buildSelfManifesto(lang)` desde el registro | S | Bajo | test puro del manifiesto |
| **P1-C** | Intento local `CONOCER_FLU` (voz + dispatch, sin IA) | M (2–3 días) | Medio | test de detección + dispatch |
| **P1-D** | Inyección del manifiesto en el contexto Gemini | S | Bajo | e2e curado "qué sabes hacer" |
| **P3-A** | Config: extender `pipeline.primary` (`'pollinations'\|'web'\|'auto'`) + bloque `webSearch` | S | Bajo | `tests/fluVisualPipeline.test.ts` |
| **P3-B** | Resolver web `fluVisualWebSearch.js` → `resolveWebImageArtifact` vía `/api/search/images` | S–M | Medio | `tests/fluVisualWebSearch.test.ts` |
| **P3-C** | Cableado del selector `primary` (fix del dead-else + rutas voz/servicio) | M | Medio | unit de regresión + `npx tsc --noEmit` |
| **P3-D** | Crédito/provenance (host) + `resolveWebVideoArtifact` vía `/api/search/video` | S | Bajo | unit + e2e manual |
| **P3-E** | Tests y validación (ambos puntos) | S | — | vitest + build |

**Decisiones de producto previas (obligatorias):**
- **Punto 1:** la respuesta a "¿qué sabes hacer, FLU?" debe ser **determinista y offline** (fast-path local `CONOCER_FLU`), y el LLM debe poder responder enumerando capacidades **reales** (manifiesto compilado, no inventado).
- **Punto 3:** NO se añade ninguna API nueva (se preserva la doctrina "SOLO 2 APIs": Pollinations + OpenRouter). La búsqueda web de imágenes/vídeo **ya existe** (`/api/search/images|video` + Commons keyless); el trabajo es **normalizar resultados como artefacto** y **honrar el selector de fuente `primary`** que ya está declarado pero es **inerte** (dead-else). El "reemplazo" se implementa como **feature-flag** (`primary:'web'|'auto'`, `webSearch.enabled`), con default `'pollinations'` → comportamiento actual intacto (backward compatible).

---

## §1 Punto 1 — Autoconocimiento de FLU

### 1.0 Diagnóstico (qué ya existe, qué falta)

**Ya existe (y hay que reutilizar, no duplicar):**
- [`src/services/capabilities.ts`](capabilities.ts) — catálogo **estático** de 7 capacidades (`FLU_CAPABILITIES`) e inyección en el system prompt vía [`buildCapabilitiesPrompt()`](../src/services/capabilities.ts:88), montada en [`gemini.js:447`](../src/voice/lib/gemini.js:447). Es el patrón a seguir, pero está incompleto y orientado al modelo (campos de contrato), no a orientar al usuario.
- Todas las fuentes de datos reales: `FLU_CONFIG.voiceCommands` (frases, `fluConfig.js:1887-2185`), `GAME_CATALOG` + `GAME_IDS` (`gameCatalog.ts:1-289`), catálogo de sitios del navegador curado + `defaultProfile.allowlist` (`fluConfig.js:714-1081`), `WORKSPACE_TIPOS` (`appConfig.ts:168`), proveedores de búsqueda web/imágenes/video (`fluConfig.js:883-1080`), pestañas de la app (`fluConfig.js:1605-1611`), comandos de voz (`NAVIGATION_COMMAND_IDS` en `voiceCommands.js:16-32`).
- API de voz: [`voiceCommands.js`](../src/voice/lib/voiceCommands.js), detección en [`audioMath.js`](../src/voice/lib/audioMath.js) — `detectUiVoiceCommand` 485-535 resuelve `NAVEGAR` (523-525) y `BUSCAR` (530-532) vía `matchesCommandPhrase(..., {tolerant:true})`; `detectSessionVoiceCommand` 538-574 **delega** en `detectUiVoiceCommand`; `collectVoiceCommandPhrases` 161-174 es **privada** (solo para `isIncompleteVoiceCommand` 177). Dispatch por handlers en `App.tsx` (`__fluHandleTemporalText` 2367, `__fluHandleReminderText` 2262).
- Patrón de inyección de contexto en el user prompt: `agendaText` (líneas `gemini.js:518-523`), `recentMemory` (`gemini.js:527-532`), con la cadena `useFluVoiceAssistant.js:995-1028` → `generateFluContract` → `buildUserPrompt`.

**Falta (el hueco confirmado con búsqueda = 0 resultados en `src/`):**
1. No existe ningún intento `CONOCER_FLU`/"qué sabes hacer" (0 hits).
2. El catálogo de capacidades no cubre juegos, comandos de voz, páginas, sitios permitidos, tipos de workspace ni proveedores de búsqueda.
3. No hay respuesta **determinista offline** a "¿qué puedes hacer, FLU?" — hoy depende de que Gemini conteste bien con el system prompt.

### 1.1 Fase A — Registro de capacidades compilado

**Nuevo archivo:** `src/core/selfKnowledge/selfKnowledge.ts` (módulo TS puro, sin React, testeable).

Contrato:
```ts
export interface FluCapability {
  id: string
  categoria: 'comando' | 'pagina' | 'juego' | 'sitio' | 'workspace' | 'busqueda' | 'contrato'
  labelEs: string
  labelEn: string
  descriptionEs: string
  descriptionEn: string
  triggerPhrases: string[]   // compiladas desde FLU_CONFIG.voiceCommands / aliases
  requiresApi: boolean
}

export interface SelfKnowledgeSnapshot {
  capabilities: FluCapability[]
  comandos: string[]
  juegos: string[]
  sitiosPermitidos: string[]
  tiposWorkspace: string[]
  pestañas: string[]
  proveedoresBusqueda: string[]
  totalCapacidades: number
}
```

**Regla clave (anti-hardcode, §10 de CLAUDE.md):** el registro se **compila** (nunca se escribe a mano) a partir de:
- `FLU_CONFIG.voiceCommands` → entrada `comando` (1 por bloque, con sus frases como `triggerPhrases`).
- `GAME_CATALOG` (`src/core/games/gameCatalog.ts`) → entrada `juego` por id, `triggerPhrases` = aliases, `requiresApi` = flag del catálogo.
- `getSearchSites()`/`BUILTIN_SEARCH_SITES` (`src/core/search/searchCatalog.ts:83` + `searchSiteTypes.ts`) + `defaultProfile.allowlist` (`fluConfig.js:756`) + `browserProfileService` → entradas `sitio`. NOTA: `FLU_CONFIG.browser.catalog` (`fluConfig.js:851-879`) son solo labels de UI del panel; el catálogo curado real vive en `searchCatalog.ts`.
- `WORKSPACE_TIPOS` (`src/core/config/appConfig.ts:168`) → entradas `workspace`.
- `FLU_CONFIG.ui.tabs.items` (`fluConfig.js:1605-1611`) → entradas `pagina`.
- `FLU_CONFIG.browser.search.providers` (`fluConfig.js:883-1080`) → entradas `busqueda`.
- `src/services/capabilities.ts` (`FLU_CAPABILITIES`) → entradas `contrato` (reutiliza las 7 existentes).

Funciones exportadas: `buildSelfKnowledgeSnapshot(config = FLU_CONFIG): SelfKnowledgeSnapshot`, `findCapabilityByText(text, lang)`, `capabilitiesByCategoria(snapshot)`.

### 1.2 Fase B — Manifiesto de FLU (`buildSelfManifesto`)

**Mismo archivo** `src/core/selfKnowledge/selfKnowledge.ts`:

```ts
export function buildSelfManifesto(lang: 'es' | 'en' = 'es', config = FLU_CONFIG): string
```

- Genera un texto de 1ª persona ("Soy FLU… puedo…") compilado desde el snapshot (Fase A), **nunca hardcodeado**.
- Secciones: comandos de voz, páginas/pestañas, juegos (con flag "requieren IA" solo para `cuentacuentos`/`cuento_colaborativo`), sitios permitidos, tipos de workspace, búsqueda (web/imágenes/video), capacidades de contrato.
- Labels es/en desde `FLU_CONFIG` con fallback `|| '...'`.

**Inyección en el system prompt (reforzar, no duplicar):** en [`buildSystemPrompt()`](../src/voice/lib/gemini.js:327) se agrega un elemento más al array (junto a `buildCapabilitiesPrompt` en la línea 447):
```ts
...buildSelfManifestoPrompt(isEnglish ? 'en' : 'es')
```
donde `buildSelfManifestoPrompt` se implementa en `selfKnowledge.ts` como bloque compacto para el system prompt (el LLM debe saber que puede responder a "¿qué sabes hacer?" enumerando capacidades reales, sin inventar).

### 1.3 Fase C — Intento local determinista `CONOCER_FLU` (sin IA)

**1.3.1** Añadir id a la lista congelada [`NAVIGATION_COMMAND_IDS`](../src/voice/lib/voiceCommands.js:16-32): `'CONOCER_FLU'`.

**1.3.2** Nuevo bloque de frases en `FLU_CONFIG.voiceCommands` ([`fluConfig.js:1887-2185`](../src/voice/lib/fluConfig.js:1887)) — config-driven, NO hardcode:
```js
conocerFlu: [
  'que sabes hacer', 'que puedes hacer', 'que sabe hacer flu', 'que puedes hacer flu',
  'que haces', 'que funciones tienes', 'cuentame tus habilidades', 'para que sirves',
  'what can you do', 'what do you do', 'what are your skills', 'what can flu do',
],
```
Regla de pares es/en (mismo patrón que `navigate`/`buscar`).

**1.3.3** Detección en [`audioMath.js`](../src/voice/lib/audioMath.js). Patrón idéntico a `NAVEGAR`/`BUSCAR` = añadir un bloque en `detectUiVoiceCommand` (después de `BUSCAR`, líneas 530-532) que retorne `'CONOCER_FLU'` vía `matchesCommandPhrase(text, commands.conocerFlu || [], {tolerant:true})`. `detectSessionVoiceCommand` (538) ya resuelve `CONOCER_FLU` por delegación (543/551/569), sin cambios. Añadir `conocerFlu` a `collectVoiceCommandPhrases` (161) es **opcional** (mejora el "esperar frase incompleta" de `isIncompleteVoiceCommand` 177), pero NO es el mecanismo de detección.

**1.3.4** Dispatch en `App.tsx` (patrón `__fluHandleTemporalText` línea 2367): nuevo handler `__fluHandleConocerFluText` (o case dentro del dispatch de comandos) que:
1. Detecta `CONOCER_FLU`.
2. Construye `buildSelfManifesto(lang)`.
3. Devuelve la respuesta hablada local (respuesta_voz) **sin llamar a Gemini** (fast-path offline).
4. Escribe en el audit log (hook `useAuditLog.logEvent`) con la categoría de la acción.

**Nota de armonía con `mapChatMessagesToGemini`:** si el fast-path local responde, **no se genera contrato**; si por el contrario el flujo cae en Gemini, el manifiesto ya está en el system prompt (1.2) y en el user prompt (1.4).

### 1.4 Fase D — Inyección del manifiesto en el contexto Gemini (vía del LLM)

Replicar exactamente el patrón `agendaText`:

1. **`gemini.js` — [`buildUserPrompt`](../src/voice/lib/gemini.js:451):** nuevo parámetro `selfKnowledgeText = ''`; inyectar junto a `agendaText` (líneas 518-523):
```js
...(selfKnowledgeText
  ? [isEnglish
    ? `FLU SELF-KNOWLEDGE (answer what FLU can do using this only):\n${selfKnowledgeText}`
    : `AUTOCONOCIMIENTO DE FLU (responde qué sabe hacer FLU usando SOLO esto):\n${selfKnowledgeText}`
  ]
  : []),
```
2. **`gemini.js` — [`buildConversationMessages`](../src/voice/lib/gemini.js:539)** y **`generateFluContract` (línea 1024):** propagar el parámetro `selfKnowledgeText` (mismo camino que `agendaText`, líneas 592-593 y 1144-1145).
3. **`useFluVoiceAssistant.js`:** aceptar callback `getSelfManifesto = () => ''` (junto a `getDailyAgenda`, línea 354), calcular `const selfKnowledgeText = getSelfManifestoRef.current() || ''` (junto a línea 996-998) y pasarlo en `requestFluContract` (líneas 1010-1028).
4. **`App.tsx`:** registrar `getSelfManifesto: () => buildSelfManifesto(language)` en el proveedor de `FluBridgeProvider` (patrón `getDailyAgenda` en `App.tsx:1411-1431`) y pasar el callback a `useFluVoiceAssistant` (patrón línea 355).

**Umbral de uso (decisión tomada):** se añade en `selfKnowledge.ts` el helper `isSelfKnowledgeRequest(text, lang): boolean` que resuelve `findCapabilityByText(text, lang)` contra las categorías `comando`/`contrato` con `triggerPhrases` de `conocerFlu` (+ aliases es/en). Solo si devuelve `true` se inyecta `selfKnowledgeText` en el user prompt — así no se ensucia el prompt en turnos normales (coherencia con la Optimización 1.2/1.4 de latencia comentada en `gemini.js:1062-1068`). El fast-path local `CONOCER_FLU` (1.3) cortocircuita antes y no llega a Gemini; si igual cae en Gemini (frase ambigua no capturada por el fast-path), el manifiesto ya está en el system prompt (1.2) como red de seguridad.

### 1.5 Tests y validación (Punto 1)

**Nuevo archivo:** `tests/selfKnowledge.test.ts`
- `buildSelfKnowledgeSnapshot` compila desde `FLU_CONFIG` real (sin mocks): contiene todos los comandos de `voiceCommands`, los 21 juegos del catálogo, los sitios de la allowlist, los `WORKSPACE_TIPOS`, las pestañas.
- `buildSelfManifesto('es')` / `('en')` no está vacío, no repite placeholders `||`, menciona al menos 1 juego y 1 comando, y **no contiene URLs hardcodeadas** (compatible con `tests/hardcodeGuard.test.ts`).
- `findCapabilityByText` resuelve "loteria", "quien soy", "que sabes hacer".
- `detectSessionVoiceCommand` (que delega en `detectUiVoiceCommand`) reconoce `CONOCER_FLU` con frases es y en (se testea la función pública; `collectVoiceCommandPhrases` es privada y no es directamente testeable).

**Comandos:**
```
npx tsc --noEmit
npx vitest run tests/selfKnowledge.test.ts tests/voiceCommands.test.ts tests/hardcodeGuard.test.ts
npm run build   # si existe script de build del PWA
```

---

## §2 Punto 3 — Reemplazar Pollinations por búsqueda web de imágenes/vídeo

### 2.0 Diagnóstico (qué ya existe, qué falta)

**Ya existe (reutilizable, no duplicar):**
- **El selector de fuente `primary` YA existe** y está declarado en [`visualConfig.js`](../src/voice/lib/visualConfig.js): `VISUAL_CONFIG.image.pipeline.primary = 'pollinations'` (default). Se normaliza en [`getVisualPipelineConfig()`](../src/voice/lib/fluVisualPipeline.js:31) (`primary: String(pipeline.primary || 'pollinations').trim()`) y se expone en `VISUAL_PIPELINE_KEYS` (`fluVisualPipeline.js:7-25`).
- **`buildWorkspaceImageArtifact` YA consulta `c.primary`** ([`imageGeneration.js:109-113`](../src/voice/lib/imageGeneration.js:109)), pero **las dos ramas retornan `buildPollinationsArtifact`** (dead-else): el selector es **inerte**. No existe rama `'web'` ni `'auto'`.
- **Infraestructura de búsqueda web same-origin YA existe:** `/api/search/web|images|video` ([`searchProxy.ts:217-219`](../src/server/searchProxy.ts:217), `handleSearch` 117-193, `createSearchProxy` 195-222). El navegador nunca toca Wikimedia directamente: el middleware de Vite sí, reutilizando `fetchProviderJson`.
- **Proveedor de imágenes Commons ENABLED y keyless** ([`fluConfig.js:925-935`](../src/voice/lib/fluConfig.js:925)): `gsrnamespace=6`, `prop=imageinfo`, `iiurlwidth=320`, `maxResults:12`, `timeoutMs:8000`. **Proveedor de vídeo `commons-video` ENABLED y keyless** ([`fluConfig.js:936-945`](../src/voice/lib/fluConfig.js:936)); `youtube`/`invidious` DISABLED (config-driven).
- **`normalizeCommonsMedia`** ([`searchSession.ts:231-272`](../src/core/search/searchSession.ts:231)) ya devuelve `{title, snippet, url, host, source:'commons'|'commons-video', allowed:true, type, thumbnail, fileUrl, width, height}` → tiene `host`/`thumbnail`/`fileUrl` para **crédito/provenance**.
- **Límites:** `maxResultsByType: {web:8, images:24, video:8}` ([`fluConfig.js:968-972`](../src/voice/lib/fluConfig.js:968)).
- **Dos caminos de imagen convergen en `/api/workspace-image`** ([`geminiProxy.ts:377-387`](../src/server/geminiProxy.ts:377), registrado en 529):
  - **Voz:** [`fetchWorkspaceImageSource`](../src/voice/lib/imageGeneration.js:144) (POST `{workspace, language, apiKey}`) → proxy → [`generateWorkspaceImage`](../src/voice/lib/gemini.js:229) → `buildGenerationPrompt` → `buildPollinationsUrl(prompt)` directo.
  - **Servicio:** [`useWorkspaceImage`](../src/hooks/useWorkspaceImage.ts:75) → `aiService.generateWorkspaceImage` → [`gemini.ts:517-614`](../src/services/gemini.ts:517) (POST al proxy; usa `data.imageUrl` si viene, si no fallback `buildPollinationsUrl`); [`deepseek.ts:651-700`](../src/services/deepseek.ts:651) llama `buildPollinationsUrl` **directo** (sin proxy).
- **Fallbacks offline ya existen:** `resolveWorkspaceAiImageSource` (local SVG, [`imageGeneration.js:73-88`](../src/voice/lib/imageGeneration.js:73)) + `resolveErrorFallback` (120-142) + `shouldUseLocalSvgOnError` (`fluVisualPipeline.js:161`).
- **Stock de Openverse** ([`fluVisualStockSearch.js`](../src/voice/lib/fluVisualStockSearch.js) `resolveOpenverseStockArtifact` 55-96) es una ruta **directa a la API de Openverse** (no pasa por el proxy), gated por `stockSearch.enabled === false` (default OFF). Es un pre-paso distinto del web search y **no se mezcla** con él.
- **Render ya listo:** [`ImageGrid.tsx`](../src/components/ImageGrid.tsx) y [`VideoGrid.tsx`](../src/components/VideoGrid.tsx) renderizan `SearchResult` (thumbnail / embed / watch) — los destinos de render de los artefactos web.

**Falta (el hueco confirmado con búsqueda = 0 resultados):**
1. **No existe rama `'web'` ni `'auto'`** en el selector `primary` → el dead-else (`imageGeneration.js:113`) deja el selector muerto.
2. **No existe resolver** que normalice resultados de `/api/search/images` como **artefacto** (`image_url` + trace con host/crédito).
3. **No existe resolver web de vídeo** como listado/artefacto: hoy `GENERAR_VIDEO` ([`fluConfig.js:2064-2077`](../src/voice/lib/fluConfig.js:2064)) es **ensamblado offline** (`videoAssembler.ts`, walkthrough con ffmpeg.wasm → storyboard). No hay vídeo de Pollinations que "reemplazar"; el entregable de vídeo = **superficiar `/api/search/video`** (Commons-video ya está ENABLED) en el workspace.
4. **Las rutas de imagen (voz y servicio) NO consultan `primary`:** `gemini.js:229-271`, `gemini.ts:517-614` y `deepseek.ts:651-700` siempre generan con Pollinations.

### 2.1 Fase A — Config: extender `pipeline.primary` + bloque `webSearch`

**2.1.1** [`visualConfig.js`](../src/voice/lib/visualConfig.js) — ampliar el valor admitido de `VISUAL_CONFIG.image.pipeline.primary` a `'pollinations' | 'web' | 'auto'` (documentarlo en el comentario del bloque) y añadir un bloque nuevo, **config-driven, NO hardcode**:
```js
// VISUAL_CONFIG.image.pipeline
primary: 'pollinations',   // 'pollinations' | 'web' | 'auto'  (default = actual)
webSearch: {
  enabled: false,          // feature-flag; default OFF = nada cambia hoy
  mode: 'images',          // 'images' | 'video'  (el resolver elige endpoint)
  minAcceptScore: 2,       // tokens mínimos para aceptar un resultado de Commons
  timeoutMs: 8000,         // debe alinearse con FLU_CONFIG.browser.search.timeoutMs
},
```
> El **endpoint** (`/api/search/images|video`), el **provider** (Commons) y el **maxResults** NO se hardcodean aquí: la fuente de verdad es `FLU_CONFIG.browser.search.endpoints` + `providers.images[0]`/`providers.video` + `maxResultsByType` ([`fluConfig.js:883-972`](../src/voice/lib/fluConfig.js:883)). El resolver los lee en runtime (patrón `resolveSearchProviders`/`buildProviderRequest` de `searchSession.ts:126-164`; **no existe `getSearchConfig`**).

**2.1.2** [`fluVisualPipeline.js`](../src/voice/lib/fluVisualPipeline.js) — añadir a `VISUAL_PIPELINE_KEYS` (líneas 7-25) y a `getVisualPipelineConfig()` (líneas 31-58):
- `webSearchEnabled` → `pipeline.webSearch?.enabled === true`
- `webSearchMode` → `String(pipeline.webSearch?.mode || 'images').trim()`
- `webSearchMinAcceptScore` → `Number(pipeline.webSearch?.minAcceptScore)`
- `webSearchTimeoutMs` → `Number(pipeline.webSearch?.timeoutMs)`

**2.1.3** Nuevo `tests/fluVisualPipeline.test.ts` (si no existe) o ampliar el existente: `getVisualPipelineConfig()` normaliza `primary` a `'pollinations'` por defecto, y con `webSearch.enabled:true` expone `webSearchEnabled:true`. `VISUAL_PIPELINE_KEYS` incluye las keys nuevas (el test del inventario de reglas visuales, si existe, se actualiza).

### 2.2 Fase B — Resolver web de imágenes (`resolveWebImageArtifact`)

**Nuevo archivo:** `src/voice/lib/fluVisualWebSearch.js` (JS, patrón de [`fluVisualStockSearch.js`](../src/voice/lib/fluVisualStockSearch.js) pero usando el **proxy same-origin**, no la API directa).

```js
export async function resolveWebImageArtifact({ workspace = {}, language = 'es' } = {})
```
- Retorna `null` si `webSearchEnabled !== true` (feature-flag) — **sin tocar red**.
- `brief = buildGenerationPrompt(workspace, language)` o `resolveVisualBriefCore(workspace)` (reutiliza `fluVisualPipeline.js:82-120`).
- `query = encodeURIComponent(brief)`; `endpoint` desde `FLU_CONFIG.browser.search.endpoints.images`; `maxResults` capado por `maxResultsByType.images` (24).
- `GET ${endpoint}?q=${query}` con `AbortController` + `timeoutMs` (patrón `fetchJsonWithTimeout` de `fluVisualStockSearch.js:13-28`).
- Toma `results` (ya normalizados por `normalizeCommonsMedia`), filtra `allowed === true` y `thumbnail` presente; puntúa cada uno con **token matching** contra el brief (patrón `scoreOpenverseResult` de `fluVisualStockSearch.js:30-49`), aplica `minAcceptScore`, ordena y elige el mejor.
- **El filtro `allowed === true` es seguro (verificado):** el proxy solo filtra por allowlist para `type==='web'` ([`searchProxy.ts:186`](../src/server/searchProxy.ts:186)) y para imágenes/video solo cuando `safe==='1'` (187-189); `normalizeCommonsMedia` hardcodea `allowed:true` ([`searchSession.ts:263`](../src/core/search/searchSession.ts:263)). **Caveat operativo:** el resolver debe llamar a `/api/search/images|video` **sin `safe=1`** para que los resultados Commons sigan llegando `allowed:true`.
- Retorna artefacto con **crédito/provenance**:
```js
{
  image_url: best.thumbnail || best.fileUrl,
  trace: {
    provider: 'web-search',
    source: 'commons_web_search',
    hasImage: true,
    query: brief,
    title: best.title,
    host: best.host,
    url: best.url,
    credit: best.host,   // provenance para el pie de crédito
    score,
    language,
  },
}
```
- Si no hay resultado aceptable → `null` (el caller cae al fallback Pollinations/SVG, NO rompe el flujo).
- Registrar la función en el inventario visual (junto a `listConfiguredVisualPipelineRules`) para trazabilidad.

### 2.3 Fase C — Cableado del selector de fuente `primary`

**2.3.1 Fix del dead-else en [`buildWorkspaceImageArtifact`](../src/voice/lib/imageGeneration.js:90):**
```
if (c.primary === 'web' || c.primary === 'auto') {
  const web = await resolveWebImageArtifact({ workspace, language })
  if (web?.image_url) return { ...web, trace: { ...web.trace, prompt } }
}
if (c.primary === 'pollinations') {
  return buildPollinationsArtifact(prompt, { seedInput: `${language}::${prompt}` })
}
return buildPollinationsArtifact(prompt, { seedInput: `${language}::${prompt}` })   // ← se elimina (dead-else)
```
- `'web'` → solo búsqueda; si falla → `resolveErrorFallback` (SVG local), **no** Pollinations (semántica de "reemplazo").
- `'auto'` → búsqueda primero, con fallback a `buildPollinationsArtifact` (coexistencia).
- `'pollinations'` → comportamiento **idéntico al actual** (prueba de regresión en 2.5).
- El pre-paso Openverse (`stockSearchEnabled`) se mantiene **independiente** y **antes** del selector (no se mezcla con web).

**2.3.2 Ruta de voz [`generateWorkspaceImage`](../src/voice/lib/gemini.js:229):** hoy construye `buildPollinationsUrl(prompt)` directo. Cambiar: resolver `getVisualPipelineConfig().primary`; si `'web'|'auto'` → `resolveWebImageArtifact` → `{imageUrl: web.image_url, trace: web.trace}`; else Pollinations. Como el proxy `/api/workspace-image` reenvía a este mismo handler, **ambas rutas del proxy quedan cubiertas** con un solo cambio.

**2.3.3 Servicio Gemini ([`gemini.ts:517-614`](../src/services/gemini.ts:517)):** el POST al proxy devuelve `data.imageUrl`, que ya respetará `primary` si 2.3.2 se aplica. **Decisión tomada para el fallback local:** si el proxy falla y `primary` es `'web'|'auto'`, intentar `resolveWebImageArtifact` (fetch cliente al mismo endpoint) **antes** de `buildPollinationsUrl`; con `primary:'pollinations'` el fallback se mantiene **exactamente igual** (regresión §2.5).

**2.3.4 Servicio DeepSeek ([`deepseek.ts:651-700`](../src/services/deepseek.ts:651)):** llama `buildPollinationsUrl` **directo** (no pasa por proxy). Cambio mínimo: consultar `primary`; si `'web'|'auto'` → reutilizar `resolveWebImageArtifact` (mismo fetch cliente) y construir `{image_url, trace}`; else Pollinations. Es el backend menos usado; se mantiene simple.

**2.3.5 Audit log:** cada resolución web (imagen/vídeo) registra evento con categoría (p. ej. `visual.web` / `visual.web.video`) en el audit log existente (`useAuditLog.logEvent`).

### 2.4 Fase D — Crédito/provenance y vídeo web

**2.4.1 Crédito/provenance en el render (sin pantalla nueva):**
- El artefacto ya lleva `trace.host`/`trace.title`/`trace.url`.
- El overlay del workspace ([`App.tsx:3525-3552`](../src/App.tsx:3525)) y/o `ImageGrid` muestran un pie de crédito "Imagen: {host}" leyendo el label desde `FLU_CONFIG` (p. ej. nuevo `FLU_CONFIG.ui.workspace.imageCredit` o reutilizar labels de `browser.search.ui`) — **NO hardcode** (fallback `|| '...'`).
- Al hacer clic, abrir `trace.url` (el original en Wikimedia) vía el flujo de navegación existente (allowlist/browser), no una ruta nueva.

**2.4.2 Vídeo web — [`resolveWebVideoArtifact`](../src/voice/lib/fluVisualWebSearch.js):** espejo del de imágenes:
- `GET ${endpoints.video}?q=${query}` (tipo `'video'`, provider `commons-video` ENABLED, cap `maxResultsByType.video` = 8).
- Retorna `{ videoResults: SearchResult[], trace }` con host/title/thumbnail por item.
- Se renderiza con el **`VideoGrid.tsx` existente** (ya muestra `SearchResult` de tipo vídeo) dentro del workspace — sin pantalla ni ruta nuevas.

**2.4.3 Alcance explícito sobre `GENERAR_VIDEO`:** el comando de voz `GENERAR_VIDEO` ([`fluConfig.js:2064-2077`](../src/voice/lib/fluConfig.js:2064), dispatch `useNavigationCommands.ts:230` → `videoAssembler.ts`) **sigue siendo ensamblado offline** (walkthrough/storyboard). La búsqueda web de vídeo se ofrece como **listado de resultados** en el workspace; **no sustituye** la generación. En una iteración posterior el workspace puede ofrecer ambas vías (generar con Pollinations/flux vs. buscar en Commons-video) sin cambiar el selector de fuente de imágenes.

### 2.5 Fase E — Tests y validación (Punto 3)

**Nuevo archivo:** `tests/fluVisualWebSearch.test.ts` (patrón de `tests/searchProxy.test.ts` / `tests/searchSession.test.ts`, con `fetch` mockeado):
- `resolveWebImageArtifact` con `webSearch.enabled:false` → `null` **sin llamar a fetch** (feature-flag).
- Con mock de `GET /api/search/images`: devuelve artefacto con `image_url`, `trace.source === 'commons_web_search'`, `trace.host`, `trace.credit`, `trace.score`; **filtra** `allowed:false`; **aplica** `minAcceptScore` (resultado de bajo score → null).
- `resolveWebVideoArtifact` devuelve `videoResults` normalizados con `host`/`thumbnail`.
- **Regresión del selector:** `buildWorkspaceImageArtifact` con `primary:'pollinations'` (default) produce el mismo artefacto que hoy y **no toca fetch**; con `primary:'web'` + mock resuelve web; con `primary:'web'` + fallo de red → resuelve el fallback local (SVG), no lanza.
- Compatible con `tests/hardcodeGuard.test.ts` (sin URLs hardcodeadas en el nuevo código: el endpoint sale de `FLU_CONFIG`).

**Comandos (validar cada fase antes de seguir, §9):**
```
npx tsc --noEmit
npx vitest run tests/fluVisualWebSearch.test.ts tests/fluVisualPipeline.test.ts tests/selfKnowledge.test.ts tests/searchProxy.test.ts tests/searchSession.test.ts tests/hardcodeGuard.test.ts
npm run build   # si existe script de build del PWA
```
- **e2e (manual/Playwright):** workspace con query visual y `webSearch.enabled:true` (vía `SearchControlCenter`/overrides) → artefacto con pie de crédito `host`; pestaña de vídeo muestra resultados de Commons-video.

### 2.6 Riesgos y decisiones (Punto 3)

- **Doctrina "SOLO 2 APIs" intacta:** no se añade ninguna API nueva. Commons se consulta vía el **proxy same-origin existente** `/api/search/images|video` (el navegador nunca toca Wikimedia directamente; el middleware de Vite ya lo hace hoy en `searchProxy.ts`). Pollinations se mantiene como fallback (`'auto'`) o se desactiva (`'web'`) vía config.
- **Backward compatible:** default `primary:'pollinations'` + `webSearch.enabled:false` → comportamiento actual **exactamente igual** (la corrección del dead-else no altera la rama `'pollinations'`).
- **Sin pantallas ni rutas nuevas:** se reutilizan `ImageGrid`/`VideoGrid` y el overlay existente.
- **Offline:** si la búsqueda falla → `resolveErrorFallback` → SVG local (igual que hoy).
- **"Reemplazo" vs. coexistencia:** el plan entrega el **selector de fuente** para conmutar sin cirugía (`'web'` = solo búsqueda, `'auto'` = web con fallback a Pollinations, `'pollinations'` = actual). El "reemplazo" definitivo sería fijar el default a `'web'` **después** de validar calidad de Commons (decisión de producto, no de código).
- **Cap de resultados:** el resolver respeta `maxResultsByType` de `FLU_CONFIG` (images 24, video 8) — nunca más.

---

## §3 Orden de ejecución y riesgos (global)

**Orden de ejecución (§9: validar cada fase antes de seguir):**
1. **P1-A → P1-B → P1-C → P1-D → P1-E** (autoconocimiento; P1-C es el único con riesgo medio: detección + dispatch de voz).
2. **P3-A (config) → P3-B (resolver web) → P3-C (cableado `primary` + fix dead-else) → P3-D (crédito + vídeo) → P3-E (tests).**

P1 y P3 son **independientes entre sí** (módulos distintos: `selfKnowledge.ts` vs. `fluVisualWebSearch.js`); pueden ejecutarse en paralelo si se quiere, pero se recomienda terminar P1 antes de P3 para no mezclar dos frentes en el mismo sprint.

**Riesgos globales:**
- No romper la doctrina de APIs ni añadir pantallas/rutas nuevas.
- La suite debe seguir verde: ~130 archivos / 2618 vitest + Playwright e2e (correr unit y e2e **secuencialmente**, no en paralelo).
- El dead-else de `imageGeneration.js:113` es un **bug latente**: la prueba de regresión (2.5) debe confirmar que con `primary:'pollinations'` el resultado es idéntico al actual.
- NO HARDCODE en el código nuevo: todo label/valor desde `FLU_CONFIG`/`VISUAL_CONFIG` con fallback `|| '...'` (compatible con `tests/hardcodeGuard.test.ts`).

---

## §4 Resumen (§10)

El plan entrega dos mejoras independientes y ambas **config-driven, offline-first y sin pantallas ni rutas nuevas**:

- **Punto 1 — Autoconocimiento de FLU:** un registro de capacidades **compilado** desde `FLU_CONFIG`/catálogos reales ([`selfKnowledge.ts`](selfKnowledge.ts)), un **manifiesto** en 1ª persona (`buildSelfManifesto`) inyectado en el system y user prompt (patrón `agendaText`), y un **intento local determinista `CONOCER_FLU`** que responde "qué sabes hacer" sin IA (fast-path offline + audit log).
- **Punto 3 — Búsqueda web de imágenes/vídeo en vez de Pollinations:** se reactiva el **selector de fuente `primary`** (hoy inerte por un dead-else) para soportar `'pollinations' | 'web' | 'auto'`, se añade un **resolver web** que normaliza resultados de `/api/search/images` (Commons keyless) como **artefacto con crédito/host**, y se superfícia `/api/search/video` (Commons-video) con el `VideoGrid` existente. No se añade ninguna API; el default sigue siendo `'pollinations'` hasta que se valide calidad y se fije `'web'`.

Nada de esto se implementa todavía: este documento es **el plan**. La ejecución arrancará fase por fase (P1-A primero) solo cuando lo apruebes.

---

## §5 Historial de correcciones (auditoría del plan, 2026-08-31)

Correcciones incorporadas tras verificar cada ancla contra el código real del repo:

1. **§1.3.3 — Detección de `CONOCER_FLU`:** se aclara que el patrón `NAVEGAR`/`BUSCAR` vive en `detectUiVoiceCommand` (audioMath.js:523-532), no en `detectSessionVoiceCommand` (que delega) ni en `collectVoiceCommandPhrases` (privada, no exportada). El bloque nuevo va en `detectUiVoiceCommand`; el añadido a `collectVoiceCommandPhrases` queda opcional.
2. **§1.1 — Fuente de `sitio`:** se sustituye `FLU_CONFIG.browser.catalog` (solo labels de UI) por `getSearchSites()`/`BUILTIN_SEARCH_SITES` (`searchCatalog.ts`), manteniendo `defaultProfile.allowlist` + `browserProfileService`.
3. **§1.4 — Umbral de inyección:** se concreta el gate `isSelfKnowledgeRequest(text, lang)` y el comportamiento esperado.
4. **§2.2 — `getSearchConfig`:** se corrige el nombre por `resolveSearchProviders`/`buildProviderRequest`; se documenta que no existe `getSearchConfig`.
5. **§2.2 — Filtro `allowed === true`:** se documenta por qué es seguro y el caveat de no enviar `safe=1`.
6. **§2.3.3 — Fallback del servicio Gemini:** se fija la decisión (probar `resolveWebImageArtifact` antes que `buildPollinationsUrl` solo con `primary:'web'|'auto'`).
7. **§1.5 — Test de detección:** el test apunta a `detectSessionVoiceCommand` (pública), no a `collectVoiceCommandPhrases` (privada).
