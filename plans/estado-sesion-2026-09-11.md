# Estado de sesión — 2026-09-11

> Documento de continuidad. Resume objetivo, trabajo aplicado, evidencia,
> pendientes y próximos pasos de la sesión. No declara "producto terminado":
> el DoD-producto lo cierra el usuario en pantalla.

## 1. Contexto

- **Proyecto**: FLU OS4 (`D:\D-Proyectos\D-3-FLU-OS4`).
- **Stack**: React 18 + TS estricto + Vite + PWA; backend Python en `http://127.0.0.1:8000`; front en `http://localhost:5173` (Vite, bindea `::1`).
- **Rama**: `feature-fase-conversacional-acciones` (según sesión previa).
- **Reglas vigentes**: `AGENTS.md` §4/§8/§9/§10 (fuente única, guard que nace rojo, evidencia con conteo, sin rutas dobles, sin basura).
- **Portal**: proceso `npm run dev` gestionado como background process (`bgp_0910f25bb001m5mFLRwELArt5O`).

## 2. Objetivo de la sesión

1. Buscador web real: **Tavily → OpenRouter → Wikipedia**, sin depender solo de Wikipedia.
2. Configuración de esas APIs **en el configurador** (no en `.env`).
3. Un único **Guardar/Restablecer global** al pie de Configuración.
4. Corregir defectos reportados en uso: hablante duplicado, imágenes en "Todo", falta de X en "Próxima", key de OR que "no se guarda".

## 3. Trabajo aplicado (código)

### 3.1 Cadena de búsqueda web (Tavily → OpenRouter → Wikipedia)

- `src/core/search/searchSession.ts`: `SearchProviderConfig` con `method`/`headers`/`body`/`model`/`priority`/`externalConfig`; `ProviderRequest` con `method`/`headers`/`body`; `buildProviderRequest` arma POST y reemplaza tokens `{q}/{lang}/{key}/{model}/{n}` (también en el body, recursivo); normalizadores `normalizeTavily` (`results[]`) y `normalizeOpenRouter` (`choices[0].message.annotations[].url_citation`).
- `src/server/searchProxy.ts`: `fetchProviderJson` soporta POST + headers/body; la búsqueda `web` agrupa por `priority` (mismo escalón en paralelo y fusión; si un escalón no trae resultados, pasa al siguiente).
- `src/voice/lib/fluConfig.js`: `providers.web = [tavily(1), openrouter(2), wikipedia(3)]`; se retiró DuckDuckGo.
- Modelo OR por defecto: `google/gemini-2.5-flash-lite:online` (los slugs `:free:online` de esos modelos dan **404** en OpenRouter).

### 3.2 Configuración en el configurador + Guardar/Restablecer global

- `src/components/FluSettingsPanel.tsx`: sección **🔎 Búsqueda web** (clave Tavily, clave OR, modelo OR) en *Servicios Externos*.
- `src/components/SettingsSaveContext.tsx` (nuevo): registro de commits/resets; barra **Guardar configuración / Restablecer** al pie de Configuración.
- `src/components/FluSettingsTabView.tsx`: monta el provider y la barra global.
- `src/components/SearchControlCenter.tsx` y `src/voice/components/FluParticipantSettingsPanel.jsx`: se quitaron sus botones locales; se registran al commit global.
- `src/core/search/searchConfigOverrides.ts`: `applyProviderOverrides` (fusión campo a campo, **no borra** la key/model que administra "Búsqueda web"; los proveedores `externalConfig` conservan su `key`/`model`); `parsePositiveInt` exportado.
- `src/App.tsx`: `handleSearchConfigChange` acepta updater `(prev) => next` y usa `searchOverridesRef` para componer varios commits en el mismo tick.

### 3.3 Defectos reportados

