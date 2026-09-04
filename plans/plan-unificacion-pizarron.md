# Plan: Unificación del Pizarrón en un único espacio con pestañas

> **Solicitud:** "Analiza profundamente, revisa las implicaciones y el procedimiento, dame un plan"
> **Contexto previo:** se confirmó que Análisis de documento, Análisis de app, Generación de documento/video y el workspace de imágenes para la IA **solo son espacios** que comparten un mismo store, se ejecutan de forma mutuamente excluyente en la práctica y "Subir archivo" ya actúa como hub de entrada. Por lo tanto, es viable unificarlos en **un solo espacio** cuyo comportamiento combine todos, incluidas las pestañas de imágenes y videos.
> **Estado:** PROPUESTA — no se ha aplicado ningún cambio de código.

---

## 1. Objetivo

Reemplazar las **7 tarjetas apiladas** del pizarrón (`.frame-content--workspace` en [`src/App.tsx`](src/App.tsx:3501)) por **un único panel con pestañas dinámicas** (`WorkspaceHub`), de modo que:

1. Un mismo espacio concentre: búsqueda (web/imágenes/vídeos), respuesta de FLU, imagen generada por IA, horario, análisis de documento, análisis de app, generación de documento/video y el hub de subida de archivos.
2. Cada pestaña aparezca **solo cuando tiene contenido o actividad relevante** ("dado que no al mismo tiempo se ejecutan todos").
3. Se preserve el **comportamiento completo** de cada espacio (subida → análisis → resultado → descarga, generación con progreso, imagen con regenerar/fallback/expandir, comandos de voz vía FLU_EVENTS).
4. **Sin romper** los invariantes actuales de tests (unitarios y E2E) y sin hardcode (Regla #1).

---

## 2. Análisis profundo del estado actual

### 2.1 Mapa de las tarjetas actuales (App.tsx 3512-3848)

| # | Tarjeta | Componente que renderiza | Condición de visibilidad | Fuente de estado |
|---|---------|--------------------------|--------------------------|------------------|
| 1 | Búsqueda | [`WorkspaceSearch`](src/components/WorkspaceSearch.tsx:57) | siempre | **LOCAL** (`useWorkspaceSearch`) |
| 2 | Respuesta de Flu | texto + `puntos_clave` (3516-3581) | `workspaceArtifact` presente | **STORE** (`workspaceArtifact`) |
| 3 | Imagen generada | imagen + botones Regenerar/Gemini/Limpiar (3584-3640) | `workspaceImage.imageUrl` | **LOCAL** (`useWorkspaceImage`) |
| 3b | Overlay expandido | overlay fuera de tarjetas (3643-3670) | expand | **LOCAL** |
| 4 | Horario | [`HorarioPizarron`](src/components/HorarioPizarron.tsx) (3673-3685) | `workspaceArtifact.tipo === 'horario'` | **STORE** |
| 5 | Análisis de documento | [`DocumentResultPanel`](src/components/DocumentResultPanel.tsx:39) (3688-3707) | `isAnalyzing \|\| error \|\| documentArtifact` | **STORE** (`documentArtifact`) |
| 6 | Análisis de app | [`AppAnalysisPanel`](src/components/AppAnalysisPanel.tsx:19) (3710-3728) | `isAnalyzing \|\| error \|\| appAnalysisArtifact` | **STORE** (`appAnalysisArtifact`) |
| 7 | Generación documento/video | [`GenerationProgressPanel`](src/components/GenerationProgressPanel.tsx:59) (3731-3757) | `!isGenerating && !error && !generationJob && !result && !videoResult` → vacía | **STORE + LOCAL** (job en store; `result`/`videoResult` locales) |
| 8 | Subir archivo | hub 3 botones + 3 inputs ocultos (3760-3847) | siempre (destacada) | **LOCAL** (`uploadedImage`) |

### 2.2 Asimetría de estado (el núcleo del problema)

- **En el store** (`integrationStore`): `workspaceArtifact`, `documentArtifact`, `appAnalysisArtifact`, `generationJob`.
- **Solo local** (se pierden si el hook se desmonta o al recargar): `result`/`videoResult` (generación), todo `useWorkspaceImage`, todo `useWorkspaceSearch`, y `uploadedImage`.

> **Consecuencia:** hoy el `generationJob` (progreso) vive en el store, pero el **resultado** (nombre/URL/Blob) y el **video** son locales. Cualquier pestaña unificada que deba "recordar" qué hay en cada pestaña tiene que conocer ambas fuentes. Para la **Fase 1** esto no es un bloqueo: el `WorkspaceHub` recibe **todo por props** desde `App.tsx` (que ya instancia los 4 hooks + el store), de modo que no hace falta mover estado.

### 2.3 Persistencia: qué sobrevive y qué no

[`integrationStore.ts`](src/store/integrationStore.ts:797) `partialize` persiste **solo** `profile`, `imageConfig`, `voiceConfig`, `advancedConfig` y `config`. Los 4 slots de artefactos **NO se persisten** (ni `workspaceArtifact`). Este comportamiento está **fijado por test**: [`tests/documentGenerationStore.test.ts`](tests/documentGenerationStore.test.ts:74) ("los slices nuevos NO se persisten").

`useSessionPersistence` ([`src/hooks/useSessionPersistence.ts`](src/hooks/useSessionPersistence.ts)) sí persiste `activeTab`, `language`, `sessionRole`, `expandedFrameId`, `selectedMinuteId`, `workspaceImageExpanded`.

> **Implicación:** si en Fase 2 se quisiera persistir pestañas activas o artefactos, hay que **cambiar a propósito** ese test y la `partialize`.

### 2.4 WorkspaceSearch: el patrón de pestañas ya existe

[`WorkspaceSearch`](src/components/WorkspaceSearch.tsx:312) ya implementa pestañas (`Todos / Imágenes / Vídeos`) con disponibilidad **config-driven** (`resolveMergedSearchConfig`) y `activeTab` local. Es el **precedente natural** para el modelo de pestañas del `WorkspaceHub` y además contiene ya las "pestañas de imágenes y videos" que el usuario menciona.

### 2.5 Invariantes que NO pueden romperse (E2E + tests)

De [`tests/e2e/generacion-documentos.spec.ts`](tests/e2e/generacion-documentos.spec.ts:25):

- Selector del input de documento: `input[type="file"][accept*=".txt"]` (debe conservar el atributo `accept`).
- Selectores de panel: `.document-analysis__title`, `.document-analysis__meta-item`, `.homework-analysis__detail`, `.generation-panel__state--listo`, `.generation-panel__result`, `.generation-panel__result-name`, botón `Descargar`.
- Evento de comando: `window.dispatchEvent(new CustomEvent('flu:generate-document'))` → **los nombres de CustomEvent de FLU_EVENTS deben seguir disparándose igual**.

De [`tests/documentGenerationStore.test.ts`](tests/documentGenerationStore.test.ts:52): estado inicial `null`, `reset()` limpia los slices a `null`, y (por ahora) no persistencia. En **Fase 1 no se toca**.

De [`tests/e2e/horario-pizarron.spec.ts`](tests/e2e/horario-pizarron.spec.ts) y pruebas de búsqueda: los `data-testid` y clases internas de `WorkspaceSearch` (`.workspace-search`) y `HorarioPizarron` deben seguir existiendo.

---

## 3. Diseño de la unificación

### 3.1 Componente nuevo: `WorkspaceHub`

Componente **presentacional + lógica de pestaña local** que recibe todo por props (no hace fetching). Reemplaza el bloque de 7 tarjetas (líneas 3512-3848) y el overlay de imagen (3643-3670). Estructura:

```
<WorkspaceHub
  searchConfig={...}            // allowlist/overrides
  workspaceArtifact={...}       // store
  document={{ state: documentAnalysis }}
  app={{ state: appAnalysis }}
  generation={{ state: documentGeneration }}   // job + result + videoResult
  image={{ state: workspaceImage }}
  upload={{
    uploadedImage, hasImage, onImageUpload, onClearImage,
    onAnalyzeDocument, onAnalyzeApp,              // abren los inputs
    onFileDrop, handlers de inputs, refs          // refs viven en App.tsx
  }}
/>
```

`App.tsx` conserva la **orquestación** (refs, `processAnyFile`, `handleProjectFolderSelected`, `processImageFile`, efecto FLU_EVENTS) tal como hoy; el hub solo las consume.

### 3.2 Modelo de pestañas dinámicas

| Pestaña | Contenido | Disponible cuando |
|---------|-----------|-------------------|
| `buscar` | [`WorkspaceSearch`](src/components/WorkspaceSearch.tsx:57) (con sus sub-pestañas Imágenes/Vídeos) | siempre |
| `respuesta` | texto + `puntos_clave` (respuesta de FLU) | `workspaceArtifact` |
| `imagen` | imagen IA + botones Regenerar / Usar Gemini / Limpiar + overlay | `workspaceImage.imageUrl` o generando/failed |
| `horario` | [`HorarioPizarron`](src/components/HorarioPizarron.tsx) | `workspaceArtifact.tipo === 'horario'` |
| `documento` | [`DocumentResultPanel`](src/components/DocumentResultPanel.tsx:39) | `isAnalyzing \|\| error \|\| documentArtifact` |
| `app` | [`AppAnalysisPanel`](src/components/AppAnalysisPanel.tsx:19) | `isAnalyzing \|\| error \|\| appAnalysisArtifact` |
| `generacion` | [`GenerationProgressPanel`](src/components/GenerationProgressPanel.tsx:59) | `isGenerating \|\| error \|\| generationJob \|\| result \|\| videoResult` (misma condición que hoy, invertida) |
| `archivos` | hub de subida (3 botones + drag&drop + preview) | siempre (pestaña de aterrizaje) |

- **La barra de pestañas es dinámica**: solo se muestran las pestañas "disponibles" + siempre `buscar` y `archivos`. Esto reproduce la semántica de `FluCollapsibleCard` (`empty` → colapsada) de forma más compacta: nada de tarjetas vacías apiladas.
- **"Pestañas de imágenes y videos"**: (a) `buscar` ya trae las sub-pestañas Imágenes/Vídeos; (b) `imagen` es la imagen generada por IA; (c) el video generado (F4) se muestra en `generacion` (dentro de `GenerationProgressPanel`, que ya combina documento + video). Opcionalmente en Fase 2 se puede dividir un tab `video` dedicado (ver §4.4).

### 3.3 Pestaña activa y auto-switch

- `activeTab` **local** en el hub, inicializado a la primera pestaña disponible (`archivos` si no hay nada, si no la de mayor prioridad).
- **Auto-switch por efecto** (paridad de comportamiento con "la tarjeta aparece/colapsa al llegar el resultado"): un `useEffect` observa transiciones `null → contenido` o `isGenerating false → true` y, **si el usuario no está interactuando con otra pestaña**, cambia a la pestaña del resultado:
  - `documentArtifact` null→objeto → `documento`
  - `appAnalysisArtifact` null→objeto → `app`
  - `isGenerating` false→true → `generacion` (muestra progreso de inmediato)
  - `imageUrl` null→url → `imagen`
- **Respeto a la elección explícita**: si el usuario tocó manualmente una pestaña, el auto-switch se suprime durante un umbral corto (marca de tiempo de `lastManualTabChange`) para no "pelear" con la navegación.
- **Persistencia de la pestaña activa**: se agrega `activeWorkspaceTab` a `useSessionPersistence` (bajo riesgo; no toca el store ni su test).

### 3.4 Mapa de comportamiento: tarjeta → pestaña

| Acción actual | Resultado hoy | Resultado unificado |
|---------------|---------------|---------------------|
| Subir imagen desde `Subir archivo` | se muestra card `Imagen generada` | hub → tab `imagen` (auto-switch) |
| `Analizar documento` | card `Análisis de documento` expandida | hub → tab `documento` al terminar |
| `Analizar app` | card `Análisis de app` expandida | hub → tab `app` al terminar |
| Voz "genera documento/video" | card `Generación` con progreso | hub → tab `generacion` (progreso en vivo) |
| Búsqueda web | card `Búsqueda` | tab `buscar` (idéntico) |
| Voz con horario | card `Horario` | tab `horario` |

### 3.5 Flujo de datos

Sin cambios de estado: los 4 hooks y el store siguen viviendo en `App.tsx`; el hub es un **árbol de composición**. Esto mantiene el contrato público de los hooks y de los paneles intactos (todos son `default export` presentacionales reutilizables), lo que hace la Fase 1 de bajo riesgo.

---

## 4. Implicaciones

### 4.1 Comandos de voz / FLU_EVENTS (fuente única de verdad)

El efecto actual [`src/App.tsx`](src/App.tsx:2899) debe **permanecer tal cual** (nombres de CustomEvent `flu:generate-document`, `flu:generate-video`, `flu:analyze-document`, `flu:analyze-app`). Los `refs` de los inputs ocultos (`docInputRef`, `projectInputRef`, `fileInputRef`) deben seguir existiendo en `App.tsx` y conservar sus atributos (`accept` incluido `.txt`). El auto-switch del hub cubre el salto a la pestaña correcta tras el comando.

### 4.2 Enrutamiento de archivos

`processAnyFile` (imagen → `processImageFile`, documento → `analyzeFile`) y `handleProjectFolderSelected` (`MAX_READ=200`, `MAX_FILE_BYTES=200*1024`) **se quedan en App.tsx**. El tab `archivos` solo los invoca; el drag&drop y los 3 botones se mantienen con los mismos `accept`.

### 4.3 Renderizadores reutilizables

`DocumentResultPanel`, `AppAnalysisPanel`, `GenerationProgressPanel` y `WorkspaceSearch` se reutilizan **sin modificación** (son presentacionales). El hub solo los monta/desmonta por pestaña. Las clases CSS internas (`.document-analysis__*`, `.generation-panel__*`, `.homework-analysis__*`, `.workspace-search*`) se conservan → E2E intacto.

### 4.4 Progreso vs resultado

`GenerationProgressPanel` ya maneja ambos: `job` (estado+progreso) y `result`/`videoResult`. La disponibilidad de la pestaña `generacion` replica la condición actual invertida. Si se quisiera un tab `video` dedicado, habría que **dividir** la sección de video de `GenerationProgressPanel` (nuevo componente `VideoResultView`) — se propone como mejora de Fase 2, no bloqueante.

### 4.5 Persistencia de sesión

Agregar `activeWorkspaceTab` a [`useSessionPersistence`](src/hooks/useSessionPersistence.ts). **No** se agrega `workspaceArtifact` a la `partialize` del store en Fase 1 (evita tocar su test). Opcional en Fase 2 (decisión de producto: ¿los artefactos deben sobrevivir al recargar?).

### 4.6 CSS

Nuevas clases de la barra de pestañas del hub (`.workspace-hub__tabs`, `.workspace-hub__tab`, `.workspace-hub__tab--active`, badge de actividad) en [`src/App.css`](src/App.css). Las clases `.flu-card` no se eliminan (se siguen usando en settings). El layout `.frame-content--workspace` pasa de pila de tarjetas a un solo panel, ganando espacio vertical (refuerza el feedback previo de "desperdicias demasiado espacio").

### 4.7 Tests afectados

- **NO se rompen (Fase 1):** `documentGenerationStore.test.ts`, `generacion-documentos.spec.ts`, `horario-pizarron.spec.ts`, pruebas de búsqueda — porque no cambia ni el store, ni los paneles, ni los selectores, ni los eventos.
- **Nuevos:** `tests/workspaceHub.test.ts` (lógica de disponibilidad de pestañas + auto-switch, componentes montados con `react-test-renderer`/Testing Library y estados simulados) y opcional `tests/e2e/verify-pizarron-unificado.spec.ts` (selección de pestañas, que las pestañas vacías no existan, auto-switch tras análisis).

### 4.8 Riesgo sobre las 2 áreas de IA (texto e imágenes) — análisis específico

Las dos áreas que el usuario protege son:

1. **Área de TEXTO IA** → pestaña `respuesta` (y su fuente original): `workspaceArtifact`, escrito por `setWorkspaceArtifact` en [`App.tsx`](src/App.tsx:1890) desde el contrato de Gemini (`onContractResolved`). Es estado **del store**.
2. **Área de IMAGEN IA** → pestaña `imagen`: `workspaceImage` (`useWorkspaceImage`), estado **local** que llama a `aiService.generateWorkspaceImage` con timeout 30s, `retry()`, `fallbackToGemini()` y overlay de expandir.

**Acoplamiento real (y por qué no se toca):** el contrato de texto es el **disparador** de la imagen: [`App.tsx`](src/App.tsx:1923) ejecuta `workspaceImage.generateFromContract(promptVisual, tipo)` solo si `workspace.prompt_visual` tiene ≥5 caracteres, y el `alt` de la imagen lee `workspaceArtifact?.prompt_visual` ([`App.tsx`](src/App.tsx:3604)). Este flujo (líneas 1889-1958) **permanece intacto** en Fase 1: ni el hook, ni `aiService`, ni el store, ni el contrato se modifican; el hub solo **renderiza** el resultado.

**Conclusión de riesgo en Fase 1:** **bajo / casi nulo sobre la lógica de IA.** No se altera ninguna llamada (`analyzeDocument`, `analyzeApp`, `generateDocument`, `assembleVideo`, `generateWorkspaceImage`, `/api/gemini/contract`), ni timeouts, ni fallbacks, ni persistencia. Los riesgos que sí existen son **presentacionales/UX**, no de IA:

| Riesgo (área de IA) | Descripción | Mitigación |
|---------------------|-------------|------------|
| Overlay de expandir imagen | `position: fixed` debe mantener su posicionamiento; si se anida dentro del panel del hub con `overflow`/`transform`, puede recortarse | Renderizar el overlay como hijo directo del shell (o portal), igual que hoy (sibling fuera de las tarjetas) |
| Indicador de "generando" en la pestaña `imagen` | La generación es asíncrona (hasta 30s); si el usuario sale de la pestaña, debe ver un badge de actividad | El tab `imagen` muestra estado `isLoading`/`isFailed` aunque no esté activo |
| Independencia de "Limpiar" | No acoplar los clears: limpiar `respuesta` no debe borrar la imagen ni viceversa (hoy son botones separados) | Cada pestaña conserva su propio `clear()` (del hook o del store) |
| Auto-switch | Cambiar solo a la pestaña del resultado sin "pelear" con la navegación | `lastManualTabChange` (§3.3) |
| `workspaceImageExpanded` | La sesión persiste el estado expandido; el hub debe restaurarlo | Leer `useSessionPersistence` al montar el overlay |

**Riesgo genuino (solo Fase 2):** si se decide persistir artefactos, la imagen usa `blob:`/`data:` URLs que pueden ser grandes y **no deben guardarse tal cual en `localStorage`** (hinchazón/cuota). La Fase 2 debe persistir solo metadatos (prompt, tipo, timestamp) o usar IndexedDB; nunca la URL en `partialize`. En Fase 1 no existe este riesgo (no se persiste estado de imagen).

---

## 5. Procedimiento por fases

### Fase 1 — Unificación UI (recomendada; satisface la solicitud)

1. Crear `src/components/WorkspaceHub.tsx`:
   - Prop `state` (los 4 hooks + store + upload handlers) y `activeTab` local.
   - `useMemo` de `tabsDisponibles` (reglas de la tabla §3.2).
   - `useEffect` de auto-switch (§3.3) con `lastManualTabChange`.
   - Render: barra de pestañas + contenido activo + overlay de imagen.
2. En `src/App.tsx`, reemplazar líneas 3512-3848 (7 tarjetas + overlay) por `<WorkspaceHub .../>`. **No tocar** el efecto FLU_EVENTS, refs, ni `processAnyFile`.
3. Agregar `activeWorkspaceTab` a `useSessionPersistence` y la lógica de restauración inicial en el hub.
4. CSS de la barra de pestañas en `src/App.css`.
5. Tests: `tests/workspaceHub.test.ts`.

**Validación Fase 1 (por CLAUDE.md — sin correr la suite completa):**
- `npx tsc --noEmit`
- `npx vitest run tests/workspaceHub.test.ts tests/documentGenerationStore.test.ts` (objetivo)
- E2E dirigido: `npx playwright test tests/e2e/generacion-documentos.spec.ts` (F1→F3, verifica selectores/inputs/eventos intactos) y `tests/e2e/horario-pizarron.spec.ts`.
- **Regla 0.1 (verificación visual programática):** el modelo actual no puede ver imágenes; usar un spec E2E que capture y audite la geometría del pizarrón (pestañas visibles, ninguna tarjeta vacía apilada, el tab activo muestra su contenido) — estilo [`os3-visual-audit.spec.ts`](tests/e2e/os3-visual-audit.spec.ts).

### Fase 2 — Estado unificado + persistencia (opcional, decisión de producto)

1. Definir un modelo único (p. ej. `workspaceTabs: WorkspaceTabItem[]` o solo `activeWorkspaceTab` + mover `result`/`videoResult`/`image` al store).
2. Decidir y aplicar persistencia en `partialize` si los artefactos deben sobrevivir al recargar → **actualizar a propósito** `tests/documentGenerationStore.test.ts`.
3. (Opcional) dividir el tab `video` dedicado con `VideoResultView`.
4. Revalidar: tsc + vitest objetivo (incluido el test actualizado) + E2E.

---

## 6. Archivos a crear / modificar / no tocar

| Tipo | Archivo | Detalle |
|------|---------|---------|
| Crear | [`src/components/WorkspaceHub.tsx`](src/components/WorkspaceHub.tsx) | panel unificado con pestañas |
| Crear | `tests/workspaceHub.test.ts` | disponibilidad + auto-switch |
| Crear (opcional) | `tests/e2e/verify-pizarron-unificado.spec.ts` | validación visual/geometría (regla 0.1) |
| Modificar | [`src/App.tsx`](src/App.tsx) | reemplazar 7 tarjetas por `<WorkspaceHub/>` (líneas 3512-3848) |
| Modificar | [`src/hooks/useSessionPersistence.ts`](src/hooks/useSessionPersistence.ts) | agregar `activeWorkspaceTab` |
| Modificar | [`src/App.css`](src/App.css) | estilos de la barra de pestañas del hub |
| No tocar (Fase 1) | [`src/store/integrationStore.ts`](src/store/integrationStore.ts) | sin cambios |
| No tocar (Fase 1) | `useDocumentAnalysis`, `useAppAnalysis`, `useDocumentGeneration`, `useWorkspaceImage`, `useWorkspaceSearch` | API pública estable |
| No tocar (Fase 1) | `DocumentResultPanel`, `AppAnalysisPanel`, `GenerationProgressPanel`, `WorkspaceSearch`, `HorarioPizarron` | presentacionales reutilizables |
| No tocar (Fase 1) | `tests/documentGenerationStore.test.ts`, `tests/e2e/generacion-documentos.spec.ts` | deben seguir pasando sin cambios |

---

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Romper selectores E2E (`.document-analysis__*`, `.generation-panel__*`, `accept*=".txt"`, `flu:generate-document`) | Reutilizar los paneles sin cambios; correr `generacion-documentos.spec.ts` en la validación de Fase 1 |
| Auto-switch que pelee con la navegación del usuario | `lastManualTabChange` suprime el auto-switch temporalmente; solo auto-switch a tareas largas (generación) |
| Estado local se pierde si el hook se desmonta | El hub no desmonta los hooks (viven en `App.tsx`); el hub solo monta/desmonta vistas, no hooks |
| Pestaña activa se pierde al recargar | `useSessionPersistence` con `activeWorkspaceTab` |
| Scope creep hacia persistencia de artefactos | Fase 2 separada y opcional; no se toca el test del store en Fase 1 |

---

## 8. Qué NO necesita cambiar

- La **API de los 4 hooks** de análisis/generación/imagen/búsqueda.
- Los **3 paneles presentacionales** ni `WorkspaceSearch` ni `HorarioPizarron`.
- El **store** (Fase 1) ni su `partialize`.
- El **efecto FLU_EVENTS** (comandos de voz → eventos) ni los `refs` de inputs.
- La **regla de no hardcode**: todos los labels del hub salen de `FLU_CONFIG` con `||` fallback, igual que los componentes actuales.

---

## 9. Decisión abierta para el usuario

1. **¿Fase 1 solamente**, o también **Fase 2** (persistencia de artefactos + posible tab `video` dedicado)?
2. **Pestaña de aterrizaje por defecto:** `archivos` (hub) o `buscar` cuando no hay nada activo.
3. **Auto-switch:** ¿cambiar a la pestaña de resultado automáticamente (recomendado) o solo marcar un badge/indicador de actividad?

Con la confirmación de estos tres puntos, se procede a implementar la Fase 1 con su validación (tsc + vitest objetivo + E2E + verificación visual programática).
