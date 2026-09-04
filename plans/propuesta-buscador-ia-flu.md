# Propuesta: Buscador + IA + Resultados + Imágenes + Vídeo (tipo Google) en el Pizarrón

> Objetivo: convertir el Pizarrón (workspace) en una experiencia tipo Google **curada y offline-first**:
> buscador + respuesta IA (AI Overview) + resultados web + imágenes + vídeo + idioma,
> con un **Centro de Control** para gestionar todo desde la app (sin código nuevo por sitio/proveedor).
> Reglas respetadas: sin nuevas pantallas/rutas, sin hardcode (todo FLU_CONFIG con `|| '...'`),
> config-driven, audit log, DI, curación (allowlist) y modo supervisado.

---

## 1. Visión y UX (qué ve el usuario)

### 1.1 El Pizarrón (workspace) — pestaña existente
```
┌──────────────────────────────────────────────────────────────┐
│ [🔍 Buscá algo...]            [Idioma: es ▾]  [Nivel: simple ▾] │  ← SearchBar
├──────────────────────────────────────────────────────────────┤
│  💬 IA (AI Overview)                                          │
│  "La fotosíntesis es el proceso por el cual las plantas...    │
│   ✦ Puntos clave: ...  [🗣️ Leer]  [🔊 Escuchar]"              │  ← AIOverview
├──────────────────────────────────────────────────────────────┤
│  [Todos] [Imágenes] [Vídeos]  [Filtro: solo sitios curados ✓] │  ← ResultTabs
│  ▸ Resultado 1  — es.wikipedia.org  (permitido)  [Abrir]      │
│  ▸ Resultado 2  — educ.ar            (permitido)  [Abrir]      │
│  ▸ Resultado 3  — example.com        (NO permitido 🔒)        │  ← ResultList
├──────────────────────────────────────────────────────────────┤
│  🖼️ Imágenes (grid)          🎬 Vídeos (thumbnails)            │
└──────────────────────────────────────────────────────────────┘
```
- Entrada **por voz** ("buscá la fotosíntesis para niños") o **por teclado** en la barra.
- El resultado de IA aparece primero (como el AI Overview de Google); los resultados debajo.
- Tabs de tipo de contenido: **Todos / Imágenes / Vídeos**.
- Cada resultado se marca como *permitido* (host en allowlist) o *no permitido* (bloqueado/oculto según modo).
- Click en un resultado permitido → se abre en el navegador curado (iframe o modo lectura existente).

### 1.2 El Centro de Control (área de gestión) — grupo "Gestión" de Ajustes
Nuevo panel **"Buscador y catálogo"** en `SETTINGS_GROUPS` `management` ([`App.tsx`](src/App.tsx:239)), con secciones:

| Sección | Qué gestiona | Backing |
|---|---|---|
| **Proveedores** | Web / Imágenes / Vídeo: on/off, endpoint, API key (opcional), máx. resultados, timeout | config `browser.search` |
| **Catálogo de sitios** | CRUD de dominios curados por categoría (agrega/edita/elimina; expande allowlist y tiles) | DB `searchSites` + derivación |
| **Categorías** | Alta de categorías y asignación de sitios | catálogo |
| **Idiomas** | Idioma por defecto por rol + mapeo de subdominios por idioma | config |
| **Nivel de lectura** | simple / detallado / avanzado por rol | config |
| **Seguridad** | safeSearch, modo supervisado, límite diario | config existente |
| **Vista previa** | Probar una consulta y ver resultados/IA sin tocar producción | dev tool |

---

## 2. Arquitectura (capas, archivos nuevos, sin tocar rutas/pantallas)