- **Hablante duplicado**: `src/voice/lib/rawCommitPlan.js` (nuevo) + `src/App.tsx`. La fila del turno se localiza por el **id de la emisión cruda** (`lastRawEntryIdRef`), no por etiqueta de hablante; así "Hablante 1" (provisional) muta a "Luis" (resuelto) en una sola fila.
- **Imágenes en "Todo"**: `src/components/WorkspaceHub.tsx`, la cuadrícula de imágenes ahora es `onlyInKind: true` (solo bajo "Imágenes").
- **Falta X en "Próxima"**: `src/components/HoyPanel.tsx`, se agregó el botón de borrado a la tarjeta "Próxima" (`hoy-proxima-remove-<id>`).
- **Caché del cliente / shell viejo**: `public/sw.js` v2 con estáticos **network-first** (antes cache-first con `CACHE_NAME` fijo) + borra cachés viejas; `src/main.tsx` registra el SW, fuerza `update()` y **recarga** al `controllerchange`.
- **"Limpiar caché" borraba la key**: `src/hooks/useConfigPersistence.ts`, se agregó `SEARCH_CONFIG_OVERRIDES` al `keep`.

### 3.4 Diagnóstico de fallos de proveedor (visible)

- `src/server/searchProxy.ts`: cada proveedor que falla se **registra** (`console.warn`) y se **devuelve** en `errors[]` (con `status` y cuerpo del error), en vez de descartarse.
- `src/hooks/useWorkspaceSearch.ts`: `ProviderError` + propagación al estado (`searchState.error`).
- `src/components/WorkspaceHub.tsx`: recuadro rojo `[data-testid="search-error"]` con el motivo real.

## 4. Evidencia

- **OpenRouter directo**: `openai/gpt-oss-20b:free:online` → **404**; `google/gemini-2.5-flash-lite:online` → **200 con citas**.
- **Proxy en vivo** (`http://localhost:5173/api/search/web`): Tavily falla → **5 resultados `source:"openrouter"`**.
- **E2E real (Playwright)**: guardar la key OR persiste; **tras `reload`** el `localStorage` y el campo conservan la key; búsqueda "Databricks tuning" → `source:"openrouter"`.
- **Errores visibles**: con clave inválida, la UI muestra `Proveedores con error: tavily 401, openrouter …` y el log del proxy registra `[searchProxy] proveedor "openrouter" falló: fetch_error 401 :: …`.
- **Suite**: `npm run typecheck` limpio; `npm run lint` = 5 files / 29 passed; `npm run test:full` = **2795 passed / 6 failed**.

## 5. Pendiente (bloqueado por dato del usuario)

**OpenRouter sigue cayendo a Wikipedia en el entorno del usuario**, pese a que el pipeline está probado. Ya no se adivina: la causa se ve en el recuadro rojo `search-error` (o en los logs del portal).

Hipótesis a confirmar con esa evidencia:
- `openrouter 401` → clave **vacía o inválida** (no llegó al proxy). Verificar que el campo la conserva tras recargar.
- `openrouter 402` → cuenta OR **sin crédito**: la búsqueda web (`:online`) es paga incluso con modelos "free".
- `openrouter 404` → **modelo** inválido guardado como override (p. ej. el viejo `:free:online`).
- OR ausente de la lista de errores → proveedor **desactivado** en el Centro de Control.

**Acción solicitada al usuario**: recargar, buscar "Databricks tuning" y reportar el texto del recuadro rojo (o permitir leer el log del portal).

## 6. Deuda / preexistentes (fuera de alcance de esta sesión)

- `tests/deterministicArbiter.test.ts` (3 fallos) y `tests/hoyPanel.test.tsx` (3 fallos): preexistentes, ajenos a búsqueda; `deterministicArbiter.js` y `HorarioPizarron.tsx` ya estaban modificados antes de esta sesión.
- Specs E2E `tests/e2e/flu-settings-panel.spec.ts`: fallan por el **backdrop de onboarding** (el helper `gotoClean` borra `flu-onboarding-completed` y el overlay intercepta clics). Preexistente.
- `Diario` pausado (`FLU_CONFIG.diary.enabled = false`), causa de los fallos de `hoyPanel.test.tsx`.

## 7. Próximos pasos sugeridos

1. Cerrar OR con la evidencia del recuadro rojo (ver §5).
2. Si OR responde 402 (sin crédito), decidir: cargar crédito, o mover OR a un engine `parallel` barato, o dejar Wikipedia como respaldo y documentarlo.
3. Arreglar el helper E2E de onboarding (`gotoClean`) para reactivar la suite E2E del configurador.
4. Retomar `Diario` para volver verde `hoyPanel.test.tsx`.

## 8. Comandos útiles

```
npm run dev        # portal (localhost:5173)
npm run typecheck  # puerta de tipos
npm run lint       # guards estructurales
npm run test:full  # suite completa
npm run e2e        # Playwright (reutiliza el dev server)
```

## 9. Actualización autónoma (misma fecha, tarde)

### 9.1 Causa raíz del "no se guarda la key" → RESUELTA

- **Síntoma**: en 🔎 Búsqueda web la key no persistía; el campo mostraba 8 puntos.
- **Causa**: `localStorage` del origen **lleno** (`QuotaExceededError`). Había un valor viejo de 8 caracteres que no podía sobrescribirse y, como la lectura priorizaba `localStorage`, **opacaba** al nuevo. El guardado fallaba, no el campo.
- **Raíz del llenado**: el sistema de backups guardaba cada snapshot en `localStorage` (`backupSystem.ts:757-804`) con `maxTotalSizeMB: 100` (`:115`) y la limpieza **nunca aplicaba el límite por tamaño** (solo por cantidad).

### 9.2 Cambios aplicados

- `src/core/autonomy/backupSystem.ts`: `maxTotalSizeMB` 100 → **2**; `cleanupOldBackups` ahora aplica el límite por **tamaño** además del de cantidad; `saveBackup` **poda los más antiguos y reintenta** ante `QuotaExceededError`; `console.warn`/`console.error` visibles (no silenciosos).
- `src/store/integrationStore.ts`: `conversationHistory` ahora se recorta a `UI_DEFAULTS.CONVERSATION_HISTORY_LIMIT` (180) en `addConversationEntry`/`batchLoadHistory` (antes crecía sin tope y cada backup lo duplicaba). Guard: `tests/conversationHistoryCap.test.ts`.
- `src/core/search/searchConfigOverrides.ts`: escritura con respaldo **localStorage → sessionStorage**; al fallar `localStorage` **elimina el valor viejo** (no opaca); `getLastStorageError()`; `console.warn`/`console.error` en fallos. Sin cookie (evita enviar la key al servidor).
- `src/components/FluSettingsPanel.tsx`: la key de Búsqueda web se persiste **al escribir** (directo a la fuente), con verificación por relectura; badge ⚠️ solo si todas las fuentes fallan; se quitó el badge ✅ de conteo.
- Un solo Guardar global: submits contextuales `Guardar sitio`/`Guardar ambiente`/`Guardar temporada` (`fluConfig.js:1008,1748`, `SearchCatalogPanel.tsx`, `PaletasPanel.tsx`).
- E2E: `gotoClean` conserva el onboarding; nuevo `autoSkipOnboarding(page)` (usado en `flu-settings-panel.spec.ts`) para specs que no validan onboarding. **4/4 specs pasan**.

### 9.3 Evidencia

- E2E (escenario del usuario, cuota llena + valor viejo): `inicial=8 chars` → `ls=null` → `sessionStorage` con la key → `badge error=0` → **reload = 73 chars**.
- Guard nuevo `tests/searchOverridesStorage.test.ts` (3 tests): localStorage sano, fallback a sessionStorage, y no-shadow del valor viejo.
- Guard nuevo `tests/conversationHistoryCap.test.ts` (2 tests): tope 180 en append y en `batchLoadHistory`.
- `npm run typecheck` limpio · `npm run lint` 29 passed · `npm run test:full` **2800 passed / 6 preexistentes** (0 nuevos).

### 9.4 Deuda pendiente

- ~~6 fallos preexistentes por `Diario` pausado~~ **RESUELTO**: se restauró el diario (parser `src/core/diary/diaryIntentParser.ts` + reconocimiento en el árbitro + `FLU_CONFIG.diary.enabled = true`). `deterministicArbiter.test.ts` y `hoyPanel.test.tsx` pasan.
- Los backups siguen en `localStorage` (ahora acotados a 2 MB). Si se quiere más holgura, moverlos a IndexedDB.

## 10. Segunda tanda autónoma — puntos 1 a 10

Diagnóstico (prueba de escritorio, solo lectura) y arreglos verificados.