```
┌─ UI (componentes nuevos, dentro del workspace y de Ajustes) ─┐
│  SearchBar / AIOverview / ResultTabs / ResultList            │
│  ImageGrid / VideoGrid / SearchControlCenter                 │
├─ Hooks (orquestación) ───────────────────────────────────────┤
│  useWorkspaceSearch (voz/teclado → paralelo IA + proveedores)│
├─ Núcleo puro (testeable, sin DOM) ───────────────────────────┤
│  src/core/search/searchSession.ts                            │
│    - resolveSearchProviders(config)                          │
│    - buildProviderRequest(provider, query, lang)             │
│    - normalizeResults(raw, provider)                         │
│    - filterByAllowlist(results, allowlist)                   │
│    - resolveSearchLanguage(query, phrase, profileLang)       │
│  src/core/search/searchCatalog.ts                            │
│    - CRUD sobre tabla Dexie searchSites (catálogo curado)    │
│    - deriveAllowlist(categories, catalog)                    │
│    - deriveTiles(categories, catalog)                        │
├─ Servidor (proxy server-side, mismo patrón que browserProxy)─┤
│  src/server/searchProxy.ts                                   │
│    - GET /api/search/web?q=&lang=&allowlist=…               │
│    - GET /api/search/images?q=&lang=…                       │
│    - GET /api/search/video?q=&lang=…                        │
│    - valida, fetchea con timeout, normaliza, devuelve JSON  │
├─ Config (fuente única, sin hardcode) ────────────────────────┤
│  FLU_CONFIG.browser.search.providers / languageHosts / …     │
└──────────────────────────────────────────────────────────────┘
```

**Por qué esta división:** el núcleo puro es 100% testeable (vitest, sin mocks de red); el proxy server-side evita CORS y esconde claves (nunca llegan al cliente); los hooks conectan voz/IA/workspace; la config y la tabla `searchSites` permiten expandir sin tocar código.

---

## 3. Proveedores concretos (web / imágenes / vídeo)

Política: **keyless primero, key opcional vía config/env**, todo configurable y con fallback offline.

### 3.1 Web (texto)
| Proveedor | Endpoint | Key | Notas |
|---|---|---|---|
| **Wikipedia API** | `https://{lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch={q}&format=json` | no | Resultados con extracto, confiable, sin límite agresivo |
| **DuckDuckGo IA** | `https://api.duckduckgo.com/?q={q}&format=json&no_html=1&kl={lang}` | no | Abstract + RelatedTopics, buen "knowledge panel" |
| *(opcional)* Brave Search | `https://api.search.brave.com/res/v1/web/search` | sí | Mejor cobertura web; key en config/env |

### 3.2 Imágenes
| Proveedor | Endpoint | Key | Notas |
|---|---|---|---|
| **Wikimedia Commons API** | `https://commons.wikimedia.org/w/api.php?action=query&generator=search&…` | no | Imágenes CC, educativo, keyless |
| **Openverse API** | `https://api.openverse.org/v1/images/?q={q}` | opcional | Licencias abiertas, requiere registro (gratis) |
| *(opcional)* Pixabay | `https://pixabay.com/api/?key=…&q={q}` | sí | Gran calidad, key gratis |

### 3.3 Vídeo
| Proveedor | Endpoint | Key | Notas |
|---|---|---|---|
| **YouTube Data v3** | `https://www.googleapis.com/youtube/v3/search?q={q}&type=video&part=snippet` | sí (free tier) | Estándar, thumbnail + embed; key en config/env |
| **Wikipedia/Wikimedia vídeo** | vía API de Commons | no | Contenido educativo keyless, menos cobertura |
| *(alternativa)* Instancia Invidious propia | `{INSTANCE}/api/v1/search?q={q}` | no | Autohospedada; se configura endpoint |

> **Decisión honesta:** el vídeo de calidad realista pasa por **YouTube Data API con key** (configurable).
> Sin key, FLU ofrece vídeo educativo de Commons y tiles curados de YouTube. El Centro de Control
> deja el proveedor apagado/encendido y el usuario pega su key ahí (nunca en código).