| # | Causa raíz (HECHO) | Arreglo | Guard |
|---|--------------------|---------|-------|
| 1 | `isIncompleteContentTurn` solo esperaba si la frase terminaba en web/internet; "información" cerraba la query | `searchPlaceholderHeads` (config) + regla 4 + `queryAfterTrigger`/`stripSearchQueryLeadFillers` | `decideVoiceTurnDispatch.test.ts` (+2) |
| 4 | Vocabulario sin "incluye"/"nota del súper" | `NOTE_SUPER_NOTA` + `cleanSuperItem` en `noteIntentParser.js` | `domainScopedIntent.test.ts` |
| 5/6 | Se ignoraba `accion.dominio` y se re-parseaba texto sin trigger | `resolveDomainScopedIntent` (parser con `assumedDomain`) + `lastActionFailed` (fallo del handler gana al LLM) | `domainScopedIntent.test.ts` + E2E `auditoria-acciones-llm` (8, 9) |
| 2 | Denominador de similitud tratado como distancia (`< 0.12`) y `registered-pinned` forzaba el nombre | umbral `≥ 1 - maxDistance`; en mismatch NO se fuerza el perfil | `speakerPinnedMismatch.test.ts` (+ regresión diarización 34) |
| 3 | No existía stop: tono finito, `AudioDriver.stop()` no-op, sin comando | `stop()` real (nodos activos), estado `ringing` + `stopRinging`, botón "Detener" (`temporal-stop`), `alarm.stop`/`timer.stop` por voz | `audioAlert.test.ts`, `temporalIntentParser.test.ts`, `hoyPanel.test.tsx` |
| 7 | Rejilla semanal fija por horas de config | `occupiedHours`/`hourPosition`: solo se renderizan franjas con agenda | `horarioCompact.test.tsx` |
| 8 | Rótulo "📅 Hoy" redundante | `hoyTitle` = solo ícono; `proximaClaseLabel` con ícono a la izquierda | (label config-driven) |
| 9 | El HorarioPizarron embebido (hideHeader) usaba `<details>` **sin `<summary>`** → el navegador pintaba su etiqueta por defecto "Detalles" | Con `hideHeader` se renderiza un `<div>` neutro (`.flu-horario__embedded`), sin `<details>` | `horarioCompact.test.tsx` (+2) |
| 10 | Narración sin sanitizar (lee `//` como "slash slash") y voz extranjera forzada; nombre de archivo = contenido | `sanitizeForNarration` + guard de idioma de voz; `nombre` de descarga desde el **tema** (`safeFileName`) | `localTts.test.ts` (+3) |
| — | Nota del súper UI | `HoyPanel`: sin checkbox, expandir y editar (✎) | `hoyPanel.test.tsx` (+2) |

**Evidencia final:** `npm run typecheck` limpio · `npm run lint` **29** · `npm run test:full` **2839 passed / 0 fallos**.

**Pendiente:** 12 (video, requiere API) — diferido.

## 11. Punto 11 — Documento/Imagen → insumo (Fase 0 + Fase 1)

**Fase 0 (traza + experimento).** Ya existía: imagen → visión (`processImageFile`) con contexto al historial; documento → `useDocumentAnalysis`; OCR de horario → `pendingHorarioImport` + confirmación. El experimento con `structureHorarioText` confirmó **falsos positivos**: un documento no-horario con día+hora (carta/reunión) generaba 1 entrada y disparaba la importación de horario; y el orden inline `Lunes 08:00-09:00 Matemáticas` parseaba la materia como "Lunes".

**Fase 1 (implementado).**
- `src/core/horario/horarioService.ts`: `esNombreDeDia` + fix de orden inline (materia tras el rango cuando lo previo es solo un día).
- `src/core/documents/scheduleAdapter.ts` (nuevo): adaptador con umbral `minEntries` — solo PROPONE si parece un horario real.
- `src/voice/lib/fluConfig.js`: `horario.ocrAdapter.minEntries = 2`.
- `src/App.tsx`: `processImageFile` usa el **adaptador** (desacoplado del flujo genérico); nuevo `processDocumentFile` agrega el `qa_context` del documento como **insumo** a la conversación (simétrico a la imagen).
- Guard: `tests/scheduleAdapter.test.ts` (6: positivos, negativos y umbral configurable).

**Evidencia:** `npm run typecheck` limpio · `npm run lint` **29** · `npm run test:full` **2839 passed / 0 fallos**.

**Pendiente del 11:** G2 (confirmación visible/errores), A2 (otros adaptadores), y E2E de comportamiento del insumo de documento. Decisiones abiertas: privacidad (remoto vs local), alcance de "insumo" (¿resolver paso a paso?), y qué otros adaptadores.

### 11-bis. G2 + E2E + insumo genérico (cerrado)

- `src/components/DocumentResultPanel.tsx`: `data-testid="document-analysis"` + `data-state` (analyzing/error/done) — confirmación visible.
- `src/core/documents/documentInsumo.ts` (nuevo): `buildDocumentInsumo` (qa_context > resumen; etiqueta por idioma). Guard `tests/documentInsumo.test.ts`.
- `src/App.tsx`: `processDocumentFile` agrega el insumo al historial (antes no lo hacía).
- `tests/e2e/documento-insumo.spec.ts`: sube un `.txt` → panel visible. `data-testid="doc-input"` en `WorkspaceHub`.

## 12. Punto 12 — Video real (fal.ai)

**Fase 0.** El pipeline existe: cliente → `/api/fal-video` (proxy) → fal.ai text-to-video (`imageGeneration.js:347`, `geminiProxy.ts:406`). Sin `FALAI_API_KEY` cae a `assembleVideo` (solo guion/storyboard, sin mp4) → "solo genera texto".

**Implementado (enabling).**
- `appConfig.ts`: `STORAGE_KEYS.FALAI_API_KEY` + `resolveFalApiKey()` (localStorage override > env).
- `useConfigPersistence.ts`: `falApiKey` + `handleFalApiKeyCommit` (auditado).
- `FluSettingsPanel.tsx`: sección **🎬 Video (fal.ai)** (`data-testid="video-falai-key"`) con aviso de que sin clave solo hay guion.
- `App.tsx`: wiring del prop.
- `useDocumentGeneration.ts`: usa `resolveFalApiKey()`; sin clave NO intenta fal y agrega **warning visible** al resultado.
- Guard: `tests/falApiKey.test.ts`.

**Evidencia:** `npm run typecheck` limpio · `npm run lint` **29** · `npm run test:full` **2845 passed / 0 fallos** · E2E settings **4/4** + E2E documento **ok**.

**Bloqueante del 12:** se necesita una **API key de fal.ai** (se pega en Ajustes → 🎬 Video). Sin ella no hay video real (decisión de producto/credencial).

## 13. Video: ruta ÚNICA + idempotencia (fuga de crédito)

**Fase 0 (evidencia).** Los logs mostraron **5 disparos del MISMO comando** de video (`16:57:41`, `17:00:52`, `17:01:15`, `17:01:43`, `17:02:06`), cada uno una **re-captura** del mismo pedido → 5 generaciones y 5 hablas. Causa: la generación se disparaba como **efecto dentro del handler del contrato** (`dispatchFluEvent(GENERATE_VIDEO)`) sin idempotencia, más una **segunda ruta** (bus `fluEvents` → bridge). Además, el turno de comando no pasaba por el commit `rawOnly` → la frase del usuario no aparecía en la bitácora.

**Cambios.**
- `src/core/media/mediaRequestGate.ts` (nuevo): gate de idempotencia (una generación por comando dentro de una ventana).
- `src/voice/lib/fluConfig.js`: `media.dedupWindowMs = 120000`.
- `src/App.tsx`: `requestMediaRef` = **única puerta** de generación; el contrato (`workspace` video/doc) y la navegación (`GENERAR_VIDEO/DOCUMENT`) la usan; se **eliminó** el despacho de eventos `GENERATE_*`; se commitea la frase del usuario en turnos de comando (no-`rawOnly`) con dedup.
- `src/hooks/useDocumentGenerationBridge.ts`: **se quitaron** las suscripciones `GENERATE_VIDEO/DOCUMENT` (era la 2.ª ruta).
- `src/hooks/useNavigationCommands.ts`: los casos de medios usan `requestMedia`.

**Guards.** `tests/mediaRequestGate.test.ts` (6) y `tests/mediaRouteSingle.test.ts` (3, **estructural**: falla si reaparece una 2.ª ruta).

**Evidencia.** `npm run typecheck` limpio · `npm run lint` **29** · `npm run test:full` **2855 passed / 0** · E2E acciones por contrato **9/9**.