### 3.4 Config (diseño, en `FLU_CONFIG.browser.search`)
```js
search: {
  providers: {
    web: [
      { id: 'wikipedia', enabled: true,  endpoint: 'https://{lang}.wikipedia.org/w/api.php', key: null, maxResults: 5, timeoutMs: 8000 },
      { id: 'duckduckgo', enabled: true,  endpoint: 'https://api.duckduckgo.com/',            key: null, maxResults: 5, timeoutMs: 8000 },
    ],
    images: [
      { id: 'commons',   enabled: true,  endpoint: 'https://commons.wikimedia.org/w/api.php', key: null, maxResults: 12, timeoutMs: 8000 },
    ],
    video: [
      { id: 'youtube',   enabled: false, endpoint: 'https://www.googleapis.com/youtube/v3/search', key: '', maxResults: 6, timeoutMs: 8000 },
      { id: 'invidious', enabled: false, endpoint: '', key: null, maxResults: 6, timeoutMs: 8000 },
    ],
  },
  maxResultsByType: { web: 8, images: 24, video: 8 },
  aiOverview: { enabled: true, maxChars: 700 },
  offlineFallback: 'respuesta_ia_sin_resultados',
}
```
- `key` se resuelve con prioridad **env → localStorage → config**, nunca en el bundle de producción.
- El proxy server-side inyecta la key; el cliente nunca la ve.

---

## 4. Idioma (flujo completo)

1. **Detección de idioma de la petición** (voz): función pura `extractLanguageFromPhrase(transcript, languageWords)`
   — "en inglés / in english / en español / en castellano" → `en`/`es` (mismo patrón que `siteStopwords`).
2. **Idioma del perfil** como default: `browser.defaultProfile.language` / `defaultsByRole.*.language` (ya existe en [`fluConfig.js`](src/voice/lib/fluConfig.js:743)).
3. **Propagación a los proveedores**: cada `buildProviderRequest` inyecta el idioma:
   - Wikipedia → subdominio `{lang}.wikipedia.org`.
   - DuckDuckGo → parámetro `kl`.
   - Proxy → cabecera `Accept-Language` en [`fetchSite`](src/server/browserProxy.ts:45) (mismo patrón en searchProxy).
   - Sitios directos (navegación) → `browser.languageHosts` para reescribir subdominios no estándar.
4. **IA en el mismo idioma**: `aiOverview` recibe `lang` y el LLM responde en ese idioma.
5. **UI en el idioma**: los labels del buscador se resuelven de `FLU_CONFIG` por idioma (patrón existente).

---

## 5. Curación y seguridad (se mantiene el "curado")

- **Filtro de allowlist en cada resultado**: `filterByAllowlist(results, allowlist)` usa [`isDomainAllowed()`](src/core/browser/browserSession.ts:31) (exacto o subdominio). Resultado no permitido → se oculta o se muestra `🔒 no permitido`.
- **safeSearch / supervised**: se respetan los flags existentes ([`fluConfig.js`](src/voice/lib/fluConfig.js:758)); en modo supervisado el historial de búsquedas va al audit log.
- **Límite diario**: se reutiliza el límite existente ([`browserSession.ts`](src/core/browser/browserSession.ts:131)).
- **Offline-first**: sin red → solo respuesta IA + aviso "sin resultados" (mismo manejo que `fetchErrorTitle`).
- **Audit log**: cada búsqueda registra `{tipo:'search', query, lang, proveedores, resultados, permitidos}`.

---

## 6. Expansión del catálogo (responde "estamos muy limitados")

Hoy la allowlist es 2–3 dominios y los tiles están hardcodeados ([`fluConfig.js`](src/voice/lib/fluConfig.js:834)).
Con el catálogo:
- `searchCatalog.ts` (tabla Dexie `searchSites`) guarda `{ id, dominio, categorias[], idiomas[], nivel, aprobado }`.
- `deriveAllowlist(categorias, catalogo)` y `deriveTiles(...)` reemplazan la lista fija: **agregar un sitio al catálogo = aparece en voz, barra, tiles y resultados** sin tocar código.
- El Centro de Control hace el CRUD con validación (formato de dominio, no duplicados, auditoría de quién/cuándo).

---

## 7. Gestión: el área para "gestionar todo eso"

Panel **"Buscador y catálogo"** (grupo Gestión), componentes y flujo:

1. **Proveedores**: checkboxes on/off, campo de key (guardado cifrado en localStorage), máx. resultados, timeout. Se persisten como overrides sobre la config (patrón `handleParticipantConfigChange` / profile service).
2. **Catálogo de sitios**: tabla CRUD (agregar dominio, asignar categorías, marcar aprobado). Persiste en `searchSites`.
3. **Categorías**: crear categorías y reasignar sitios; los `homeTiles` se derivan solos.
4. **Idiomas y nivel**: selects por rol (defaults de config) + tabla `languageHosts` editable.
5. **Seguridad**: safeSearch / supervisado / límite diario (ya existen; se exponen aquí).
6. **Vista previa (dev)**: ejecutar una consulta de prueba y ver JSON/UI de resultados e IA antes de confirmar config.

Todo con labels desde `FLU_CONFIG.browser.ui.*` (sin hardcode) y persistencia con los servicios existentes.

---

## 8. Plan por fases (entregables + tests)

### Fase 1 — Idioma (pequeño, alto impacto)
- `extractLanguageFromPhrase` + tests.
- `Accept-Language` + `lang` en proxy + `languageHosts` en config.
- Tests: `tests/searchLanguage.test.ts`, ampliar `tests/browserSession.test.ts`.

### Fase 2 — Catálogo y expansión
- `searchCatalog.ts` (CRUD Dexie) + `deriveAllowlist/deriveTiles`.
- Reemplazar tiles hardcodeados por derivados del catálogo.
- Panel CRUD "Catálogo de sitios" en Gestión.
- Tests: `tests/searchCatalog.test.ts` + actualizar `tests/browserProfileService.test.ts`.

### Fase 3 — Buscador web + IA (núcleo Google)
- `searchSession.ts` puro + `searchProxy.ts` (Wikipedia + DuckDuckGo).
- `useWorkspaceSearch` (paralelo IA + proveedores) + `AIOverview` + `ResultList` en el workspace.
- Intento de voz `BUSCAR` en `useNavigationCommands` (reusa la cadena de `NAVEGAR`).
- Tests: `tests/searchSession.test.ts`, `tests/searchProxy.test.ts` (con fetch mock).

### Fase 4 — Imágenes + vídeo
- `ImageGrid` (Commons/Openverse) + `VideoGrid` (YouTube/Invidious con key).
- Tabs "Todos/Imágenes/Vídeos" y filtro de allowlist por tipo.
- Tests: normalización de resultados por proveedor.

### Fase 5 — Centro de Control completo + vista previa
- Integrar todas las secciones en el panel "Buscador y catálogo" + persistencia + audit log.

---

## 9. Riesgos y límites honestos (no dummies)

- **Vídeo de calidad → requiere key de YouTube** (free tier). Sin key: vídeo educativo de Commons + tiles curados.
- **Rate limits**: Wikipedia/DDG/Commons aguantan uso ligero; mitigación con timeout + máx. resultados.
- **CORS/embeds**: algunos sitios bloquean iframes; el modo lectura curada (proxy) ya lo resuelve; la búsqueda nunca depende del iframe.
- **Ofuscación de claves**: no hay cifrado perfecto en el cliente; las claves viven en el servidor (env) cuando se pueda, nunca en el bundle.
- **Offline**: la búsqueda es server-side; sin red cae a IA pura (que es local/remota según backend configurado).
- **Nada de esto abre la allowlist**: el filtro curado es la frontera; el Centro de Control lo administra con auditoría.

---

## 10. Conclusión

Es viable con la arquitectura actual y en fases:
1. **Idioma** (F1) — días, sin riesgo.
2. **Catálogo/expansión** (F2) — días, elimina la limitación de 3 sitios.
3. **Buscador + IA** (F3) — la pieza "Google" central.
4. **Imágenes + vídeo** (F4) — con key opcional.
5. **Centro de Control** (F5) — el área que gestiona todo lo anterior.

Cada fase entrega algo usable por sí sola, con tests unitarios del núcleo puro y sin romper el resto.