**No validado / deuda.** El video inicial **no es recuperable** desde acá (vive en memoria —`videoResult`/`generationJob`, `partialize` no lo persiste— y su URL no se logueó); si la pestaña sigue abierta, el panel de generación tiene el último. Queda pendiente re-procesar/validar el commit del turno de comando en la bitácora.

## 14. Auditoría de rutas de ejecución (una por intención)

Se auditó cada intención del turno. Resultado: **un solo punto de ejecución** por intención.

| Intención | Ejecutor (único) | Entradas | ¿Doble? |
|---|---|---|---|
| Acciones de dominio (reminder/note/shopping/temporal/horario/diary) | `dispatchArbiterIntent` | LLM (`hasAcciones && !rawOnly`, App:1842) · offline (`!rawOnly && !hasAcciones`, App:1911) | **No** (excluyentes) |
| Navegación (buscar/navegar/minuta/resumen/analizar) | `handleNavigationCommand` | 1 sola llamada (App:2531) | **No** |
| Medios (video/documento) | `requestMediaRef` (gate idempotente) | contrato (App) + navegación (`requestMedia`) | **No** (ruta única) |
| Config de voz | `applyConfigAction` | 1 (App:2652) | **No** |
| Juego / Ambiente | `applyGameAction` / `applyEnvironment` | 1 (contract.juego / contract.ambiente) | **No** |
| Resumen / Minuta | `handleGenerateSummary` / `handleSaveMinute` | voz (evento) + UI (prop) | 2 disparadores, **mismo handler** (intencional) |
| Búsqueda web | `handleRunSearch` (WorkspaceHub) | voz (`RUN_SEARCH`) + barra UI | 2 disparadores, **mismo handler** (intencional) |
| Commit frase usuario | `rawOnly` (App:1678) · comando no-raw (App:1767) | excluyentes por `rawOnly` | **No** |
| Commit respuesta FLU | `addFluMessage` | 1 (App:2312) | **No** |
| Evento de sistema | `addConversationEntry` + dedup | 1 (App:1484) | **No** |

**Guards nuevos:** `tests/executionRouteAudit.test.ts` (4), `tests/mediaRouteSingle.test.ts` (3), `tests/mediaRequestGate.test.ts` (6). Fallan si reaparece una 2.ª ruta.

**Evidencia:** `npm run typecheck` limpio · `npm run lint` **29** · `npm run test:full` **2859 passed / 0**.

**Deuda menor detectada:** `addUserMessage` del store no se usa (código muerto, §2.10).

## 15. Tercera tanda — puntos 5-9, diarización, rollover y aislamiento

**Hecho y validado**
- **5) "Agenda de hoy" con ✎**: era la sección `hoy-clases` (`clasesHoyLabel`), no la de citas. Se agregó ✎ por clase con `horario.onEdit` (`HoyPanel.tsx:537-563`).
- **6) Márgenes horizontales**: contenido pegado al frame → `padding` horizontal **0** en `.workspace-hub__side` y `.hoy-panel__header/__body/__summary/__card`.
- **7) Editar hora de alarma**: `temporalService.update` acepta `{label, timeOfDay}` y recalcula `nextAt`; UI `type="time"` en `TemporalItemsPanel` y `HoyPanel`; wiring App. Guard `temporalService.test.ts` (+3).
- **8) Video solo en su pestaña**: `onlyInKind: true` en video/doc generado y video web.
- **9) Pestaña inicial por artefacto**: `ResultFeed` con filtro **"Vídeos"** + filtro inicial (video→Vídeos, imagen→Imágenes, si no→Todo), solo para artefactos generados. Guards `resultFeed.test.tsx` (8).
- **3) Diarización (regla dura, parte objetiva)**: `resolveConversationSpeakerSync` no estampa nombre propio sin evidencia de audio (`Hablante 1`). Falta calibración real con audio.
- **2) Corte por día**: `src/core/days/dayRollover.ts` + hook en App: si hay conversación de un día anterior sin cerrar → genera minuta y marca `flu-last-session-day`. Guard `dayRollover.test.ts` (5).
- **Aislamiento por usuario — conversación**: `ConversationRow.participantId` + Dexie **v18** con índice; `useConversationPersistence(participantId)` filtra/save/clear por alcance; App pasa `activeParticipantId`.

**Evidencia:** `npm run typecheck` limpio · `npm run lint` **29** · `npm run test:full` **2882 passed / 0**.

**Pendiente (encolado)**
- Aislamiento por usuario en: **notas**, agenda/citas, horario, temporales, minutas y **documentos**.
- **1)** historial de documentos + listado por usuario · **4)** persistir último artefacto.
- **Auditorías**: OCR (documentos y horarios) y juegos (reglas completas/funcionalidad).
- **Calibración de diarización** con 3 voces reales (tú/hija/FLU) y exclusión del TTS.

**No validado (usuario)**: aislamiento con dos usuarios, rollover con cambio de día real, diarización con audio real.

## 16. Aislamiento por usuario (avance)

Implementado con `participantId`/`personId` + filtro por alcance (`participantId || 'global'`) y **borrado/guardado por alcance**:
- **Conversación**: `ConversationRow.participantId` + Dexie **v18**; `useConversationPersistence(participantId)`.
- **Notas**: `filterNotesByScope` (`notesList.ts`) + `useNotes({participantId})`; guard `tests/notesScope.test.ts` (3).
- **Citas (reminders)**: `useReminders({participantId})` filtra por `personId`; `add` sella `personId`.
- **Temporales (alarmas/temporales)**: `TemporalItemRecord.personId` + Dexie **v19**; `useTemporalItems({participantId})` filtra lista y scheduler; `add` sella `personId`.
- **Horario**: `HorarioRecord.personId` + Dexie **v19**; `useHorario({participantId})` filtra y `add` sella `personId`.
- `App.tsx`: `activeParticipantId` se declara antes de los hooks y se pasa a conversación/notas/citas/temporales/horario.

**Evidencia:** `npm run typecheck` limpio · `npm run lint` **29** · `npm run test:full` **2885 passed / 0**.

**Pendiente de aislamiento:** **minutas** (`minutes`) y **documentos** (tabla nueva). Luego: **1)** historial/listado por usuario, **4)** persistir último artefacto, **auditorías OCR/juegos**, **calibración de diarización**.

## 17. Documentos (1 + 4) y auditorías

**Minutas aisladas**: `useMinuteKnowledge(participantId)` filtra por `userId` (alcance `participantId || 'global'`); `addMinute` sella `userId`.

**Documentos (1 + 4)**:
- `DocumentRecord` + Dexie **v20** (`documents: 'id, kind, formato, createdAt, personId'`).
- `src/core/documents/documentsService.ts`: `add/list(personId)/remove` (aislado por `personId || 'global'`). Guard `tests/documentsService.test.ts` (3).
- `src/hooks/useDocuments.ts`: historial por usuario (add/refresh/remove).
- Persistencia: **generados** en `requestMediaRef` (video/pdf) y **cargados** en `processDocumentFile`; el último artefacto queda como el más reciente del historial (**item 4**).
- UI: `DocumentsHistoryPanel` + render en `FluSettingsTabView` (grupo Gestión) + wiring App.

**Auditoría OCR** (`ocrService.ts`, `documentParser.ts`, `scheduleAdapter.ts`): Tesseract local para imagen/PDF escaneado; `parseDocument` cubre xlsx/pdf/docx/pptx/csv/txt/md; el adaptador de horario evita falsos positivos (`minEntries`). Brechas: OCR remoto opcional sin fixture E2E; `analyzeDocument` heurístico sin key.

**Auditoría juegos** (`src/core/games/`): **21 juegos, TODOS con motor puro y test** (`simonDice`, `riddles`, `veoVeo`, `adivinaNumero`, `calculoMental`, `palabrasEncadenadas`, `quienSoy`, `ahorcado`, `memoriaSecuencias`, `trabalenguas`, `trivia`, `ordenaSecuencia`, `adivinaCancion`, `storyteller`, `cuentoColaborativo`, `repiteTraduce`, `cuentaConmigo`, `abecedario`, `loteria`, `respiracion`, `karaoke`). Verificado: **17 archivos / 256 tests** de motores en verde. **Sin brecha** (la nota previa de "13 sin motor" era un grep parcial; los archivos existen).

**Evidencia:** `npm run typecheck` limpio · `npm run lint` **29** · `npm run test:full` **2888 passed / 0**.
